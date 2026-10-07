"""Focused tests for S2 bounded streaming quarantine storage."""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
import tempfile
import unittest

from services.api.modules.evidence.storage import (
    Boto3S3QuarantineStore,
    ObjectStorageError,
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
        return {"VersionId": "version-2"}

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

    def test_streams_bounded_reads_and_persists_exact_hash_in_quarantine(self):
        content = bytes(range(256)) * 128
        source = TrackingStream(content)
        ref = self.uploader.store_verified(
            "upload_123",
            source,
            expected_bytes=len(content),
            expected_sha256=hashlib.sha256(content).hexdigest(),
            content_type="application/octet-stream",
        )

        self.assertTrue(source.read_sizes)
        self.assertTrue(all(size == 4096 for size in source.read_sizes))
        stored, metadata = self.store.objects[ref.key]
        self.assertEqual(stored, content)
        self.assertEqual(ref.byte_count, len(content))
        self.assertEqual(ref.sha256, hashlib.sha256(content).hexdigest())
        self.assertEqual(ref.version_id, "fake-version-1")
        self.assertEqual(metadata["classification"], "quarantine")
        with self.uploader.open_verified(ref) as restored:
            self.assertEqual(restored.read(), content)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_hash_mismatch_writes_no_object(self):
        with self.assertRaisesRegex(UploadValidationError, "SHA-256"):
            self.uploader.store_verified(
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
                "upload_123",
                io.BytesIO(b"short"),
                expected_bytes=10,
                expected_sha256=hashlib.sha256(b"short").hexdigest(),
            )
        self.assertEqual(self.store.objects, {})

    def test_oversized_stream_stops_before_remote_write(self):
        with self.assertRaisesRegex(UploadValidationError, "exceeds"):
            self.uploader.store_verified(
                "upload_123",
                TrackingStream(b"x" * (64 * 1024 + 1)),
                expected_bytes=64 * 1024 + 1,
                expected_sha256=hashlib.sha256(b"x" * (64 * 1024 + 1)).hexdigest(),
            )
        self.assertEqual(self.store.objects, {})

    def test_storage_failure_does_not_return_official_reference(self):
        self.store.fail = True
        with self.assertRaises(ObjectStorageError):
            self.uploader.store_verified(
                "upload_123",
                io.BytesIO(b"safe"),
                expected_bytes=4,
                expected_sha256=hashlib.sha256(b"safe").hexdigest(),
            )
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_boto3_adapter_uses_private_quarantine_metadata_and_exact_version(self):
        client = FakeS3Client()
        store = Boto3S3QuarantineStore(client, bucket="doul-private", prefix="evidence")
        version = store.put_quarantine(
            "upload_123/abc",
            io.BytesIO(b"remote"),
            content_length=6,
            content_type="application/octet-stream",
            sha256=hashlib.sha256(b"remote").hexdigest(),
        )

        self.assertEqual(version, "version-2")
        self.assertEqual(client.put_args["Bucket"], "doul-private")
        self.assertEqual(client.put_args["Key"], "evidence/upload_123/abc")
        self.assertEqual(client.put_args["Metadata"]["classification"], "quarantine")
        self.assertNotIn("ACL", client.put_args)
        with store.open_quarantine("upload_123/abc", version) as body:
            self.assertEqual(body.read(), b"remote")
        self.assertEqual(client.get_args["VersionId"], version)

    def test_corrupt_download_is_not_exposed_to_caller(self):
        content = b"original"
        ref = self.uploader.store_verified(
            "upload_123",
            io.BytesIO(content),
            expected_bytes=len(content),
            expected_sha256=hashlib.sha256(content).hexdigest(),
        )
        self.store.objects[ref.key] = (
            b"tampered",
            {"classification": "quarantine"},
        )
        exposed = False
        with self.assertRaisesRegex(UploadValidationError, "SHA-256"):
            with self.uploader.open_verified(ref):
                exposed = True
        self.assertFalse(exposed)
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_invalid_upload_id_is_rejected(self):
        with self.assertRaises(ValueError):
            self.uploader.store_verified(
                "../project",
                io.BytesIO(b""),
                expected_bytes=0,
                expected_sha256=hashlib.sha256(b"").hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
