#!/usr/bin/env python3
"""Exercise the S3 quarantine adapter against a disposable S3-compatible service.

This is an operational integration check, not a provider certification. It
creates and deletes only a uniquely named bucket and its test versions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

import boto3
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.api.modules.evidence.storage import (  # noqa: E402
    Boto3S3QuarantineStore,
    StreamingQuarantineUploader,
    UploadContentConflict,
    UploadValidationError,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    endpoint = os.environ.get("DOUL_OPS_S3_ENDPOINT", "http://127.0.0.1:19000")
    access = os.environ.get("DOUL_OPS_S3_ACCESS_KEY", "doul-ops")
    secret = os.environ.get("DOUL_OPS_S3_SECRET_KEY", "ops-disposable-only")
    client = boto3.client(
        "s3", endpoint_url=endpoint, aws_access_key_id=access,
        aws_secret_access_key=secret, region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 0}),
    )
    anonymous = boto3.client(
        "s3", endpoint_url=endpoint, region_name="us-east-1",
        config=Config(signature_version=UNSIGNED, s3={"addressing_style": "path"}, retries={"max_attempts": 0}),
    )
    suffix = uuid.uuid4().hex[:16]
    bucket = f"doul-ops-{suffix}"
    project_id, upload_id = f"ops{suffix}", "immutable-probe"
    payload = b"synthetic operational S3 quarantine probe v1\n" * 2048
    digest = hashlib.sha256(payload).hexdigest()
    created = time.time()
    checks: dict[str, object] = {}
    bucket_deleted = False
    client.create_bucket(Bucket=bucket)
    try:
        client.put_bucket_versioning(
            Bucket=bucket, VersioningConfiguration={"Status": "Enabled"}
        )
        with tempfile.TemporaryDirectory(prefix="doul-ops-s3-") as staging:
            uploader = StreamingQuarantineUploader(
                Boto3S3QuarantineStore(client, bucket, prefix="quarantine"),
                staging,
                max_bytes=2_000_000,
                read_size=4096,
            )
            import io

            first = uploader.store_verified(
                project_id, upload_id, io.BytesIO(payload), expected_bytes=len(payload),
                expected_sha256=digest, content_type="application/octet-stream",
            )
            retry = uploader.store_verified(
                project_id, upload_id, io.BytesIO(payload), expected_bytes=len(payload),
                expected_sha256=digest, content_type="application/octet-stream",
            )
            checks["versioningEnabled"] = client.get_bucket_versioning(Bucket=bucket).get("Status") == "Enabled"
            checks["versionIdReturned"] = bool(first.version_id)
            object_key = f"quarantine/{first.key}"
            checks["idempotentRetryReusedVersion"] = first.version_id == retry.version_id
            checks["retryCreatedSingleVersion"] = len(client.list_object_versions(Bucket=bucket).get("Versions", [])) == 1
            checks["privateAnonymousReadDenied"] = False
            try:
                anonymous.get_object(Bucket=bucket, Key=object_key)
            except ClientError as exc:
                checks["privateAnonymousReadDenied"] = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") in (401, 403)
            checks["changedContentConflicts"] = False
            changed = b"changed payload"  # same upload ID cannot be rebound
            try:
                uploader.store_verified(
                    project_id, upload_id, io.BytesIO(changed), expected_bytes=len(changed),
                    expected_sha256=hashlib.sha256(changed).hexdigest(),
                    content_type="application/octet-stream",
                )
            except UploadContentConflict:
                checks["changedContentConflicts"] = True
            checks["wrongDigestRejectedBeforeWrite"] = False
            try:
                uploader.store_verified(
                    project_id, "wrong-digest", io.BytesIO(payload), expected_bytes=len(payload),
                    expected_sha256="0" * 64, content_type="application/octet-stream",
                )
            except UploadValidationError:
                checks["wrongDigestRejectedBeforeWrite"] = True
            with uploader.open_verified(first) as verified:
                restored = verified.read()
            checks["exactVersionReadbackHashMatches"] = hashlib.sha256(restored).hexdigest() == digest
            checks["exactVersionReadbackBytesMatch"] = restored == payload
            checks["quarantineMetadataPresent"] = client.head_object(
                Bucket=bucket, Key=object_key,
            ).get("Metadata", {}).get("classification") == "quarantine"
            checks["stagingDirectoryEmptyAfterReadback"] = not list(Path(staging).iterdir())
    finally:
        # Remove only this probe's uniquely named bucket, including all versions.
        try:
            versions = client.list_object_versions(Bucket=bucket)
            objects = [
                {"Key": item["Key"], "VersionId": item["VersionId"]}
                for item in [*versions.get("Versions", []), *versions.get("DeleteMarkers", [])]
            ]
            if objects:
                for offset in range(0, len(objects), 1000):
                    client.delete_objects(Bucket=bucket, Delete={"Objects": objects[offset:offset + 1000]})
            client.delete_bucket(Bucket=bucket)
            bucket_deleted = True
        except ClientError:
            pass
    report = {
        "service": "RustFS",
        "serviceVersion": "1.0.1",
        "endpoint": endpoint,
        "bucket": bucket,
        "bucketDeleted": bucket_deleted,
        "payloadBytes": len(payload),
        "payloadSha256": digest,
        "checks": checks,
        "status": "passed" if bucket_deleted and checks and all(checks.values()) else "failed",
        "elapsedSeconds": round(time.time() - created, 3),
    }
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered)
    print(rendered, end="")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
