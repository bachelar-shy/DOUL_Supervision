"""Append-only PDF markup metadata and drawing-markup issue links for demos."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import re
from typing import Callable, Optional
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.reference.validation import ContractError, require
from services.api.application import create_issue_package

MAX_BODY_BYTES = 16 * 1024
MAX_KEY_LENGTH = 160
MAX_PAGE = 100_000
MAX_COORD = 10_000_000
MAX_TEXT = 2_000
MAX_PER_BINDING = 1_000
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


def _error(code: str, message: str, status: int):
    return JSONResponse({"code": code, "message": message, "failedGuards": [code]}, status_code=status)


def _valid_uuid(value):
    return isinstance(value, str) and bool(_UUID.fullmatch(value))


def _positive_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _domain_ref(value, object_type):
    return (isinstance(value, dict) and set(value) == {"objectType", "objectId", "version"}
            and value.get("objectType") == object_type and _valid_uuid(value.get("objectId"))
            and _positive_int(value.get("version")))


def _fingerprint(project_id, actor_id, operation, body):
    data = {"projectId": project_id, "actorId": actor_id, "operation": operation, "body": body}
    serialized = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(serialized.encode()).hexdigest()


def _parse_constant(_value):
    raise ValueError("Non-finite JSON number")


async def _json_body(request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        require(len(raw) + len(chunk) <= MAX_BODY_BYTES, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB")
        raw.extend(chunk)
    try:
        value = json.loads(bytes(raw).decode("utf-8"), parse_constant=_parse_constant)
    except (UnicodeDecodeError, ValueError):
        raise ContractError("INVALID_REQUEST", "Expected valid JSON")
    require(isinstance(value, dict), "INVALID_REQUEST", "Expected a JSON object")
    return value


def _markup_write_role(actor, role, project_id):
    require(actor.get("actorGroup") == "ADM" and role.get("actorGroup") == "ADM"
            and role.get("roleCode") == "project_admin", "NOT_AUTHORIZED", "Demo project administrator required")
    require("render_document" in role.get("authorityCodes", []), "NOT_AUTHORIZED", "Document rendering authority required")
    require(role.get("projectId") == project_id, "NOT_AUTHORIZED", "Project role unavailable")


def _resolve_binding(store, project_id, binding_id, actor, role):
    binding = next((item for item in store.meta.get("drawingPdfBindings", [])
                    if item.get("id") == binding_id and item.get("projectId") == project_id), None)
    require(binding is not None, "NOT_FOUND", "Markup source unavailable")
    drawing_ref, evidence_ref = binding.get("drawingRef"), binding.get("evidenceRef")
    require(_domain_ref(drawing_ref, "InformationItem") and _domain_ref(evidence_ref, "Evidence"),
            "NOT_FOUND", "Markup source unavailable")
    drawing = store.engine.resolve(drawing_ref, project_id)
    evidence = store.engine.resolve(evidence_ref, project_id)
    require(drawing.get("subtype") == "Drawing", "NOT_FOUND", "Markup source unavailable")
    require(evidence.get("sourceType") == "original" and evidence.get("mediaType") == "document"
            and (evidence.get("metadata") or {}).get("mimeType") == "application/pdf",
            "NOT_FOUND", "Markup source unavailable")
    store.engine.authorize_read(drawing, actor["partyId"], role["id"])
    store.engine.authorize_read(evidence, actor["partyId"], role["id"])
    return binding, drawing, evidence


def _safe_issue_link(store, link, actor, role):
    if not isinstance(link, dict):
        return None
    try:
        issue = store.engine.get("Issue", link["issueRef"]["objectId"])
        action = store.engine.get("Action", link["actionRef"]["objectId"])
        store.engine.authorize_read(issue, actor["partyId"], role["id"])
        store.engine.authorize_read(action, actor["partyId"], role["id"])
        return deepcopy(link)
    except (ContractError, KeyError, TypeError):
        return None


def _visible_markup(store, markup, actor, role):
    result = deepcopy(markup)
    link = next((item for item in store.meta.get("drawingMarkupIssueLinks", [])
                 if item.get("markupId") == markup.get("id")), None)
    visible = _safe_issue_link(store, link, actor, role)
    if visible is not None:
        result["issueLink"] = visible
    else:
        result.pop("issueLink", None)
    return result


def _markup_history(store, markup):
    history = store.meta.setdefault("drawingMarkupHistory", [])
    items = [item for item in history if item.get("markupId") == markup.get("id")
             and item.get("projectId") == markup.get("projectId")]
    if not items:
        snapshot = deepcopy(markup)
        history.append({"markupId": markup["id"], "projectId": markup["projectId"],
                        "version": markup["version"], "snapshot": snapshot,
                        "createdAt": markup.get("createdAt"), "createdBy": markup.get("createdBy"),
                        "reason": "Initial markup"})
        items = [history[-1]]
    items.sort(key=lambda item: item.get("version", 0))
    return items


def _markup_commands(actor, role, markup):
    editable = (markup.get("deletedAt") is None and actor.get("actorGroup") == "ADM"
                and role.get("actorGroup") == "ADM" and role.get("roleCode") == "project_admin"
                and "render_document" in role.get("authorityCodes", []))
    if editable:
        return [{"command": "edit", "label": "Edit"}, {"command": "delete", "label": "Delete"}]
    return []


def _markup_projection(store, markup, actor, role, demo_enabled=True):
    result = _visible_markup(store, markup, actor, role)
    history = _markup_history(store, markup)
    result["historySummary"] = {"count": len(history), "latestVersion": history[-1]["version"]}
    result["availableCommands"] = _markup_commands(actor, role, markup) if demo_enabled else []
    return result


def _authorized_markup_replay(response, store, actor, role):
    result = deepcopy(response)
    link = result.get("issueLink")
    if link is not None and _safe_issue_link(store, link, actor, role) is None:
        result.pop("issueLink", None)
    return result


def _markup_audit(store, event, markup, actor, role, before, after, reason):
    store.meta.setdefault("drawingMarkupAudit", []).append({
        "event": event, "markupId": markup["id"], "projectId": markup["projectId"],
        "bindingId": markup["bindingId"], "beforeRef": {"objectType": "DrawingMarkup", "objectId": markup["id"], "version": before},
        "afterRef": {"objectType": "DrawingMarkup", "objectId": markup["id"], "version": after},
        "reason": reason, "actorPartyId": actor["partyId"], "roleAssignmentId": role["id"],
        "createdAt": store.engine.at(),
    })


def _check_current_ref(store, reference, object_type, project_id):
    require(_domain_ref(reference, object_type), "REFERENCE_INVALID", f"Expected current {object_type} reference")
    record = store.engine.resolve(reference, project_id)
    current = store.engine.get(object_type, reference["objectId"])
    require(current.get("version") == reference["version"], "REFERENCE_STALE", "Source version is stale")
    return record


def _iso_datetime(value):
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None and parsed.utcoffset() is not None


def _authorize_markup_source(store, project_id, markup, actor, role):
    binding, drawing, evidence = _resolve_binding(store, project_id, markup.get("bindingId"), actor, role)
    require(markup.get("drawingRef") == binding.get("drawingRef")
            and markup.get("evidenceRef") == binding.get("evidenceRef"),
            "NOT_FOUND", "Markup source unavailable")
    return binding, drawing, evidence


def install_drawing_markup_routes(
    app: FastAPI,
    store,
    *,
    identity: Callable,
    role_for: Callable,
    key_for: Callable,
    demo_enabled: bool,
) -> None:
    """Install authenticated markup and issue-link endpoints."""

    @app.get("/projects/{project_id}/parallel/drawing-markups")
    def list_markups(project_id: str, request: Request, bindingId: Optional[str] = None):
        try:
            actor = identity(request)
            require(_valid_uuid(bindingId), "INVALID_REQUEST", "bindingId must be a UUID")
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                try:
                    _resolve_binding(store, project_id, bindingId, actor, role)
                except ContractError:
                    return _error("NOT_FOUND", "Markup source unavailable", 404)
                items = [
                    _markup_projection(store, item, actor, role, demo_enabled)
                    for item in store.meta.get("drawingMarkups", [])
                    if item.get("projectId") == project_id and item.get("bindingId") == bindingId
                    and item.get("deletedAt") is None
                ]
                return {"items": items}
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 404
            return _error(exc.code, str(exc), status)

    @app.get("/projects/{project_id}/parallel/drawing-markups/{markup_id}")
    def get_markup(project_id: str, markup_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                markup = next((item for item in store.meta.get("drawingMarkups", [])
                               if item.get("id") == markup_id and item.get("projectId") == project_id), None)
                if markup is None:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                try:
                    _authorize_markup_source(store, project_id, markup, actor, role)
                except ContractError:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                return _markup_projection(store, markup, actor, role, demo_enabled)
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 404
            return _error(exc.code, str(exc), status)

    @app.get("/projects/{project_id}/parallel/drawing-markups/{markup_id}/history")
    def get_markup_history(project_id: str, markup_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                markup = next((item for item in store.meta.get("drawingMarkups", [])
                               if item.get("id") == markup_id and item.get("projectId") == project_id), None)
                if markup is None:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                try:
                    _authorize_markup_source(store, project_id, markup, actor, role)
                except ContractError:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                items = _markup_history(store, markup)
                return {"items": [deepcopy(item["snapshot"]) for item in items]}
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 404
            return _error(exc.code, str(exc), status)

    @app.put("/projects/{project_id}/parallel/drawing-markups/{markup_id}")
    async def edit_markup(project_id: str, markup_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "Drawing markup edits are demo only")
            actor = identity(request)
            body = await _json_body(request)
            require(set(body) == {"expectedVersion", "text", "rect", "reason"},
                    "INVALID_REQUEST", "Unexpected or missing markup edit fields")
            require(_positive_int(body.get("expectedVersion")), "INVALID_REQUEST", "expectedVersion must be positive")
            require(isinstance(body.get("text"), str), "INVALID_REQUEST", "text must be plain text")
            text = body["text"].strip()
            require(0 < len(text) <= MAX_TEXT, "INVALID_REQUEST", "text must contain 1 to 2000 characters")
            rect = body.get("rect")
            require(isinstance(rect, dict) and set(rect) == {"x1", "y1", "x2", "y2"},
                    "INVALID_REQUEST", "rect must contain exactly x1, y1, x2 and y2")
            for coordinate in rect.values():
                require(isinstance(coordinate, (int, float)) and not isinstance(coordinate, bool)
                        and -MAX_COORD <= coordinate <= MAX_COORD and math.isfinite(coordinate),
                        "INVALID_REQUEST", "Rectangle coordinates must be finite bounded numbers")
            require(rect["x1"] < rect["x2"] and rect["y1"] < rect["y2"],
                    "INVALID_REQUEST", "Rectangle must have positive width and height")
            require(isinstance(body.get("reason"), str), "INVALID_REQUEST", "reason must be text")
            reason = body["reason"].strip()
            require(0 < len(reason) <= 500, "INVALID_REQUEST", "reason must contain 1 to 500 characters")
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key) <= MAX_KEY_LENGTH,
                    "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                _markup_write_role(actor, role, project_id)
                markup = next((item for item in store.meta.get("drawingMarkups", [])
                               if item.get("id") == markup_id and item.get("projectId") == project_id), None)
                if markup is None:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                try:
                    _authorize_markup_source(store, project_id, markup, actor, role)
                except ContractError:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                body_for_hash = {"expectedVersion": body["expectedVersion"], "text": body["text"],
                                 "rect": rect, "reason": body["reason"]}
                request_key = f"drawing-markup-edit:{project_id}:{actor['partyId']}:{key}"
                fingerprint = _fingerprint(project_id, actor["partyId"], f"edit:{markup_id}", body_for_hash)
                cached = store.requests.get(request_key)
                if cached is not None:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Markup edit request changed")
                    return JSONResponse(_authorized_markup_replay(cached["response"], store, actor, role), status_code=200)
                require(markup.get("deletedAt") is None, "MARKUP_DELETED", "Deleted markups cannot be edited")
                require(markup.get("version") == body["expectedVersion"], "VERSION_CONFLICT", "Markup version changed")
                _markup_history(store, markup)
                before = markup["version"]
                updated = deepcopy(markup)
                updated.update(version=before + 1, text=text, rect=deepcopy(rect),
                               updatedAt=store.engine.at(), updatedBy=actor["partyId"], updateReason=reason)
                markups = store.meta["drawingMarkups"]
                markups[markups.index(markup)] = updated
                store.meta["drawingMarkupHistory"].append({"markupId": markup_id, "projectId": project_id, "version": updated["version"],
                                "snapshot": deepcopy(updated), "createdAt": updated["updatedAt"],
                                "createdBy": actor["partyId"], "reason": reason})
                _markup_audit(store, "drawing_markup_edited", updated, actor, role, before, updated["version"], reason)
                response = _markup_projection(store, updated, actor, role, demo_enabled)
                store.requests[request_key] = {"hash": fingerprint, "response": deepcopy(response)}
                return JSONResponse(response, status_code=200)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code in {"NOT_AUTHORIZED", "DEMO_ONLY"}
                      else 404 if code in {"NOT_FOUND", "OBJECT_NOT_FOUND", "PROJECT_MISMATCH"}
                      else 409 if code in {"IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT", "MARKUP_DELETED"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status)
        except (KeyError, ValueError, TypeError):
            return _error("INVALID_REQUEST", "Drawing markup edit is invalid", 422)

    @app.delete("/projects/{project_id}/parallel/drawing-markups/{markup_id}")
    async def delete_markup(project_id: str, markup_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "Drawing markup deletion is demo only")
            actor = identity(request)
            body = await _json_body(request)
            require(set(body) == {"expectedVersion", "reason"},
                    "INVALID_REQUEST", "Unexpected or missing markup delete fields")
            require(_positive_int(body.get("expectedVersion")), "INVALID_REQUEST", "expectedVersion must be positive")
            require(isinstance(body.get("reason"), str), "INVALID_REQUEST", "reason must be text")
            reason = body["reason"].strip()
            require(0 < len(reason) <= 500, "INVALID_REQUEST", "reason must contain 1 to 500 characters")
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key) <= MAX_KEY_LENGTH,
                    "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                _markup_write_role(actor, role, project_id)
                markup = next((item for item in store.meta.get("drawingMarkups", [])
                               if item.get("id") == markup_id and item.get("projectId") == project_id), None)
                if markup is None:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                try:
                    _authorize_markup_source(store, project_id, markup, actor, role)
                except ContractError:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                request_key = f"drawing-markup-delete:{project_id}:{actor['partyId']}:{key}"
                fingerprint = _fingerprint(project_id, actor["partyId"], f"delete:{markup_id}", body)
                cached = store.requests.get(request_key)
                if cached is not None:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Markup delete request changed")
                    return JSONResponse(_authorized_markup_replay(cached["response"], store, actor, role), status_code=200)
                require(markup.get("deletedAt") is None, "MARKUP_DELETED", "Markup is already deleted")
                require(markup.get("version") == body["expectedVersion"], "VERSION_CONFLICT", "Markup version changed")
                _markup_history(store, markup)
                before = markup["version"]
                deleted = deepcopy(markup)
                deleted.update(version=before + 1, deletedAt=store.engine.at(), deletedBy=actor["partyId"],
                               deleteReason=reason)
                store.meta["drawingMarkups"][store.meta["drawingMarkups"].index(markup)] = deleted
                store.meta["drawingMarkupHistory"].append({"markupId": markup_id, "projectId": project_id, "version": deleted["version"],
                                "snapshot": deepcopy(deleted), "createdAt": deleted["deletedAt"],
                                "createdBy": actor["partyId"], "reason": reason})
                _markup_audit(store, "drawing_markup_deleted", deleted, actor, role, before, deleted["version"], reason)
                response = _markup_projection(store, deleted, actor, role, demo_enabled)
                store.requests[request_key] = {"hash": fingerprint, "response": deepcopy(response)}
                return JSONResponse(response, status_code=200)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code in {"NOT_AUTHORIZED", "DEMO_ONLY"}
                      else 404 if code in {"NOT_FOUND", "OBJECT_NOT_FOUND", "PROJECT_MISMATCH"}
                      else 409 if code in {"IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT", "MARKUP_DELETED"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status)
        except (KeyError, ValueError, TypeError):
            return _error("INVALID_REQUEST", "Drawing markup delete is invalid", 422)

    @app.post("/projects/{project_id}/parallel/drawing-markups")
    async def create_markup(project_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "Drawing markup is available only in demo mode")
            actor = identity(request)
            body = await _json_body(request)
            require(set(body) == {"bindingId", "page", "rect", "text"},
                    "INVALID_REQUEST", "Unexpected drawing markup fields")
            require(_valid_uuid(body.get("bindingId")), "INVALID_REQUEST", "bindingId must be a UUID")
            require(_positive_int(body.get("page")) and body["page"] <= MAX_PAGE,
                    "INVALID_REQUEST", "page must be between 1 and 100000")
            rect = body.get("rect")
            require(isinstance(rect, dict) and set(rect) == {"x1", "y1", "x2", "y2"},
                    "INVALID_REQUEST", "rect must contain exactly x1, y1, x2 and y2")
            for coordinate in rect.values():
                require(isinstance(coordinate, (int, float)) and not isinstance(coordinate, bool)
                        and -MAX_COORD <= coordinate <= MAX_COORD and math.isfinite(coordinate),
                        "INVALID_REQUEST", "Rectangle coordinates must be finite bounded numbers")
            require(rect["x1"] < rect["x2"] and rect["y1"] < rect["y2"],
                    "INVALID_REQUEST", "Rectangle must have positive width and height")
            require(isinstance(body.get("text"), str), "INVALID_REQUEST", "text must be plain text")
            original_body = deepcopy(body)
            text = body["text"].strip()
            require(0 < len(text) <= MAX_TEXT, "INVALID_REQUEST", "text must contain 1 to 2000 characters")
            body["text"] = text
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key) <= MAX_KEY_LENGTH,
                    "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                _markup_write_role(actor, role, project_id)
                binding, _drawing, _evidence = _resolve_binding(store, project_id, body["bindingId"], actor, role)
                request_key = f"drawing-markup:{project_id}:{actor['partyId']}:{key}"
                fingerprint = _fingerprint(project_id, actor["partyId"], "create", original_body)
                cached = store.requests.get(request_key)
                if cached is not None:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Markup request changed")
                    markup = next((item for item in store.meta.get("drawingMarkups", [])
                                   if item.get("id") == cached.get("id") and item.get("projectId") == project_id), None)
                    require(markup is not None, "IDEMPOTENCY_CONFLICT", "Markup replay is unavailable")
                    return JSONResponse(deepcopy(cached.get("response", markup)), status_code=200)
                markups = store.meta.setdefault("drawingMarkups", [])
                count = sum(item.get("bindingId") == binding["id"] and item.get("projectId") == project_id
                            for item in markups)
                require(count < MAX_PER_BINDING, "MARKUP_LIMIT", "This PDF binding already has 1000 markups")
                markup = {
                    "id": str(uuid4()), "version": 1, "projectId": project_id,
                    "bindingId": binding["id"], "drawingRef": deepcopy(binding["drawingRef"]),
                    "evidenceRef": deepcopy(binding["evidenceRef"]), "page": body["page"],
                    "rect": deepcopy(rect), "text": text, "createdAt": store.engine.at(),
                    "createdBy": actor["partyId"],
                }
                markups.append(markup)
                store.meta.setdefault("drawingMarkupHistory", []).append({
                    "markupId": markup["id"], "projectId": project_id, "version": 1,
                    "snapshot": deepcopy(markup), "createdAt": markup["createdAt"],
                    "createdBy": actor["partyId"], "reason": "Initial markup",
                })
                markup_response = _markup_projection(store, markup, actor, role, demo_enabled)
                store.requests[request_key] = {"hash": fingerprint, "id": markup["id"],
                                               "response": deepcopy(markup_response)}
                store.meta.setdefault("drawingMarkupAudit", []).append({
                    "event": "drawing_markup_created", "markupId": markup["id"], "version": 1,
                    "projectId": project_id, "bindingId": binding["id"],
                    "drawingRef": deepcopy(binding["drawingRef"]), "evidenceRef": deepcopy(binding["evidenceRef"]),
                    "actorPartyId": actor["partyId"], "roleAssignmentId": role["id"],
                    "createdAt": markup["createdAt"],
                })
                return JSONResponse(markup_response, status_code=201)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code in {"NOT_AUTHORIZED", "DEMO_ONLY"}
                      else 404 if code in {"NOT_FOUND", "OBJECT_NOT_FOUND", "PROJECT_MISMATCH"}
                      else 409 if code in {"IDEMPOTENCY_CONFLICT", "REFERENCE_STALE"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status)
        except (KeyError, ValueError, TypeError):
            return _error("INVALID_REQUEST", "Drawing markup request is invalid", 422)

    @app.post("/projects/{project_id}/parallel/drawing-markups/{markup_id}/issues")
    async def create_markup_issue(project_id: str, markup_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "Drawing markup issue creation is available only in demo mode")
            actor = identity(request)
            body = await _json_body(request)
            fields = {"roleAssignmentId", "expectedMarkupVersion", "inspectionRef", "observationRefs",
                      "issueObjectId", "actionObjectId", "subtype", "title", "actionTitle",
                      "responsiblePartyId", "dueAt"}
            require(set(body) == fields, "INVALID_REQUEST", "Unexpected or missing markup issue fields")
            require(_valid_uuid(markup_id) and _valid_uuid(body.get("roleAssignmentId"))
                    and _positive_int(body.get("expectedMarkupVersion")), "INVALID_REQUEST", "Markup reference is invalid")
            require(_domain_ref(body.get("inspectionRef"), "Inspection"),
                    "REFERENCE_INVALID", "inspectionRef must be an Inspection reference")
            observation_refs = body.get("observationRefs")
            require(isinstance(observation_refs, list) and bool(observation_refs)
                    and all(_domain_ref(ref, "Observation") for ref in observation_refs),
                    "REFERENCE_INVALID", "observationRefs must contain Observation references")
            require(len({ref["objectId"] for ref in observation_refs}) == len(observation_refs),
                    "REFERENCE_DUPLICATE", "observationRefs must be unique")
            for field in ("issueObjectId", "actionObjectId", "responsiblePartyId"):
                require(_valid_uuid(body.get(field)), "INVALID_REQUEST", f"{field} must be a UUID")
            for field in ("subtype", "title", "actionTitle"):
                require(isinstance(body.get(field), str) and body[field].strip(),
                        "INVALID_REQUEST", f"{field} is required")
            require(_iso_datetime(body.get("dueAt")), "INVALID_DATETIME", "dueAt must be an ISO datetime with timezone")
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key) <= MAX_KEY_LENGTH,
                    "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
            with store.transaction(True):
                role = role_for(actor, project_id, body["roleAssignmentId"])
                require(body["roleAssignmentId"] == role.get("id"), "NOT_AUTHORIZED", "Role assignment unavailable")
                markup = next((item for item in store.meta.get("drawingMarkups", [])
                               if item.get("id") == markup_id and item.get("projectId") == project_id), None)
                if markup is None:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                try:
                    _authorize_markup_source(store, project_id, markup, actor, role)
                except ContractError:
                    return _error("NOT_FOUND", "Markup unavailable", 404)
                request_key = f"drawing-markup-issue:{project_id}:{actor['partyId']}:{key}"
                fingerprint = _fingerprint(project_id, actor["partyId"], f"issue:{markup_id}", body)
                cached = store.requests.get(request_key)
                if cached is not None:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Markup issue request changed")
                    issue = store.engine.get("Issue", cached["issueId"])
                    action = store.engine.get("Action", cached["actionId"])
                    store.engine.authorize_read(issue, actor["partyId"], role["id"])
                    store.engine.authorize_read(action, actor["partyId"], role["id"])
                    link = next((item for item in store.meta.get("drawingMarkupIssueLinks", [])
                                 if item.get("markupId") == markup_id), None)
                    require(link is not None and link.get("issueRef", {}).get("objectId") == issue["id"]
                            and link.get("actionRef", {}).get("objectId") == action["id"],
                            "IDEMPOTENCY_CONFLICT", "Markup issue replay is unavailable")
                    response = cached.get("response")
                    require(isinstance(response, dict), "IDEMPOTENCY_CONFLICT", "Markup issue replay is unavailable")
                    return JSONResponse(deepcopy(response), status_code=200)
                require(markup.get("deletedAt") is None, "MARKUP_DELETED", "Deleted markup cannot receive a new issue")
                require(markup.get("version") == body["expectedMarkupVersion"],
                        "VERSION_CONFLICT", "Markup version changed")
                existing = next((item for item in store.meta.get("drawingMarkupIssueLinks", [])
                                 if item.get("markupId") == markup_id), None)
                require(existing is None, "MARKUP_ALREADY_LINKED", "Markup already has an issue link")

                inspection_ref = body["inspectionRef"]
                inspection = _check_current_ref(store, inspection_ref, "Inspection", project_id)
                store.engine.authorize_read(inspection, actor["partyId"], role["id"])
                require(not inspection.get("relatedIssueId"), "CASE_ROOT_REQUIRED", "Inspection must be an original source")
                require(inspection.get("resultStatus") == "fail"
                        and inspection.get("status") in {"failed", "completed"},
                        "INSPECTION_NOT_FAILED", "Issue needs an already-failed inspection")
                require(inspection.get("drawingRef") == markup["drawingRef"],
                        "DRAWING_MISMATCH", "Inspection must reference the exact markup Drawing version")
                observation_records = []
                for reference in observation_refs:
                    observation = _check_current_ref(store, reference, "Observation", project_id)
                    store.engine.authorize_read(observation, actor["partyId"], role["id"])
                    require(observation.get("status") == "confirmed", "OBSERVATION_UNVERIFIED",
                            "Observation must already be confirmed")
                    observation_records.append(observation)

                issue_package = create_issue_package(
                    store.engine, inspection["id"], body["issueObjectId"], body["actionObjectId"],
                    [record["id"] for record in observation_records], body["subtype"], body["title"],
                    body["actionTitle"], body["responsiblePartyId"], body["dueAt"],
                    actor["partyId"], role["id"], f"drawing-markup:{key}",
                )
                issue, action = issue_package["issue"], issue_package["correctiveAction"]
                link = {
                    "markupId": markup_id, "markupVersion": markup["version"],
                    "inspectionRef": deepcopy(inspection_ref), "observationRefs": deepcopy(observation_refs),
                    "issueRef": {"objectType": "Issue", "objectId": issue["id"], "version": issue["version"]},
                    "actionRef": {"objectType": "Action", "objectId": action["id"], "version": action["version"]},
                    "createdAt": store.engine.at(), "createdBy": actor["partyId"],
                }
                store.meta.setdefault("drawingMarkupIssueLinks", []).append(link)
                store.meta.setdefault("drawingMarkupAudit", []).append({
                    "event": "drawing_markup_issue_linked", "markupId": markup_id,
                    "projectId": project_id, "issueRef": deepcopy(link["issueRef"]),
                    "actionRef": deepcopy(link["actionRef"]), "actorPartyId": actor["partyId"],
                    "roleAssignmentId": role["id"], "createdAt": link["createdAt"],
                })
                response = {"markup": _visible_markup(store, markup, actor, role), "issue": issue,
                            "correctiveAction": action, "link": deepcopy(link)}
                store.requests[request_key] = {"hash": fingerprint, "issueId": issue["id"],
                                               "actionId": action["id"], "response": deepcopy(response)}
                return JSONResponse(response, status_code=201)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code == "NOT_AUTHORIZED"
                      else 404 if code in {"NOT_FOUND", "OBJECT_NOT_FOUND", "PROJECT_MISMATCH"}
                      else 409 if code in {"IDEMPOTENCY_CONFLICT", "REFERENCE_STALE", "VERSION_CONFLICT", "MARKUP_ALREADY_LINKED", "MARKUP_DELETED", "OBJECT_EXISTS"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status)
        except (KeyError, ValueError, TypeError):
            return _error("INVALID_REQUEST", "Markup issue request is invalid", 422)
