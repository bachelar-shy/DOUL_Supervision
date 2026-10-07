"""Focused tests for S2 bounded streaming quarantine storage."""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services.api.modules.evidence.storage import (
    Boto3S3QuarantineStore,
    ObjectStorageError,
    QuarantinedObject,
    StreamingQuarantineUploader,
    UploadValidationError,
)


class TrackingStream(io.BytesIO):
    def __init__(self, content: bytes):
        super().__init__(content)
        self.read_sizes: list[int] = []

    def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        return super().read(size)


class OversizedReadStream(io.BytesIO):
    """A broken/nonconforming stream that returns more than requested."""

    def read(self, size: int = -1) -> bytes:
        return super().read(-1)


class FakeQuarantineStore:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, dict[str, object]]] = {}
        self.fail = False

    def put_quarantine(self, key, body, *, content_length, content_type, sha256):
        if self.fail:
            raise OSError("simulated storage interruption")
        content = bytearray()
        while block := body.read(1024):
            content.extend(block)
        if len(content) != content_length:
            raise AssertionError("adapter supplied the wrong content length")
        self.objects[key] = (
            bytes(content),
            {"content_type": content_type, "sha256": sha256, "classification": "quarantine"},
        )
        return "fake-version-1"

    def open_quarantine(self, key, version_id=None):
        return io.BytesIO(self.objects[key][0])


class FakeS3Client:
    def __init__(self):
        self.put_args = None
        self.get_args = None

    def put_object(self, **kwargs):
        self.put_args = kwargs
        # ETag is intentionally not treated as a content SHA-256.
        return {"ETag": '"md5-or-provider-value"'}

    def get_object(self, **kwargs):
        self.get_args = kwargs
        return {"Body": io.BytesIO(b"remote")}


class StreamingQuarantineUploaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = FakeQuarantineStore()
        self.uploader = StreamingQuarantineUploader(
            self.store, self.temp.name, max_bytes=64 * 1024, read_size=4096
        )

    def store_bytes(self, content: bytes, *, project_id: str = "project_1", upload_id: str = "upload_123"):
        return self.uploader.store_verified(
            project_id,
            upload_id,
            io.BytesIO(content),
            expected_bytes=len(content),
            expected_sha256=hashlib.sha256(content).hexdigest(),
        )

    def test_streams_bounded_reads_and_persists_exact_hash_in_project_quarantine(self):
        content = bytes(range(256)) * 128
        source = TrackingStream(content)
        ref = self.uploader.store_verified(
            "project_1",
            "upload_123",
            source,
            expected_bytes=len(content),
            expected_sha256=hashlib.sha256(content).hexdigest(),
            content_type="application/octet-stream",
        )

        self.assertTrue(source.read_sizes)
        self.assertTrue(all(size == 4096 for size in source.read_sizes))
        self.assertEqual(ref.project_id, "project_1")
        self.assertEqual(ref.key, f"evidence/project_1/upload_123/{hashlib.sha256(content).hexdigest()}")
        stored, metadata = self.store.objects[ref.key]
        self.assertEqual(stored, content)
        self.assertEqual(ref.byte_count, len(content))
        self.assertEqual(ref.sha256, hashlib.sha256(content).hexdigest())
        self.assertEqual(ref.version_id, "fake-version-1")
        self.assertEqual(metadata["classification"], "quarantine")
        with self.uploader.open_verified(ref) as restored:
            self.assertEqual(restored.read(), content)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_same_upload_and_content_are_isolated_by_project(self):
        first = self.store_bytes(b"same", project_id="project_a")
        second = self.store_bytes(b"same", project_id="project_b")
        self.assertNotEqual(first.key, second.key)
        self.assertEqual(len(self.store.objects), 2)

    def test_hash_mismatch_writes_no_object_and_removes_staging(self):
        with self.assertRaisesRegex(UploadValidationError, "SHA-256"):
            self.uploader.store_verified(
                "project_1",
                "upload_123",
                io.BytesIO(b"original"),
                expected_bytes=8,
                expected_sha256="0" * 64,
            )
        self.assertEqual(self.store.objects, {})
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_declared_length_mismatch_writes_no_object(self):
        with self.assertRaisesRegex(UploadValidationError, "size"):
            self.uploader.store_verified(
                "project_1",
                "upload_123",
                io.BytesIO(b"short"),
                expected_bytes=10,
                expected_sha256=hashlib.sha256(b"short").hexdigest(),
            )
        self.assertEqual(self.store.objects, {})

    def test_oversized_stream_stops_before_remote_write(self):
        content = b"x" * (64 * 1024 + 1)
        with self.assertRaisesRegex(UploadValidationError, "exceeds"):
            self.uploader.store_verified(
                "project_1",
                "upload_123",
                TrackingStream(content),
                expected_bytes=len(content),
                expected_sha256=hashlib.sha256(content).hexdigest(),
            )
        self.assertEqual(self.store.objects, {})

    def test_nonconforming_source_cannot_exceed_configured_read_chunk(self):
        with self.assertRaisesRegex(UploadValidationError, "bounded read size"):
            self.uploader.store_verified(
                "project_1",
                "upload_123",
                OversizedReadStream(b"x" * 5000),
                expected_bytes=5000,
                expected_sha256=hashlib.sha256(b"x" * 5000).hexdigest(),
            )
        self.assertEqual(self.store.objects, {})
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_bool_integer_limits_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "max_bytes"):
            StreamingQuarantineUploader(self.store, self.temp.name, max_bytes=True)
        with self.assertRaisesRegex(ValueError, "read_size"):
            StreamingQuarantineUploader(self.store, self.temp.name, max_bytes=10, read_size=True)
        with self.assertRaisesRegex(ValueError, "expected_bytes"):
            self.uploader.store_verified(
                "project_1", "upload_123", io.BytesIO(b""), expected_bytes=False,
                expected_sha256=hashlib.sha256(b"").hexdigest(),
            )

    def test_storage_failure_does_not_return_reference_and_cleans_staging(self):
        self.store.fail = True
        with self.assertRaises(ObjectStorageError):
            self.store_bytes(b"safe")
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_boto3_adapter_sends_binary_body_private_metadata_and_exact_version(self):
        client = FakeS3Client()
        store = Boto3S3QuarantineStore(client, bucket="doul-private", prefix="evidence")
        body = io.BytesIO(b"remote")
        version = store.put_quarantine(
            "project_1/upload_123/abc",
            body,
            content_length=6,
            content_type="application/octet-stream",
            sha256=hashlib.sha256(b"remote").hexdigest(),
        )

        self.assertIsNone(version)
        self.assertIs(client.put_args["Body"], body)
        self.assertEqual(client.put_args["Bucket"], "doul-private")
        self.assertEqual(client.put_args["Key"], "evidence/project_1/upload_123/abc")
        self.assertEqual(client.put_args["ContentLength"], 6)
        self.assertEqual(client.put_args["Metadata"]["classification"], "quarantine")
        self.assertEqual(client.put_args["Metadata"]["sha256"], hashlib.sha256(b"remote").hexdigest())
        self.assertNotIn("ACL", client.put_args)
        with store.open_quarantine("project_1/upload_123/abc", "version-2") as remote:
            self.assertEqual(remote.read(), b"remote")
        self.assertEqual(client.get_args["VersionId"], "version-2")

    def test_corrupt_download_size_is_not_exposed_to_caller(self):
        ref = self.store_bytes(b"original")
        self.store.objects[ref.key] = (b"original-extra", {})
        exposed = False
        with self.assertRaisesRegex(UploadValidationError, "size"):
            with self.uploader.open_verified(ref):
                exposed = True
        self.assertFalse(exposed)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_corrupt_download_hash_is_not_exposed_to_caller(self):
        ref = self.store_bytes(b"original")
        self.store.objects[ref.key] = (b"tampered", {})
        exposed = False
        with self.assertRaisesRegex(UploadValidationError, "SHA-256"):
            with self.uploader.open_verified(ref):
                exposed = True
        self.assertFalse(exposed)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_remote_stream_closes_when_staging_file_creation_fails(self):
        ref = self.store_bytes(b"original")
        remote = io.BytesIO(b"original")
        with patch.object(self.store, "open_quarantine", return_value=remote):
            with patch(
                "services.api.modules.evidence.storage.tempfile.NamedTemporaryFile",
                side_effect=OSError("staging disk unavailable"),
            ):
                with self.assertRaisesRegex(OSError, "staging disk unavailable"):
                    with self.uploader.open_verified(ref):
                        self.fail("unreachable")
        self.assertTrue(remote.closed)

    def test_open_verified_rejects_cross_project_key_before_storage_read(self):
        ref = self.store_bytes(b"original")
        foreign = QuarantinedObject(
            project_id="project_other",
            key=ref.key,
            version_id=ref.version_id,
            byte_count=ref.byte_count,
            sha256=ref.sha256,
            content_type=ref.content_type,
        )
        with self.assertRaisesRegex(ValueError, "project namespace"):
            with self.uploader.open_verified(foreign):
                self.fail("unreachable")
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_invalid_project_or_upload_id_is_rejected(self):
        for project_id, upload_id in [("../project", "upload_123"), ("project", "../upload")]:
            with self.subTest(project_id=project_id, upload_id=upload_id):
                with self.assertRaises(ValueError):
                    self.uploader.store_verified(
                        project_id,
                        upload_id,
                        io.BytesIO(b""),
                        expected_bytes=0,
                        expected_sha256=hashlib.sha256(b"").hexdigest(),
                    )


if __name__ == "__main__":
    unittest.main()
