"""Promote an actor-owned quarantine original into canonical Evidence.

Registration preserves the original bytes and provenance. It does not attach
Evidence to a business record; downstream commands receive explicit evidenceIds.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from typing import Callable
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.reference.validation import ContractError, require
from .test_routes import LocalFilesystemQuarantineStore

MAX_REGISTER_BYTES = 20 * 1024 * 1024
_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


def _fail(code: str, message: str, status: int):
    return JSONResponse({"code": code, "message": message, "failedGuards": [code]}, status_code=status)


def install_evidence_registration_routes(
    app: FastAPI,
    *,
    store,
    get_actor: Callable,
    get_role: Callable,
    key_for: Callable,
    quarantine_root: str | Path,
    sniff: Callable[[bytes], str],
    max_bytes: int = MAX_REGISTER_BYTES,
) -> None:
    """Install authenticated quarantine-to-Evidence registration.

    Host callbacks preserve the application's session, role and idempotency
    rules. Quarantine lookup is actor and project scoped by the local adapter.
    """
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or not 0 < max_bytes <= MAX_REGISTER_BYTES:
        raise ValueError("max_bytes must be between 1 byte and 20 MiB")

    @app.post("/projects/{project_id}/parallel/evidence-quarantine/register")
    async def register_quarantined_evidence(project_id: str, request: Request):
        try:
            actor = get_actor(request)
            role = get_role(project_id, request, actor)
            require(role.get("projectId") == project_id, "PROJECT_MISMATCH", "Project unavailable")
            actor_id = actor.get("partyId")
            require(isinstance(actor_id, str) and actor_id, "UNAUTHENTICATED", "Session actor unavailable")
            require("create_evidence" in role.get("authorityCodes", []), "NOT_AUTHORIZED", "Role cannot register evidence")
            body = await request.json()
            require(isinstance(body, dict), "INVALID_REQUEST", "Expected a JSON object")
            expected_keys = {"roleAssignmentId", "quarantineKey", "sha256", "sourcePartyId", "fileName",
                             "discipline", "packageId", "locationId"}
            require(set(body) == expected_keys, "INVALID_REQUEST", "Registration fields are incomplete or unexpected")
            require(body["roleAssignmentId"] == role.get("id"), "NOT_AUTHORIZED", "Role assignment does not match session")
            digest = body["sha256"]
            require(isinstance(digest, str) and bool(_SHA256.fullmatch(digest)), "INVALID_REQUEST", "SHA-256 is required")
            quarantine_key = body["quarantineKey"]
            require(isinstance(quarantine_key, str), "INVALID_REQUEST", "Quarantine reference is required")
            qstore = LocalFilesystemQuarantineStore(quarantine_root, project_id, actor_id)
            entry = next((row for row in qstore.list_quarantine() if row.get("key") == quarantine_key), None)
            require(entry is not None, "NOT_FOUND", "Quarantined object is unavailable")
            require(entry.get("status") == "quarantined", "QUARANTINE_INVALID", "Object is not available for registration")
            keyparts = quarantine_key.split("/")
            require(len(keyparts) == 4 and keyparts[0] == "evidence" and keyparts[1] == project_id,
                    "PROJECT_MISMATCH", "Quarantine object belongs to a different project")
            require(entry.get("sha256", "").lower() == digest.lower(), "CHECKSUM_MISMATCH", "Quarantine checksum differs")
            size = entry.get("byteCount")
            require(type(size) is int and 0 < size <= max_bytes, "PAYLOAD_TOO_LARGE", "Evidence must be between 1 byte and 20 MiB")
            content = bytearray()
            with qstore.open_quarantine(quarantine_key) as stream:
                while True:
                    chunk = stream.read(min(1024 * 1024, max_bytes + 1 - len(content)))
                    if not chunk:
                        break
                    content.extend(chunk)
                    require(len(content) <= max_bytes, "PAYLOAD_TOO_LARGE", "Evidence exceeds 20 MiB")
            require(len(content) == size, "UPLOAD_SIZE_MISMATCH", "Quarantine size changed")
            actual_hash = hashlib.sha256(content).hexdigest()
            require(actual_hash == digest.lower(), "CHECKSUM_MISMATCH", "Server checksum verification failed")
            mime = sniff(bytes(content))
            require(mime.startswith("image/") or mime == "application/pdf", "MIME_INVALID", "Registration accepts image and PDF evidence")
            require(entry.get("contentType") in {mime, "application/octet-stream"}, "MIME_INVALID", "Quarantine content type differs from file bytes")
            source = store.engine.get("Party", body["sourcePartyId"])
            require(source.get("projectId") == project_id, "PROJECT_MISMATCH", "Source party unavailable")
            require(all(isinstance(body[k], str) and body[k].strip() for k in
                        ("discipline", "packageId", "locationId", "fileName")), "INVALID_REQUEST", "Evidence scope and file name are required")
            name = Path(body["fileName"]).name
            require(name and len(name) <= 255, "INVALID_REQUEST", "File name is invalid")
            scope = dict(
                discipline=body["discipline"], packageId=body["packageId"],
                locationId=body["locationId"],
                responsibleOrganizationId=role.get("organizationId") if role.get("actorGroup") == "CON"
                else store.meta["scope"]["responsibleOrganizationId"],
            )
            store.engine.authorize(dict(projectId=project_id, **scope), "create_evidence", actor_id, role["id"])
            idem_key = key_for(request)
            fingerprint_body = {**body, "projectId": project_id, "actorId": actor_id}
            fingerprint = hashlib.sha256(json.dumps(fingerprint_body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            request_key = f"evidence-register:{project_id}:{actor_id}:{idem_key}"
            with store.transaction(True):
                cached = store.requests.get(request_key)
                if cached:
                    require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Registration request changed")
                    return store.engine.get("Evidence", cached["id"])
                file_id = str(uuid4())
                media_type = "photo" if mime.startswith("image/") else "document"
                payload = dict(
                    sourceType="original", mediaType=media_type, fileId=file_id,
                    fileHash=actual_hash, sourcePartyId=body["sourcePartyId"],
                    metadata={"name": name, "mimeType": mime, "byteCount": len(content)},
                    **scope,
                )
                result = store.engine.add_evidence(file_id, project_id, payload, bytes(content), actor_id, role["id"], idem_key)
                store.put_blob(file_id, bytes(content))
                record = result["record"]
                store.requests[request_key] = {"hash": fingerprint, "id": record["id"]}
                return JSONResponse(record, status_code=201)
        except ContractError as exc:
            code = exc.code
            status = 401 if code == "UNAUTHENTICATED" else 403 if code == "NOT_AUTHORIZED" else 404 if code in {"NOT_FOUND", "PROJECT_MISMATCH"} else 413 if code == "PAYLOAD_TOO_LARGE" else 422
            return _fail(code, str(exc), status)
        except (ValueError, OSError, json.JSONDecodeError):
            return _fail("INVALID_REQUEST", "Registration request or quarantine object is invalid", 422)
