"""Version-changing S3 fake tests for logical upload retries and reconciliation."""
import boto3
from botocore.stub import Stubber, ANY
import hashlib
import io
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
import unittest

from botocore.exceptions import ClientError, ReadTimeoutError, ConnectTimeoutError
from unittest.mock import patch
from services.api.modules.evidence.storage import (
    Boto3S3QuarantineStore, ObjectStorageError, StreamingQuarantineUploader,
    UploadContentConflict, UploadReconciliationRequired,
)


def s3_error(code, status):
    return ClientError({"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}, "PutObject")


class VersionedS3:
    """Every successful PUT creates a new version, including identical bytes."""
    def __init__(self, *, versioned=True):
        self.objects = {}
        self.lock = threading.Lock()
        self.writes = 0
        self.attempts = 0
        self.heads = 0
        self.mode = None
        self.barrier = None
        self.versioned = versioned
        self.fail_head = False

    def put_object(self, **args):
        if self.barrier is not None:
            self.barrier.wait(timeout=10)
        key = args["Bucket"], args["Key"]
        with self.lock:
            self.attempts += 1
            mode, self.mode = self.mode, None
            if mode == "forbidden":
                raise s3_error("AccessDenied", 403)
            if mode == "conflict":
                raise s3_error("ConditionalRequestConflict", 409)
            if mode == "timeout-before":
                raise ReadTimeoutError(endpoint_url="https://s3.invalid")
            versions = self.objects.setdefault(key, [])
            if args.get("IfNoneMatch") == "*" and versions:
                raise s3_error("PreconditionFailed", 412)
            self.writes += 1
            version = f"ver-{self.writes}" if self.versioned else None
            versions.append({"VersionId": version, "content": args["Body"].read(),
                             "Metadata": dict(args["Metadata"]), "ContentLength": args["ContentLength"],
                             "ContentType": args["ContentType"]})
            if mode == "timeout-after":
                raise ReadTimeoutError(endpoint_url="https://s3.invalid")
            return {"VersionId": version} if self.versioned else {}

    def head_object(self, **args):
        with self.lock:
            self.heads += 1
            if self.fail_head:
                raise s3_error("AccessDenied", 403)
            versions = self.objects.get((args["Bucket"], args["Key"]), [])
            if not versions:
                raise s3_error("NoSuchKey", 404)
            return {k: v for k, v in versions[-1].items() if k != "content"}

    def get_object(self, **args):
        versions = self.objects[(args["Bucket"], args["Key"])]
        version = args.get("VersionId")
        entry = next(v for v in versions if v["VersionId"] == version) if version is not None else versions[-1]
        return {"Body": io.BytesIO(entry["content"])}


class VersionedRetryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.client = VersionedS3()
        self.store = Boto3S3QuarantineStore(self.client, "private")
        self.uploader = StreamingQuarantineUploader(self.store, self.directory.name, max_bytes=4096, read_size=8)

    def upload(self, content=b"original", *, project="project_1", content_type="application/octet-stream"):
        return self.uploader.store_verified(project, "upload_1", io.BytesIO(content),
            expected_bytes=len(content), expected_sha256=hashlib.sha256(content).hexdigest(), content_type=content_type)

    def test_fake_reproduces_unconditional_put_version_growth(self):
        args = dict(Bucket="private", Key="reproduction", Body=io.BytesIO(b"x"),
                    ContentLength=1, ContentType="text/plain", Metadata={})
        first = self.client.put_object(**args)
        args["Body"] = io.BytesIO(b"x")
        second = self.client.put_object(**args)
        self.assertNotEqual(first["VersionId"], second["VersionId"])
        self.assertEqual(self.client.writes, 2)

    def test_locked_sdk_validates_conditional_put_and_versioned_head_parameters(self):
        client = boto3.client("s3", region_name="us-east-1",
            aws_access_key_id="test", aws_secret_access_key="test")
        store = Boto3S3QuarantineStore(client, "private")
        content = b"original"
        digest = hashlib.sha256(content).hexdigest()
        metadata = {"classification": "quarantine", "sha256": digest}
        expected = {"Bucket": "private", "Key": "quarantine/slot", "Body": ANY,
                    "ContentLength": len(content), "ContentType": "application/octet-stream",
                    "Metadata": metadata, "IfNoneMatch": "*"}
        with Stubber(client) as stub:
            stub.add_response("put_object", {"VersionId": "ver-1"}, expected)
            stub.add_client_error("put_object", "PreconditionFailed", http_status_code=412, expected_params=expected)
            stub.add_response("head_object", {"VersionId": "ver-1", "ContentLength": len(content),
                "ContentType": "application/octet-stream", "Metadata": metadata},
                {"Bucket": "private", "Key": "quarantine/slot"})
            versions = [store.put_quarantine("slot", io.BytesIO(content), content_length=len(content),
                content_type="application/octet-stream", sha256=digest) for _ in range(2)]
            self.assertEqual(versions, ["ver-1", "ver-1"])
            stub.assert_no_pending_responses()

    def test_same_logical_upload_reuses_exact_version_with_one_write(self):
        first, second = self.upload(), self.upload()
        self.assertEqual(first, second)
        self.assertEqual(self.client.writes, 1)
        self.assertEqual(first.version_id, "ver-1")
        with self.uploader.open_verified(second) as stream:
            self.assertEqual(stream.read(), b"original")

    def test_concurrent_same_content_retries_all_return_one_version(self):
        self.client.barrier = threading.Barrier(8)
        with ThreadPoolExecutor(max_workers=8) as pool:
            references = list(pool.map(lambda _: self.upload(), range(8)))
        self.assertEqual(len(set(references)), 1)
        self.assertEqual(self.client.writes, 1)

    def test_concurrent_changed_content_has_one_winner_and_explicit_conflict(self):
        self.client.barrier = threading.Barrier(2)
        def attempt(content):
            try:
                return self.upload(content)
            except UploadContentConflict as exc:
                return exc
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, [b"first", b"other"]))
        self.assertEqual(sum(isinstance(r, UploadContentConflict) for r in results), 1)
        self.assertEqual(self.client.writes, 1)

    def test_committed_put_timeout_reconciles_exact_version_without_second_write(self):
        self.client.mode = "timeout-after"
        first, second = self.upload(), self.upload()
        self.assertEqual(first, second)
        self.assertEqual(self.client.writes, 1)

    def test_uncommitted_timeout_is_unknown_until_safe_retry(self):
        self.client.mode = "timeout-before"
        with self.assertRaises(UploadReconciliationRequired):
            self.upload()
        self.assertEqual(self.client.writes, 0)
        self.assertEqual(self.upload().version_id, "ver-1")
        self.assertEqual(self.client.writes, 1)

    def test_connection_and_service_timeouts_are_explicitly_unconfirmed(self):
        for failure in (ConnectTimeoutError(endpoint_url="https://s3.invalid"), s3_error("RequestTimeout", 400)):
            with self.subTest(error=type(failure).__name__):
                with patch.object(self.client, "put_object", side_effect=failure):
                    with self.assertRaises(UploadReconciliationRequired):
                        self.upload()
        self.assertEqual(self.client.writes, 0)

    def test_409_without_confirmed_object_requires_reconciliation(self):
        self.client.mode = "conflict"
        with self.assertRaises(UploadReconciliationRequired):
            self.upload()
        self.assertEqual(self.client.writes, 0)
        self.assertEqual(self.upload().version_id, "ver-1")

    def test_timeout_and_unreadable_head_never_invent_a_reference(self):
        self.client.mode = "timeout-after"
        self.client.fail_head = True
        with self.assertRaises(UploadReconciliationRequired):
            self.upload()
        self.assertEqual(self.client.writes, 1)
        self.client.fail_head = False
        self.assertEqual(self.upload().version_id, "ver-1")
        self.assertEqual(self.client.writes, 1)

    def test_changed_digest_or_content_type_rejects_upload_id_reuse(self):
        self.upload()
        for content, content_type in [(b"changed", "application/octet-stream"), (b"original", "text/plain")]:
            with self.subTest(content=content, content_type=content_type), self.assertRaises(UploadContentConflict):
                self.upload(content, content_type=content_type)
        self.assertEqual(self.client.writes, 1)

    def test_reconciliation_checks_size_hash_and_quarantine_classification(self):
        first = self.upload()
        entry = next(iter(self.client.objects.values()))[-1]
        for field, bad in [("ContentLength", 999), ("ContentType", "text/plain"),
                           ("Metadata", {"sha256": first.sha256, "classification": "official"}),
                           ("Metadata", {"sha256": "0" * 64, "classification": "quarantine"})]:
            old = entry[field]
            entry[field] = bad
            with self.subTest(field=field), self.assertRaises(UploadContentConflict):
                self.upload()
            entry[field] = old
        self.assertEqual(self.client.writes, 1)

    def test_project_ids_have_independent_upload_slots(self):
        first, second = self.upload(), self.upload(b"other", project="project_2")
        self.assertNotEqual(first.key, second.key)
        self.assertEqual(self.client.writes, 2)

    def test_access_denial_is_a_remote_failure_not_a_successful_replay(self):
        self.upload()
        self.client.mode = "forbidden"
        with self.assertRaises(ObjectStorageError):
            self.upload()
        self.assertEqual(self.client.heads, 0)
        self.assertEqual(self.client.writes, 1)

    def test_unversioned_store_also_avoids_duplicate_writes(self):
        self.client.versioned = False
        first, second = self.upload(), self.upload()
        self.assertIsNone(first.version_id)
        self.assertEqual(first, second)
        self.assertEqual(self.client.writes, 1)

    def test_verified_download_uses_reference_version_not_latest_version(self):
        first = self.upload()
        self.client.put_object(Bucket="private", Key="quarantine/" + first.key,
            Body=io.BytesIO(b"changed"), ContentLength=7, ContentType="application/octet-stream",
            Metadata={"classification": "quarantine", "sha256": hashlib.sha256(b"changed").hexdigest()})
        with self.uploader.open_verified(first) as stream:
            self.assertEqual(stream.read(), b"original")

if __name__ == "__main__":
    unittest.main()
