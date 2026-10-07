"""Demo-only authenticated HTTP routes for original evidence quarantine.

Uploads are kept private on local disk and remain quarantined. This adapter
creates no Evidence record and must not be used as production object storage.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from typing import BinaryIO, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.reference.validation import ContractError, require
from .storage import StreamingQuarantineUploader, UploadValidationError

DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
_UPLOAD_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


class LocalFilesystemQuarantineStore:
    """Private demo adapter with objects isolated by project and owning actor."""

    def __init__(self, root: str | os.PathLike[str], project_id: str, actor_id: str):
        if not _UPLOAD_ID.fullmatch(project_id) or not _UPLOAD_ID.fullmatch(actor_id):
            raise ValueError("project and actor IDs must be safe opaque IDs")
        self.root = Path(root).resolve() / project_id / actor_id

    def _target(self, key: str) -> Path:
        parts = key.split("/")
        if (len(parts) != 4 or parts[0] != "evidence" or
                any(not _UPLOAD_ID.fullmatch(p) for p in parts[1:3]) or
                not _SHA256.fullmatch(parts[3])):
            raise ValueError("unsafe quarantine key")
        path = self.root / parts[2] / (parts[3].lower() + ".blob")
        if not path.resolve().is_relative_to(self.root):
            raise ValueError("quarantine path escaped root")
        return path

    def put_quarantine(self, key: str, body: BinaryIO, *, content_length: int,
                       content_type: str, sha256: str) -> str | None:
        target = self._target(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        sidecar_temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w+b", prefix=f".{target.name}.", suffix=".tmp",
                dir=target.parent, delete=False,
            ) as output:
                temporary = Path(output.name)
                shutil.copyfileobj(body, output, length=1024 * 1024)
            if temporary.stat().st_size != content_length:
                raise OSError("quarantine write length mismatch")
            os.replace(temporary, target)
            sidecar = target.with_suffix(".json")
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", prefix=f".{sidecar.name}.", suffix=".tmp",
                dir=target.parent, delete=False,
            ) as metadata:
                sidecar_temporary = Path(metadata.name)
                json.dump({
                    "key": key, "contentType": content_type, "byteCount": content_length,
                    "sha256": sha256.lower(), "status": "quarantined",
                }, metadata)
            os.replace(sidecar_temporary, sidecar)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            if sidecar_temporary is not None:
                sidecar_temporary.unlink(missing_ok=True)
        return None

    def open_quarantine(self, key: str, version_id: str | None = None) -> BinaryIO:
        return self._target(key).open("rb")

    def list_quarantine(self) -> list[dict]:
        values = []
        if not self.root.exists():
            return values
        for sidecar in self.root.glob("*/[0-9a-fA-F]*.json"):
            try:
                entry = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(entry, dict) and (sidecar.with_suffix(".blob")).is_file():
                values.append(entry)
        return sorted(values, key=lambda item: (item.get("key", "")))


def _fail(code: str, message: str, status: int):
    return JSONResponse({"code": code, "message": message, "failedGuards": [code]}, status_code=status)


def install_evidence_quarantine_routes(
    app: FastAPI,
    *,
    get_actor: Callable,
    get_role: Callable,
    quarantine_root: str | os.PathLike[str],
    staging_root: str | os.PathLike[str],
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
) -> None:
    """Register project-scoped upload and owner-filtered listing routes.

    `get_actor(request)` and `get_role(project_id, request, actor)` are supplied
    by the host so the normal authenticated session and current project role
    validation are reused. Upload bytes are streamed to disk in bounded chunks.
    """
    if isinstance(max_upload_bytes, bool) or not isinstance(max_upload_bytes, int) or max_upload_bytes <= 0:
        raise ValueError("max_upload_bytes must be a positive integer")

    @app.post("/projects/{project_id}/parallel/evidence-quarantine")
    async def upload_evidence_quarantine(project_id: str, request: Request):
        try:
            actor = get_actor(request)
            role = get_role(project_id, request, actor)
            require(role.get("projectId") == project_id, "PROJECT_MISMATCH", "Project unavailable")
            actor_id = actor.get("partyId")
            require(isinstance(actor_id, str) and bool(actor_id), "UNAUTHENTICATED", "Session actor unavailable")
            # This demo endpoint only accepts roles already granted the existing create_evidence authority.
            require("create_evidence" in role.get("authorityCodes", []), "NOT_AUTHORIZED", "Role cannot upload evidence")

            upload_id = request.headers.get("x-upload-id", "")
            size_header = request.headers.get("x-upload-size", "")
            digest = request.headers.get("x-upload-sha256", "")
            require(bool(_UPLOAD_ID.fullmatch(upload_id)), "INVALID_REQUEST", "X-Upload-Id is required")
            require(size_header.isascii() and size_header.isdecimal(), "INVALID_REQUEST", "X-Upload-Size must be an integer")
            expected_bytes = int(size_header)
            require(expected_bytes <= max_upload_bytes, "PAYLOAD_TOO_LARGE", "Upload exceeds the configured maximum")
            require(bool(_SHA256.fullmatch(digest)), "INVALID_REQUEST", "X-Upload-SHA256 must be hexadecimal SHA-256")
            content_length = request.headers.get("content-length")
            require(content_length is not None and content_length.isdecimal(), "INVALID_REQUEST", "Content-Length is required")
            require(int(content_length) == expected_bytes, "UPLOAD_SIZE_MISMATCH", "Content-Length differs from X-Upload-Size")
            content_type = request.headers.get("content-type", "application/octet-stream")
            require(len(content_type) <= 255 and "\r" not in content_type and "\n" not in content_type,
                    "INVALID_REQUEST", "Content-Type is invalid")

            project_store = LocalFilesystemQuarantineStore(quarantine_root, project_id, actor_id)
            uploader = StreamingQuarantineUploader(
                project_store, Path(staging_root) / project_id / actor_id,
                max_bytes=max_upload_bytes, read_size=1024 * 1024,
            )
            staged_path = None
            received = 0
            try:
                Path(staging_root).mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(mode="w+b", prefix="doul-evidence-http-",
                                                 dir=staging_root, delete=False) as staged:
                    staged_path = Path(staged.name)
                    async for chunk in request.stream():
                        if not chunk:
                            continue
                        received += len(chunk)
                        if received > max_upload_bytes or received > expected_bytes:
                            return _fail("PAYLOAD_TOO_LARGE", "Request exceeds the declared upload size", 413)
                        staged.write(chunk)
                    staged.flush()
                    if received != expected_bytes:
                        return _fail("UPLOAD_SIZE_MISMATCH", "Stream size differs from X-Upload-Size", 400)
                    staged.seek(0)
                    try:
                        stored = uploader.store_verified(
                            project_id, upload_id, staged, expected_bytes=expected_bytes,
                            expected_sha256=digest, content_type=content_type,
                        )
                    except UploadValidationError as exc:
                        return _fail("UPLOAD_INVALID", str(exc), 400)
            finally:
                if staged_path is not None:
                    staged_path.unlink(missing_ok=True)
            return {"projectId": stored.project_id, "uploadId": upload_id,
                    "byteCount": stored.byte_count, "sha256": stored.sha256,
                    "contentType": stored.content_type, "status": "quarantined"}
        except ContractError as exc:
            code = exc.code
            status = 401 if code == "UNAUTHENTICATED" else 403 if code == "NOT_AUTHORIZED" else 404 if code == "PROJECT_MISMATCH" else 413 if code == "PAYLOAD_TOO_LARGE" else 422
            return _fail(code, str(exc), status)

    @app.get("/projects/{project_id}/parallel/evidence-quarantine")
    def list_evidence_quarantine(project_id: str, request: Request):
        try:
            actor = get_actor(request)
            role = get_role(project_id, request, actor)
            require(role.get("projectId") == project_id, "PROJECT_MISMATCH", "Project unavailable")
            actor_id = actor.get("partyId")
            require(isinstance(actor_id, str) and bool(actor_id), "UNAUTHENTICATED", "Session actor unavailable")
            store = LocalFilesystemQuarantineStore(quarantine_root, project_id, actor_id)
            return {"projectId": project_id, "items": store.list_quarantine()}
        except ContractError as exc:
            code = exc.code
            status = 401 if code == "UNAUTHENTICATED" else 403 if code == "NOT_AUTHORIZED" else 404 if code == "PROJECT_MISMATCH" else 422
            return _fail(code, str(exc), status)
