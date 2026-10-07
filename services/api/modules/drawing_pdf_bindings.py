"""Append-only technical links between exact Drawing and PDF Evidence versions.

This demo index adds no workflow state to canonical records. It stores exact,
authorized source references and leaves both source records untouched.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
from typing import Callable
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from app.reference.validation import ContractError, require

MAX_BINDING_KEY = 160
MAX_PDF_BYTES = 20 * 1024 * 1024
_HEX = re.compile(r"^[0-9a-f]{64}$")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
MAX_LIST_ITEMS = 500


def _error(code: str, message: str, status: int):
    return JSONResponse({"code": code, "message": message, "failedGuards": [code]}, status_code=status)


def _domain_ref(value):
    return (isinstance(value, dict) and set(value) == {"objectType", "objectId", "version"}
            and isinstance(value.get("objectId"), str) and bool(_UUID.fullmatch(value["objectId"]))
            and isinstance(value.get("version"), int) and not isinstance(value.get("version"), bool)
            and value["version"] >= 1)


def _fingerprint(project_id, actor_id, body):
    data = {"projectId": project_id, "actorId": actor_id, **body}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def install_drawing_pdf_binding_routes(
    app: FastAPI,
    store,
    *,
    identity: Callable,
    role_for: Callable,
    key_for: Callable,
    demo_enabled: bool,
) -> None:
    """Install explicit demo-admin endpoints for immutable source binding."""

    def authorize_source(engine, record, actor, role):
        engine.authorize_read(record, actor["partyId"], role["id"])

    @app.get("/projects/{project_id}/parallel/drawing-pdf-bindings")
    def list_bindings(project_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction():
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                bindings = []
                for binding in store.meta.get("drawingPdfBindings", [])[-MAX_LIST_ITEMS:]:
                    if binding.get("projectId") != project_id:
                        continue
                    try:
                        drawing = store.engine.resolve(binding["drawingRef"], project_id)
                        evidence = store.engine.resolve(binding["evidenceRef"], project_id)
                        if drawing.get("subtype") != "Drawing":
                            continue
                        authorize_source(store.engine, drawing, actor, role)
                        authorize_source(store.engine, evidence, actor, role)
                    except (ContractError, KeyError):
                        continue
                    bindings.append(deepcopy(binding))
                return {"items": bindings}
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 403 if exc.code == "NOT_AUTHORIZED" else 404
            return _error(exc.code, str(exc), status)

    @app.get("/projects/{project_id}/parallel/drawing-pdf-bindings/{binding_id}/content")
    def binding_content(project_id: str, binding_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction():
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                binding = next((item for item in store.meta.get("drawingPdfBindings", [])
                                if item.get("id") == binding_id and item.get("projectId") == project_id), None)
                if binding is None:
                    return _error("NOT_FOUND", "PDF content unavailable", 404)
                try:
                    drawing = store.engine.resolve(binding["drawingRef"], project_id)
                    evidence = store.engine.resolve(binding["evidenceRef"], project_id)
                    if drawing.get("subtype") != "Drawing":
                        return _error("NOT_FOUND", "PDF content unavailable", 404)
                    authorize_source(store.engine, drawing, actor, role)
                    authorize_source(store.engine, evidence, actor, role)
                    content = store.blob(evidence["fileId"])
                    actual_hash = hashlib.sha256(content).hexdigest()
                    if (evidence.get("sourceType") != "original" or evidence.get("mediaType") != "document"
                            or (evidence.get("metadata") or {}).get("mimeType") != "application/pdf"
                            or actual_hash != binding.get("fileHash") or actual_hash != evidence.get("fileHash")
                            or not content.startswith(b"%PDF-") or len(content) > MAX_PDF_BYTES):
                        return _error("NOT_FOUND", "PDF content unavailable", 404)
                except (ContractError, KeyError, OSError):
                    return _error("NOT_FOUND", "PDF content unavailable", 404)
                return Response(content, media_type="application/pdf", headers={
                    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                })
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 404
            return _error("NOT_FOUND" if status == 404 else exc.code,
                          "PDF content unavailable" if status == 404 else str(exc), status)

    @app.post("/projects/{project_id}/parallel/drawing-pdf-bindings")
    async def create_binding(project_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "PDF drawing binding is available only in demo mode")
            actor = identity(request)
            body = await request.json()
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                require(actor.get("actorGroup") == "ADM" and role.get("actorGroup") == "ADM"
                        and role.get("roleCode") == "project_admin",
                        "NOT_AUTHORIZED", "Only the demo project administrator can bind drawing PDFs")
                require("render_document" in role.get("authorityCodes", []),
                        "NOT_AUTHORIZED", "Document rendering authority is required")
                require(role.get("projectId") == project_id, "PROJECT_MISMATCH", "Project unavailable")
                require(isinstance(body, dict) and set(body) == {"drawingRef", "evidenceRef"},
                        "INVALID_REQUEST", "Expected drawingRef and evidenceRef")
                drawing_ref, evidence_ref = body["drawingRef"], body["evidenceRef"]
                require(_domain_ref(drawing_ref) and drawing_ref.get("objectType") == "InformationItem",
                        "REFERENCE_TYPE_INVALID", "Drawing ref must identify an InformationItem version")
                require(_domain_ref(evidence_ref) and evidence_ref.get("objectType") == "Evidence",
                        "REFERENCE_TYPE_INVALID", "Evidence ref must identify an Evidence version")
                drawing = store.engine.resolve(drawing_ref, project_id)
                evidence = store.engine.resolve(evidence_ref, project_id)
                require(drawing.get("subtype") == "Drawing", "REFERENCE_TYPE_INVALID", "Source must be a Drawing")
                require(evidence.get("sourceType") == "original" and evidence.get("mediaType") == "document"
                        and (evidence.get("metadata") or {}).get("mimeType") == "application/pdf",
                        "EVIDENCE_INVALID", "Evidence must be an original PDF document")
                authorize_source(store.engine, drawing, actor, role)
                authorize_source(store.engine, evidence, actor, role)
                content = store.blob(evidence["fileId"])
                require(0 < len(content) <= MAX_PDF_BYTES, "PAYLOAD_TOO_LARGE", "PDF must be 20 MiB or smaller")
                file_hash = hashlib.sha256(content).hexdigest()
                require(bool(_HEX.fullmatch(evidence.get("fileHash", ""))) and file_hash == evidence["fileHash"],
                        "CHECKSUM_MISMATCH", "PDF content hash does not match Evidence")
                require(content.startswith(b"%PDF-"), "MIME_INVALID", "PDF signature is missing")
                idem_key = key_for(request)
                require(isinstance(idem_key, str) and 0 < len(idem_key) <= MAX_BINDING_KEY,
                        "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
                fingerprint = _fingerprint(project_id, actor["partyId"], body)
                request_key = f"drawing-pdf-binding:{project_id}:{actor['partyId']}:{idem_key}"
                cached = store.requests.get(request_key)
                if cached:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Binding request changed")
                    found = next((item for item in store.meta.get("drawingPdfBindings", []) if item.get("id") == cached.get("id")), None)
                    require(found is not None, "IDEMPOTENCY_CONFLICT", "Binding replay is unavailable")
                    return JSONResponse(deepcopy(found), status_code=200)

                bindings = store.meta.setdefault("drawingPdfBindings", [])
                existing = next((item for item in bindings if item.get("projectId") == project_id
                                 and item.get("drawingRef") == drawing_ref), None)
                if existing:
                    require(existing.get("evidenceRef") == evidence_ref and existing.get("fileHash") == file_hash,
                            "BINDING_CONFLICT", "This exact drawing revision is already bound to different PDF evidence")
                    store.requests[request_key] = {"hash": fingerprint, "id": existing["id"]}
                    return JSONResponse(deepcopy(existing), status_code=200)

                binding = {
                    "id": str(uuid4()),
                    "projectId": project_id,
                    "drawingRef": deepcopy(drawing_ref),
                    "evidenceRef": deepcopy(evidence_ref),
                    "fileHash": file_hash,
                    "createdAt": store.engine.at(),
                    "createdBy": actor["partyId"],
                }
                bindings.append(binding)
                store.requests[request_key] = {"hash": fingerprint, "id": binding["id"]}
                store.meta.setdefault("drawingPdfBindingAudit", []).append({
                    "event": "drawing_pdf_bound",
                    "bindingId": binding["id"],
                    "projectId": project_id,
                    "drawingRef": deepcopy(drawing_ref),
                    "evidenceRef": deepcopy(evidence_ref),
                    "fileHash": file_hash,
                    "actorPartyId": actor["partyId"],
                    "roleAssignmentId": role["id"],
                    "createdAt": binding["createdAt"],
                })
                return JSONResponse(binding, status_code=201)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code in {"NOT_AUTHORIZED", "DEMO_ONLY"}
                      else 404 if code in {"NOT_FOUND", "PROJECT_MISMATCH", "OBJECT_NOT_FOUND"}
                      else 409 if code in {"IDEMPOTENCY_CONFLICT", "BINDING_CONFLICT", "REFERENCE_STALE"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status)
        except (KeyError, ValueError, OSError, json.JSONDecodeError):
            return _error("INVALID_REQUEST", "Binding request or source file is invalid", 422)
