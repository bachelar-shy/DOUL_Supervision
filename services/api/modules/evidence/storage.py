"""Streaming quarantine storage boundary for original evidence.

This module deliberately does not finalize evidence or make objects available to
business workflows. Callers must complete MIME validation, security scanning,
metadata commit, and reconciliation before an object can become official.
Local staging files are temporary and removed; remote quarantine objects are
retained until an explicit governance disposition or reconciliation action.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import tempfile
from typing import BinaryIO, Iterator, Protocol


class UploadValidationError(ValueError):
    """The supplied stream does not satisfy its declared size or digest."""


class ObjectStorageError(RuntimeError):
    """Storage did not confirm quarantine persistence."""


class UploadContentConflict(ObjectStorageError):
    """The logical upload ID is already bound to different content/metadata."""


class UploadReconciliationRequired(ObjectStorageError):
    """The remote outcome is unknown; retry/reconcile without deleting objects."""


@dataclass(frozen=True)
class QuarantinedObject:
    """Reference to a verified, project-scoped object that remains quarantined.

    This reference is not proof of malware scanning, business acceptance, or
    official evidence finalization.
    """

    project_id: str
    key: str
    version_id: str | None
    byte_count: int
    sha256: str
    content_type: str


class QuarantineObjectStore(Protocol):
    """Private object store operations required by the upload boundary."""

    def put_quarantine(
        self,
        key: str,
        body: BinaryIO,
        *,
        content_length: int,
        content_type: str,
        sha256: str,
    ) -> str | None:
        """Conditionally persist an immutable private quarantine slot.

        Matching metadata must reuse the confirmed reference; changed digest,
        length or media type raises UploadContentConflict. An unconfirmed remote
        outcome raises UploadReconciliationRequired. Never delete on failure.
        """
        ...

    def open_quarantine(
        self, key: str, version_id: str | None = None
    ) -> BinaryIO:
        """Open the exact quarantined object version for validation."""
        ...


class Boto3S3QuarantineStore:
    """Small S3-compatible adapter; boto3 is supplied lazily by composition."""

    def __init__(self, client: object, bucket: str, prefix: str = "quarantine"):
        if not bucket.strip():
            raise ValueError("bucket must not be empty")
        normalized_prefix = prefix.strip("/")
        if not normalized_prefix or any(part in {".", ".."} for part in normalized_prefix.split("/")):
            raise ValueError("prefix must be a non-empty safe object prefix")
        self._client = client
        self._bucket = bucket
        self._prefix = normalized_prefix

    def _key(self, key: str) -> str:
        if not key or key.startswith("/") or any(part in {"", ".", ".."} for part in key.split("/")):
            raise ValueError("object key must be a safe relative key")
        return f"{self._prefix}/{key}"

    def put_quarantine(
        self,
        key: str,
        body: BinaryIO,
        *,
        content_length: int,
        content_type: str,
        sha256: str,
    ) -> str | None:
        object_key = self._key(key)
        # Conditional writes, not a HEAD-then-PUT check, arbitrate concurrent
        # writers. This must not fall back to an unconditional PUT on providers
        # that do not support IfNoneMatch.
        try:
            result = self._client.put_object(
                Bucket=self._bucket,
                Key=object_key,
                Body=body,
                ContentLength=content_length,
                ContentType=content_type,
                Metadata={"classification": "quarantine", "sha256": sha256},
                IfNoneMatch="*",
            )
        except Exception as exc:
            response = getattr(exc, "response", None) or {}
            code = str(response.get("Error", {}).get("Code", ""))
            status = response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
            if code in {"PreconditionFailed", "412", "ConditionalRequestConflict", "409"} or status in {409, 412}:
                return self._reconcile(object_key, content_length, content_type, sha256)
            if self._uncertain(exc) or code in {"RequestTimeout", "RequestTimeoutException", "408"} or status == 408 or (isinstance(status, int) and status >= 500):
                return self._reconcile(object_key, content_length, content_type, sha256)
            raise ObjectStorageError("quarantine conditional write failed") from exc
        version_id = result.get("VersionId")
        return str(version_id) if version_id is not None else None

    @staticmethod
    def _uncertain(exc: Exception) -> bool:
        if isinstance(exc, (TimeoutError, ConnectionError)):
            return True
        # Keep the boundary importable without the optional object SDK.
        try:
            from botocore.exceptions import (
                ConnectionClosedError, ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError,
            )
        except ImportError:
            return False
        return isinstance(exc, (ConnectionClosedError, ConnectTimeoutError, EndpointConnectionError, ReadTimeoutError))

    def _reconcile(self, object_key: str, content_length: int, content_type: str, sha256: str) -> str | None:
        try:
            current = self._client.head_object(Bucket=self._bucket, Key=object_key)
        except Exception as exc:
            # A missing/unreadable object after 409/timeout is not a successful
            # upload. The caller can retry the same conditional write later.
            raise UploadReconciliationRequired("quarantine outcome is not yet confirmed") from exc
        metadata = current.get("Metadata", {})
        if (
            current.get("DeleteMarker")
            or metadata.get("classification") != "quarantine"
            or metadata.get("sha256") != sha256
            or current.get("ContentLength") != content_length
            or current.get("ContentType") != content_type
        ):
            raise UploadContentConflict("upload ID is already bound to different content or metadata")
        version_id = current.get("VersionId")
        return str(version_id) if version_id is not None else None

    def open_quarantine(
        self, key: str, version_id: str | None = None
    ) -> BinaryIO:
        arguments = {"Bucket": self._bucket, "Key": self._key(key)}
        if version_id is not None:
            arguments["VersionId"] = version_id
        return self._client.get_object(**arguments)["Body"]


class StreamingQuarantineUploader:
    """Verify to bounded local disk, then stream the verified bytes to storage.

    A disk-backed temporary file bounds staging storage by max_bytes, while this
    adapter's in-memory source/readback chunks are limited to read_size (excluding
    buffers internal to the caller or object-storage SDK). Staging files are
    deleted on success and failure. The project/upload ID is a single immutable
    content slot. A conditional object-store write makes concurrent same-content
    retries reuse its confirmed version; changed content/metadata conflicts.
    Remote quarantine objects are not automatically deleted: retention and
    disposition require a separate explicit policy.
    """

    _UPLOAD_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
    _SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")

    def __init__(
        self,
        store: QuarantineObjectStore,
        staging_dir: str | os.PathLike[str],
        *,
        max_bytes: int,
        read_size: int = 1024 * 1024,
        key_prefix: str = "evidence",
    ):
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
            raise ValueError("max_bytes must be a positive integer")
        if isinstance(read_size, bool) or not isinstance(read_size, int) or read_size <= 0:
            raise ValueError("read_size must be a positive integer")
        if not isinstance(key_prefix, str) or not key_prefix or any(
            part in {"", ".", ".."} for part in key_prefix.strip("/").split("/")
        ):
            raise ValueError("key_prefix must be a safe relative prefix")
        if not key_prefix.strip("/"):
            raise ValueError("key_prefix must not be empty")
        self._store = store
        self._staging_dir = Path(staging_dir)
        self._max_bytes = max_bytes
        self._read_size = read_size
        self._key_prefix = key_prefix.strip("/")

    @contextmanager
    def open_verified(
        self, reference: QuarantinedObject
    ) -> Iterator[BinaryIO]:
        """Stage and verify a stored version before exposing any bytes.

        This prevents callers from processing corrupt or truncated object data.
        The returned stream is disk-backed and is removed when the context exits.
        """
        if isinstance(reference.byte_count, bool) or not isinstance(reference.byte_count, int):
            raise ValueError("reference byte_count must be an integer")
        if reference.byte_count < 0 or reference.byte_count > self._max_bytes:
            raise UploadValidationError("stored object exceeds configured maximum")
        if not self._UPLOAD_ID.fullmatch(reference.project_id):
            raise ValueError("reference project_id is invalid")
        if not reference.key.startswith(f"{self._key_prefix}/{reference.project_id}/"):
            raise ValueError("reference key is outside its project namespace")
        if not self._SHA256.fullmatch(reference.sha256):
            raise ValueError("reference SHA-256 is invalid")

        self._staging_dir.mkdir(parents=True, exist_ok=True)
        with ExitStack() as cleanup:
            try:
                remote = self._store.open_quarantine(reference.key, reference.version_id)
            except Exception as exc:
                raise ObjectStorageError("quarantine object could not be opened") from exc
            cleanup.callback(remote.close)

            with tempfile.NamedTemporaryFile(
                mode="w+b", prefix="doul-evidence-read-", dir=self._staging_dir, delete=True
            ) as staged:
                try:
                    digest = hashlib.sha256()
                    byte_count = 0
                    while True:
                        block = remote.read(self._read_size)
                        if block in (b"", None):
                            break
                        if not isinstance(block, (bytes, bytearray, memoryview)):
                            raise TypeError("object stream must return bytes")
                        if not block:
                            break
                        if len(block) > self._read_size:
                            raise UploadValidationError("object stream exceeded bounded read size")
                        byte_count += len(block)
                        if byte_count > reference.byte_count or byte_count > self._max_bytes:
                            raise UploadValidationError("stored object exceeds declared size")
                        digest.update(block)
                        staged.write(block)

                    if byte_count != reference.byte_count:
                        raise UploadValidationError("stored object size does not match reference")
                    if digest.hexdigest() != reference.sha256.lower():
                        raise UploadValidationError("stored object SHA-256 does not match reference")
                except (UploadValidationError, ValueError, TypeError):
                    raise
                except Exception as exc:
                    raise ObjectStorageError("quarantine object read failed") from exc

                # Close the remote response before exposing the verified local file.
                cleanup.close()
                staged.flush()
                staged.seek(0)
                yield staged

    def store_verified(
        self,
        project_id: str,
        upload_id: str,
        source: BinaryIO,
        *,
        expected_bytes: int,
        expected_sha256: str,
        content_type: str = "application/octet-stream",
    ) -> QuarantinedObject:
        """Validate the complete original stream and persist it as quarantined.

        The content type is descriptive only. Callers must independently sniff
        and validate media type before any later evidence-finalization step.
        """
        if not isinstance(project_id, str) or not self._UPLOAD_ID.fullmatch(project_id):
            raise ValueError("project_id must be an opaque safe identifier")
        if not isinstance(upload_id, str) or not self._UPLOAD_ID.fullmatch(upload_id):
            raise ValueError("upload_id must be an opaque safe identifier")
        if isinstance(expected_bytes, bool) or not isinstance(expected_bytes, int) or expected_bytes < 0:
            raise ValueError("expected_bytes must be a non-negative integer")
        if expected_bytes > self._max_bytes:
            raise UploadValidationError("upload exceeds configured maximum")
        if not self._SHA256.fullmatch(expected_sha256):
            raise ValueError("expected_sha256 must be a hexadecimal SHA-256")
        if (
            not isinstance(content_type, str)
            or not content_type
            or len(content_type) > 255
            or any(ch in content_type for ch in "\r\n")
        ):
            raise ValueError("content_type is invalid")

        expected_digest = expected_sha256.lower()
        digest = hashlib.sha256()
        byte_count = 0
        self._staging_dir.mkdir(parents=True, exist_ok=True)

        # NamedTemporaryFile is disk-backed; memory held by this loop is one
        # configured read chunk at a time, independent of total object size.
        with tempfile.NamedTemporaryFile(
            mode="w+b", prefix="doul-evidence-", dir=self._staging_dir, delete=True
        ) as staged:
            while True:
                block = source.read(self._read_size)
                if block in (b"", None):
                    break
                if not isinstance(block, (bytes, bytearray, memoryview)):
                    raise TypeError("source.read() must return bytes")
                if not block:
                    break
                if len(block) > self._read_size:
                    raise UploadValidationError("source stream exceeded bounded read size")
                byte_count += len(block)
                if byte_count > expected_bytes or byte_count > self._max_bytes:
                    raise UploadValidationError("stream exceeds declared or configured size")
                digest.update(block)
                staged.write(block)

            actual_digest = digest.hexdigest()
            if byte_count != expected_bytes:
                raise UploadValidationError("stream size does not match declaration")
            if actual_digest != expected_digest:
                raise UploadValidationError("stream SHA-256 does not match declaration")

            staged.flush()
            staged.seek(0)
            object_key = (
                f"{self._key_prefix}/{project_id}/{upload_id}/original"
            )
            try:
                version_id = self._store.put_quarantine(
                    object_key,
                    staged,
                    content_length=byte_count,
                    content_type=content_type,
                    sha256=actual_digest,
                )
            except ObjectStorageError:
                raise
            except Exception as exc:
                # Do not report success or try to delete: a remote timeout may
                # have an uncertain outcome. Deterministic retry + reconciliation
                # handles that state without inventing an official record.
                raise UploadReconciliationRequired("quarantine persistence was not confirmed") from exc

        return QuarantinedObject(
            project_id=project_id,
            key=object_key,
            version_id=version_id,
            byte_count=byte_count,
            sha256=actual_digest,
            content_type=content_type,
        )
