"""Demo-only field control metadata for exact Drawing/PDF source revisions.

This module records release and field distribution evidence separately from
canonical InformationItem/Approval/Change records; it never mutates them.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
from typing import Callable
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.reference.validation import ContractError, instant, require

MAX_KEY = 160
MAX_PAYLOAD = 16 * 1024
MAX_RECIPIENTS = 50
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
REGISTER_FIELDS = {"bindingId", "drawingNo", "revision", "issuedFor", "requiredRecipientPartyIds", "approvalRef", "changeRefs", "supersedesId"}
COMMAND_FIELDS = {"command", "expectedVersion", "payload"}


def _error(code: str, message: str, status: int, *, current_version=None):
    data = {"code": code, "message": message, "failedGuards": [code]}
    if current_version is not None:
        data["currentVersion"] = current_version
    return JSONResponse(data, status_code=status)


def _uuid(value):
    return isinstance(value, str) and bool(_UUID.fullmatch(value))


def _ref(value, kind):
    return (isinstance(value, dict) and set(value) == {"objectType", "objectId", "version"}
            and value.get("objectType") == kind and _uuid(value.get("objectId"))
            and type(value.get("version")) is int and value["version"] > 0)


def _domain_ref(kind, record):
    return {"objectType": kind, "objectId": record["id"], "version": record["version"]}


def _same_ref(left, right):
    return isinstance(left, dict) and isinstance(right, dict) and all(
        left.get(key) == right.get(key) for key in ("objectType", "objectId", "version"))


def _fingerprint(project_id, actor_id, operation, body):
    packed = {"projectId": project_id, "actorId": actor_id, "operation": operation, "body": body}
    return hashlib.sha256(json.dumps(packed, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _instant_now(engine):
    return instant(engine.at())


def _active_party_roles(engine, project_id, party_id):
    now = _instant_now(engine)
    return [role for (kind, _), role in engine._records.items()
            if kind == "RoleAssignment" and role.get("projectId") == project_id
            and role.get("partyId") == party_id and role.get("actorGroup") in {"SUP", "CON", "OWN", "DES", "ADM"}
            and role.get("active") is True and instant(role["validFrom"]) <= now < instant(role["validTo"])]


def _current_source(engine, project_id, binding):
    drawing_ref, evidence_ref = binding.get("drawingRef"), binding.get("evidenceRef")
    require(_ref(drawing_ref, "InformationItem") and _ref(evidence_ref, "Evidence"), "SOURCE_INVALID", "Drawing/PDF source refs are invalid")
    drawing = engine.resolve(drawing_ref, project_id)
    evidence = engine.resolve(evidence_ref, project_id)
    require(drawing.get("subtype") == "Drawing", "SOURCE_INVALID", "Source must be a canonical Drawing")
    require(evidence.get("sourceType") == "original" and evidence.get("mediaType") == "document"
            and evidence.get("metadata", {}).get("mimeType") == "application/pdf",
            "SOURCE_INVALID", "Bound evidence must be an original PDF")
    current_drawing = engine.get("InformationItem", drawing["id"])
    current_evidence = engine.get("Evidence", evidence["id"])
    return drawing, evidence, _same_ref(_domain_ref("InformationItem", current_drawing), drawing_ref) and _same_ref(_domain_ref("Evidence", current_evidence), evidence_ref)


def _binding_for(store, project_id, binding_id):
    return next((item for item in store.meta.get("drawingPdfBindings", [])
                 if item.get("projectId") == project_id and item.get("id") == binding_id), None)


def _authorize_read(engine, record, actor, role):
    engine.authorize_read(record, actor["partyId"], role["id"])


def _authorize_binding(store, project_id, binding, actor, role):
    drawing, evidence, is_current = _current_source(store.engine, project_id, binding)
    _authorize_read(store.engine, drawing, actor, role)
    _authorize_read(store.engine, evidence, actor, role)
    return drawing, evidence, is_current


def _approval_ok(engine, project_id, drawing_ref, approval_ref):
    if not _ref(approval_ref, "Approval"):
        return False, "APPROVAL_MISSING"
    try:
        approval = engine._current_reference(approval_ref, project_id, object_type="Approval")
    except ContractError:
        return False, "APPROVAL_STALE"
    if approval.get("approvalKind") != "technical" or approval.get("status") != "approved" or not _same_ref(approval.get("targetRef"), drawing_ref):
        return False, "APPROVAL_NOT_CURRENT_TECHNICAL"
    now = _instant_now(engine)
    for key in ("validTo", "expiresAt", "validUntil"):
        if key in approval and instant(approval[key]) <= now:
            return False, "APPROVAL_EXPIRED"
    return True, None


def _changes_ok(engine, project_id, change_refs, drawing_ref):
    current = []
    for reference in change_refs:
        if not _ref(reference, "WorkItem"):
            return False, "CHANGE_REF_INVALID", []
        try:
            item = engine._current_reference(reference, project_id, object_type="WorkItem")
        except ContractError:
            return False, "CHANGE_STALE", []
        if item.get("subtype") != "ChangeRequest" or item.get("status") not in {"approved", "revised_information_issued", "implemented"}:
            return False, "CHANGE_NOT_APPROVED", []
        change_drawing_ref = item.get("drawingRef") or item.get("targetRef")
        linked_refs = item.get("relatedRefs") or (item.get("data") or {}).get("references") or []
        drawing_links = [reference for reference in linked_refs
                         if isinstance(reference, dict) and reference.get("objectType") == "InformationItem"]
        if change_drawing_ref is not None and not _same_ref(change_drawing_ref, drawing_ref):
            return False, "CHANGE_TARGET_MISMATCH", []
        if drawing_links and not any(_same_ref(reference, drawing_ref) for reference in drawing_links):
            return False, "CHANGE_TARGET_MISMATCH", []
        approval_ref = item.get("approvalRef")
        if approval_ref is not None:
            try:
                approval = engine._current_reference(approval_ref, project_id, object_type="Approval")
            except ContractError:
                return False, "CHANGE_APPROVAL_INVALID", []
            expected_target = _domain_ref("WorkItem", item)
            if approval.get("status") != "approved" or not _same_ref(approval.get("targetRef"), expected_target):
                return False, "CHANGE_APPROVAL_INVALID", []
            if _check_expired_approval(engine, approval):
                return False, "CHANGE_APPROVAL_INVALID", []
        current.append(item)
    return True, None, current


def _readiness(engine, revision, binding, project_id):
    reasons = []
    try:
        _, _, is_current_source = _current_source(engine, project_id, binding)
    except ContractError:
        is_current_source = False
    if not is_current_source:
        reasons.append("SOURCE_STALE")
    approval_ok, approval_reason = _approval_ok(engine, project_id, binding.get("drawingRef"), revision.get("approvalRef"))
    if not approval_ok:
        reasons.append(approval_reason or "APPROVAL_INVALID")
    changes_ok, change_reason, _ = _changes_ok(engine, project_id, revision.get("changeRefs", []), binding.get("drawingRef"))
    if not changes_ok:
        reasons.append(change_reason or "CHANGE_INVALID")
    if revision.get("issuedFor") != "construction":
        reasons.append("NOT_FOR_CONSTRUCTION")
    required = revision.get("requiredRecipientPartyIds", [])
    receipts = revision.get("receipts", [])
    delivered_received = {item.get("recipientPartyId") for item in receipts
                          if item.get("deliveredAt") and item.get("receivedAt")}
    distribution_complete = bool(required) and set(required).issubset(delivered_received)
    if not distribution_complete:
        reasons.append("DISTRIBUTION_INCOMPLETE")
    return reasons, is_current_source, distribution_complete


def _can(engine, record, actor, role, authority, *, qualification=None):
    try:
        engine.authorize(record, authority, actor["partyId"], role["id"], qualification=qualification)
        return True
    except ContractError:
        return False


def _available_commands(store, project_id, revision, binding, actor, role):
    engine = store.engine
    group = role.get("actorGroup")
    commands = []
    try:
        drawing, _, _ = _current_source(engine, project_id, binding)
    except ContractError:
        return commands
    admin = group == "ADM" and role.get("roleCode") == "project_admin" and _can(engine, drawing, actor, role, "render_document")
    supervisor = group == "SUP" and role.get("roleCode") == "chief_supervisor" and _can(engine, drawing, actor, role, "review_approval", qualification=True)
    if revision.get("status") == "registered" and revision.get("issuedFor") == "construction" and (admin or supervisor):
        commands.append({"command": "release", "label": "현장 사용 승인"})
    if revision.get("status") == "released" and admin:
        commands.append({"command": "distribute", "label": "배포·수령 기록"})
    if revision.get("status") == "released" and role.get("partyId") in revision.get("requiredRecipientPartyIds", []) and _can(engine, drawing, actor, role, "render_document"):
        if any(item.get("recipientPartyId") == actor["partyId"] and item.get("deliveredAt") and not item.get("receivedAt") for item in revision.get("receipts", [])):
            commands.append({"command": "acknowledge", "label": "수령 확인"})
    if revision.get("status") in {"superseded", "withdrawn"} and role.get("partyId") in revision.get("requiredRecipientPartyIds", []) and _can(engine, drawing, actor, role, "render_document"):
        if any(item.get("recipientPartyId") == actor["partyId"] and item.get("deliveredAt") and not item.get("returnedAt") for item in revision.get("receipts", [])):
            commands.append({"command": "return_copy", "label": "구본 회수 확인"})
    if revision.get("status") in {"registered", "released"} and (admin or supervisor):
        commands.append({"command": "withdraw", "label": "배포 철회"})
    return commands


def _projection(store, project_id, revision, binding, actor, role):
    engine = store.engine
    receipts = []
    for receipt in revision.get("receipts", []):
        try:
            party = engine.get("Party", receipt["recipientPartyId"])
            if party.get("projectId") != project_id or party.get("kind") != "PERSON":
                continue
        except (ContractError, KeyError):
            continue
        receipts.append({**deepcopy(receipt), "recipientName": party.get("name")})
    current_revision = {**deepcopy(revision), "receipts": receipts}
    readiness_reasons, is_current_source, distribution_complete = _readiness(engine, revision, binding, project_id)
    outstanding = [item for item in receipts if item.get("deliveredAt") and not item.get("returnedAt")]
    current_for_construction = (revision.get("status") == "released" and revision.get("issuedFor") == "construction"
        and not readiness_reasons and not any(other.get("id") != revision.get("id")
          and other.get("projectId") == project_id and other.get("drawingNo") == revision.get("drawingNo") and other.get("status") == "released"
          for other in store.meta.get("drawingFieldRevisions", [])))
    current_revision.update({
        "fieldDistributionComplete": distribution_complete,
        "obsoleteCopiesOutstanding": len(outstanding) if revision.get("status") in {"superseded", "withdrawn"} else 0,
        "currentForConstruction": current_for_construction,
        "isCurrentSource": is_current_source,
        "readinessReasons": readiness_reasons,
        "availableCommands": _available_commands(store, project_id, revision, binding, actor, role),
    })
    return current_revision


def _fingerprint_for_request(project_id, actor_id, key, operation, body):
    return f"drawing-field:{project_id}:{actor_id}:{operation}:{key}", _fingerprint(project_id, actor_id, operation, body)


def _authorize_registration(engine, drawing, actor, role):
    require(actor.get("actorGroup") == "ADM" and role.get("actorGroup") == "ADM" and role.get("roleCode") == "project_admin",
            "NOT_AUTHORIZED", "Drawing field registration requires project administrator")
    engine.authorize(drawing, "render_document", actor["partyId"], role["id"])


def _validate_recipient_set(engine, project_id, values, actor, role, drawing):
    require(isinstance(values, list) and 1 <= len(values) <= MAX_RECIPIENTS, "RECIPIENTS_INVALID", "Choose 1 to 50 required recipients")
    require(all(_uuid(value) for value in values) and len(set(values)) == len(values), "RECIPIENTS_INVALID", "Recipients must be unique party UUIDs")
    for party_id in values:
        party = engine.get("Party", party_id)
        require(party.get("projectId") == project_id and party.get("kind") == "PERSON", "RECIPIENT_INVALID", "Recipient must be a human project party")
        roles = _active_party_roles(engine, project_id, party_id)
        require(bool(roles), "RECIPIENT_INACTIVE", "Recipient has no active project assignment")
        scope_matches = False
        for recipient_role in roles:
            try:
                engine.authorize(drawing, "render_document", party_id, recipient_role["id"])
                scope_matches = True
                break
            except ContractError:
                continue
        require(scope_matches, "RECIPIENT_UNREADABLE", "Recipient has no active assignment scoped to the Drawing")


def _validate_change_refs(engine, project_id, change_refs):
    require(isinstance(change_refs, list), "CHANGE_REFS_INVALID", "changeRefs must be an array")
    require(all(_ref(ref, "WorkItem") for ref in change_refs), "CHANGE_REFS_INVALID", "Each change must be a WorkItem ref")
    require(len({(ref["objectId"], ref["version"]) for ref in change_refs}) == len(change_refs), "CHANGE_REFS_INVALID", "Change refs must be unique")
    items = []
    for reference in change_refs:
        item = engine._current_reference(reference, project_id, object_type="WorkItem")
        require(item.get("subtype") == "ChangeRequest", "CHANGE_REF_INVALID", "Each change must be a ChangeRequest")
        items.append(item)
    return items


def _validate_approval_reference(engine, project_id, drawing_ref, approval_ref):
    if approval_ref is None:
        return None
    require(_ref(approval_ref, "Approval"), "APPROVAL_REF_INVALID", "approvalRef must be an exact Approval ref or null")
    approval = engine._current_reference(approval_ref, project_id, object_type="Approval")
    require(approval.get("approvalKind") == "technical" and _same_ref(approval.get("targetRef"), drawing_ref),
            "APPROVAL_TARGET_MISMATCH", "Approval must be technical and target this exact Drawing revision")
    return approval


def _check_expired_approval(engine, approval):
    if approval is None:
        return False
    now = _instant_now(engine)
    for key in ("validTo", "expiresAt", "validUntil"):
        if key in approval and instant(approval[key]) <= now:
            return True
    return False


def _audit(store, event, revision, actor, role, *, before=None, reason=None, at=None):
    store.meta.setdefault("drawingFieldAudit", []).append({
        "id": str(uuid4()), "event": event, "revisionId": revision["id"], "projectId": revision["projectId"],
        "drawingRef": deepcopy(revision["drawingRef"]), "bindingId": revision["bindingId"],
        "actorPartyId": actor["partyId"], "roleAssignmentId": role["id"],
        "occurredAt": at or store.engine.at(), "before": deepcopy(before),
        "after": {"status": revision.get("status"), "version": revision.get("version")}, "reason": reason,
    })


def _readable_projection(store, project_id, revision, actor, role):
    binding = _binding_for(store, project_id, revision.get("bindingId"))
    if binding is None:
        raise ContractError("NOT_FOUND", "Field drawing unavailable")
    _authorize_binding(store, project_id, binding, actor, role)
    return _projection(store, project_id, revision, binding, actor, role)


def install_drawing_field_routes(app: FastAPI, store, *, identity: Callable, role_for: Callable,
                                 key_for: Callable, demo_enabled: bool) -> None:
    """Install demo field-release metadata routes over exact immutable sources."""

    @app.get("/projects/{project_id}/parallel/drawing-field-revisions")
    def list_field_revisions(project_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction():
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                items = []
                for revision in store.meta.get("drawingFieldRevisions", []):
                    if revision.get("projectId") != project_id:
                        continue
                    try:
                        items.append(_readable_projection(store, project_id, revision, actor, role))
                    except (ContractError, KeyError):
                        continue
                items.sort(key=lambda row: (row.get("drawingNo", ""), row.get("revision", ""), row.get("createdAt", "")))
                return {"items": items}
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 403 if exc.code == "NOT_AUTHORIZED" else 404
            return _error(exc.code, str(exc), status)

    @app.get("/projects/{project_id}/parallel/drawing-field-revisions/{revision_id}")
    def get_field_revision(project_id: str, revision_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction():
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                revision = next((item for item in store.meta.get("drawingFieldRevisions", [])
                                 if item.get("projectId") == project_id and item.get("id") == revision_id), None)
                if revision is None:
                    return _error("NOT_FOUND", "Field drawing unavailable", 404)
                return _readable_projection(store, project_id, revision, actor, role)
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 404
            return _error("NOT_FOUND" if status == 404 else exc.code, "Field drawing unavailable" if status == 404 else str(exc), status)

    @app.get("/projects/{project_id}/parallel/drawing-field-revisions/{revision_id}/history")
    def field_revision_history(project_id: str, revision_id: str, request: Request):
        try:
            actor = identity(request)
            with store.transaction():
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                revision = next((item for item in store.meta.get("drawingFieldRevisions", [])
                                 if item.get("projectId") == project_id and item.get("id") == revision_id), None)
                if revision is None:
                    return _error("NOT_FOUND", "Field drawing unavailable", 404)
                _readable_projection(store, project_id, revision, actor, role)
                events = [deepcopy(item) for item in store.meta.get("drawingFieldAudit", [])
                          if item.get("revisionId") == revision_id and item.get("projectId") == project_id]
                return {"items": events}
        except ContractError as exc:
            status = 401 if exc.code == "UNAUTHENTICATED" else 404
            return _error("NOT_FOUND" if status == 404 else exc.code, "Field drawing unavailable" if status == 404 else str(exc), status)

    @app.post("/projects/{project_id}/parallel/drawing-field-revisions")
    async def register_field_revision(project_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "Field drawing control is available only in demo mode")
            actor = identity(request)
            raw = await request.body()
            require(len(raw) <= MAX_PAYLOAD, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB")
            body = json.loads(raw)
            require(isinstance(body, dict) and set(body) == REGISTER_FIELDS, "INVALID_REQUEST", "Expected exact field revision registration fields")
            for name in ("drawingNo", "revision"):
                require(isinstance(body[name], str) and 1 <= len(body[name].strip()) <= 80, "FIELD_INVALID", f"{name} must be 1 to 80 characters")
            drawing_no, revision_label = body["drawingNo"].strip(), body["revision"].strip()
            require(body["issuedFor"] in {"construction", "review", "information"}, "ISSUED_FOR_INVALID", "Unknown issue purpose")
            require(_uuid(body["bindingId"]), "BINDING_INVALID", "bindingId must be a UUID")
            require(body["supersedesId"] is None or _uuid(body["supersedesId"]), "SUPERSEDES_INVALID", "supersedesId must be a UUID or null")
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key.strip()) <= MAX_KEY, "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                binding = _binding_for(store, project_id, body["bindingId"])
                require(binding is not None, "NOT_FOUND", "Drawing PDF binding unavailable")
                drawing, _, _ = _authorize_binding(store, project_id, binding, actor, role)
                _authorize_registration(store.engine, drawing, actor, role)
                require(_same_ref(binding.get("drawingRef"), _domain_ref("InformationItem", drawing)), "SOURCE_STALE", "Binding Drawing must be the current exact source")
                require(revision_label == str(drawing.get("revision", "")).strip(), "REVISION_SOURCE_MISMATCH", "Field revision label must match the canonical Drawing revision")
                operation = "register"
                request_key, fingerprint = _fingerprint_for_request(project_id, actor["partyId"], key, operation, body)
                cached = store.requests.get(request_key)
                if cached:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Registration retry changed")
                    found = next((item for item in store.meta.get("drawingFieldRevisions", []) if item.get("id") == cached.get("id") and item.get("projectId") == project_id), None)
                    require(found is not None, "IDEMPOTENCY_CONFLICT", "Registration replay unavailable")
                    return JSONResponse(deepcopy(cached.get("response") or _projection(store, project_id, found, binding, actor, role)), status_code=200)
                require(body["approvalRef"] is None or _ref(body["approvalRef"], "Approval"), "APPROVAL_REF_INVALID", "approvalRef must be an exact Approval ref or null")
                approval = _validate_approval_reference(store.engine, project_id, binding["drawingRef"], body["approvalRef"])
                changes = _validate_change_refs(store.engine, project_id, body["changeRefs"])
                for change in changes:
                    _authorize_read(store.engine, change, actor, role)
                if approval is not None:
                    _authorize_read(store.engine, approval, actor, role)
                _validate_recipient_set(store.engine, project_id, body["requiredRecipientPartyIds"], actor, role, drawing)
                predecessor = None
                if body["supersedesId"] is not None:
                    predecessor = next((item for item in store.meta.get("drawingFieldRevisions", [])
                                        if item.get("projectId") == project_id and item.get("id") == body["supersedesId"]), None)
                    require(predecessor is not None and predecessor.get("drawingNo") == drawing_no,
                            "SUPERSEDES_INVALID", "Predecessor must be an earlier revision of this drawing number")
                    require(predecessor.get("status") not in {"withdrawn", "superseded"},
                            "SUPERSEDES_INVALID", "Predecessor must not already be superseded or withdrawn")
                    _readable_projection(store, project_id, predecessor, actor, role)
                    require(not _same_ref(predecessor.get("drawingRef"), binding.get("drawingRef")), "SUPERSEDES_INVALID", "A successor must reference a distinct canonical Drawing revision")
                    require((predecessor.get("revision") != revision_label), "REVISION_DUPLICATE", "Revision labels must be unique within a drawing number")
                existing = store.meta.get("drawingFieldRevisions", [])
                require(not any(item.get("projectId") == project_id and item.get("drawingNo") == drawing_no
                                and item.get("revision") == revision_label for item in existing),
                        "REVISION_DUPLICATE", "Drawing number and revision already exist")
                require(not any(item.get("projectId") == project_id and item.get("bindingId") == body["bindingId"] for item in existing),
                        "BINDING_ALREADY_REGISTERED", "PDF binding is already registered")
                created_at = store.engine.at()
                value = {
                    "id": str(uuid4()), "version": 1, "projectId": project_id,
                    "bindingId": body["bindingId"], "drawingRef": deepcopy(binding["drawingRef"]),
                    "evidenceRef": deepcopy(binding["evidenceRef"]), "drawingNo": drawing_no,
                    "revision": revision_label, "issuedFor": body["issuedFor"],
                    "requiredRecipientPartyIds": list(body["requiredRecipientPartyIds"]),
                    "approvalRef": deepcopy(body["approvalRef"]), "changeRefs": deepcopy(body["changeRefs"]),
                    "supersedesId": body["supersedesId"], "status": "registered", "releasedAt": None,
                    "createdAt": created_at, "createdBy": actor["partyId"], "receipts": [],
                }
                store.meta.setdefault("drawingFieldRevisions", []).append(value)
                store.requests[request_key] = {"hash": fingerprint, "id": value["id"]}
                _audit(store, "registered", value, actor, role)
                response = _projection(store, project_id, value, binding, actor, role)
                store.requests[request_key]["response"] = deepcopy(response)
                return JSONResponse(response, status_code=201)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code in {"NOT_AUTHORIZED", "DEMO_ONLY"}
                      else 404 if code in {"NOT_FOUND", "PROJECT_MISMATCH", "OBJECT_NOT_FOUND"}
                      else 409 if code in {"IDEMPOTENCY_CONFLICT", "REFERENCE_STALE", "SOURCE_STALE", "REVISION_DUPLICATE", "REVISION_SOURCE_MISMATCH", "BINDING_ALREADY_REGISTERED", "SUPERSEDES_INVALID"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status)
        except (KeyError, ValueError, TypeError, json.JSONDecodeError):
            return _error("INVALID_REQUEST", "Field drawing registration is invalid", 422)

    @app.post("/projects/{project_id}/parallel/drawing-field-revisions/{revision_id}/commands")
    async def field_revision_command(project_id: str, revision_id: str, request: Request):
        try:
            require(demo_enabled is True, "DEMO_ONLY", "Field drawing control is available only in demo mode")
            actor = identity(request)
            raw = await request.body()
            require(len(raw) <= MAX_PAYLOAD, "PAYLOAD_TOO_LARGE", "Request body exceeds 16 KiB")
            body = json.loads(raw)
            require(isinstance(body, dict) and set(body) == COMMAND_FIELDS, "INVALID_REQUEST", "Expected command, expectedVersion and payload")
            command = body["command"]
            require(command in {"release", "distribute", "acknowledge", "return_copy", "withdraw"}, "COMMAND_INVALID", "Unknown field drawing command")
            require(type(body["expectedVersion"]) is int and body["expectedVersion"] > 0, "VERSION_INVALID", "expectedVersion must be positive")
            payload = body["payload"]
            require(isinstance(payload, dict), "PAYLOAD_INVALID", "Command payload must be an object")
            required_payloads = {"release": set(), "distribute": {"recipientPartyIds"}, "acknowledge": set(), "return_copy": {"reason"}, "withdraw": {"reason"}}
            require(set(payload) == required_payloads[command], "PAYLOAD_INVALID", "Command payload fields do not match")
            if command in {"return_copy", "withdraw"}:
                require(isinstance(payload["reason"], str) and 1 <= len(payload["reason"].strip()) <= 500,
                        "REASON_INVALID", "Reason must be 1 to 500 characters")
            if command == "distribute":
                recipients = payload["recipientPartyIds"]
                require(isinstance(recipients, list) and recipients and all(_uuid(item) for item in recipients)
                        and len(set(recipients)) == len(recipients), "RECIPIENTS_INVALID", "Choose unique recipients")
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key.strip()) <= MAX_KEY, "IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must be 1 to 160 characters")
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
                revision = next((item for item in store.meta.get("drawingFieldRevisions", [])
                                 if item.get("projectId") == project_id and item.get("id") == revision_id), None)
                require(revision is not None, "NOT_FOUND", "Field drawing unavailable")
                binding = _binding_for(store, project_id, revision["bindingId"])
                require(binding is not None, "NOT_FOUND", "Field drawing unavailable")
                drawing, evidence, is_current_source = _authorize_binding(store, project_id, binding, actor, role)
                operation = f"command:{revision_id}:{command}"
                request_key, fingerprint = _fingerprint_for_request(project_id, actor["partyId"], key, operation, body)
                cached = store.requests.get(request_key)
                if cached:
                    require(cached.get("hash") == fingerprint, "IDEMPOTENCY_CONFLICT", "Command retry changed")
                    current = next((item for item in store.meta.get("drawingFieldRevisions", [])
                                    if item.get("projectId") == project_id and item.get("id") == cached.get("id")), None)
                    require(current is not None, "IDEMPOTENCY_CONFLICT", "Command replay unavailable")
                    replay = cached.get("response") or _projection(store, project_id, current, binding, actor, role)
                    return JSONResponse(deepcopy(replay), status_code=200)
                require(revision.get("version") == body["expectedVersion"], "REFERENCE_STALE", "Field drawing version changed")
                before = deepcopy(revision)
                now = store.engine.at()
                group, role_code = role.get("actorGroup"), role.get("roleCode")
                if command == "release":
                    require(revision.get("status") == "registered" and revision.get("issuedFor") == "construction", "RELEASE_STATE_INVALID", "Only registered construction revisions can be released")
                    require(is_current_source, "SOURCE_STALE", "Drawing and PDF source must remain current")
                    release_authorized = False
                    if group == "SUP" and role_code == "chief_supervisor":
                        store.engine.authorize(drawing, "review_approval", actor["partyId"], role["id"], qualification=True)
                        release_authorized = True
                    elif group == "ADM" and role_code == "project_admin":
                        store.engine.authorize(drawing, "render_document", actor["partyId"], role["id"])
                        release_authorized = True
                    require(release_authorized, "NOT_AUTHORIZED", "Release requires qualified supervision review or admin release authority")
                    approval_ok, approval_reason = _approval_ok(store.engine, project_id, revision["drawingRef"], revision.get("approvalRef"))
                    require(approval_ok, approval_reason or "APPROVAL_INVALID", "An exact current approved technical Approval is required")
                    changes_ok, change_reason, changes = _changes_ok(store.engine, project_id, revision.get("changeRefs", []), revision["drawingRef"])
                    require(changes_ok, change_reason or "CHANGE_INVALID", "All linked Change Requests must remain current and accepted")
                    for change in changes:
                        _authorize_read(store.engine, change, actor, role)
                    _authorize_read(store.engine, store.engine.resolve(revision["approvalRef"], project_id), actor, role)
                    if revision.get("supersedesId"):
                        old = next((item for item in store.meta.get("drawingFieldRevisions", [])
                                    if item.get("projectId") == project_id and item.get("id") == revision["supersedesId"]), None)
                        require(old is not None and old.get("drawingNo") == revision["drawingNo"] and old.get("status") == "released",
                                "SUPERSEDES_NOT_CURRENT", "Predecessor must be the current released revision of the same drawing number")
                        old_binding = _binding_for(store, project_id, old["bindingId"])
                        require(old_binding is not None, "SUPERSEDES_NOT_CURRENT", "Predecessor source is unavailable")
                        old_reasons, old_current, old_distribution = _readiness(store.engine, old, old_binding, project_id)
                        require(old_current and old_distribution and not [reason for reason in old_reasons if reason != "DISTRIBUTION_INCOMPLETE"],
                                "SUPERSEDES_NOT_CURRENT", "Predecessor is not the current fully distributed revision")
                        old_before = deepcopy(old)
                        old["status"] = "superseded"; old["version"] += 1; old["updatedAt"] = now
                        _audit(store, "superseded", old, actor, role, before=old_before, reason=f"Superseded by {revision['id']}", at=now)
                    revision["status"] = "released"; revision["releasedAt"] = now
                elif command == "distribute":
                    require(revision.get("status") == "released", "DISTRIBUTION_STATE_INVALID", "Only released drawings may be distributed")
                    require(group == "ADM" and role_code == "project_admin", "NOT_AUTHORIZED", "Distribution requires project administrator")
                    store.engine.authorize(drawing, "render_document", actor["partyId"], role["id"])
                    recipients = payload["recipientPartyIds"]
                    require(set(recipients).issubset(set(revision.get("requiredRecipientPartyIds", []))), "RECIPIENTS_INVALID", "Recipients must be required recipients")
                    for party_id in recipients:
                        _validate_recipient_set(store.engine, project_id, [party_id], actor, role, drawing)
                    existing_receipts = {item["recipientPartyId"]: item for item in revision.setdefault("receipts", [])}
                    already = [party_id for party_id in recipients if existing_receipts.get(party_id, {}).get("deliveredAt")]
                    require(not already, "ALREADY_DISTRIBUTED", "One or more recipients already received this revision")
                    for party_id in recipients:
                        revision["receipts"].append({"recipientPartyId": party_id, "deliveredAt": now,
                            "deliveredBy": actor["partyId"], "receivedAt": None, "receivedBy": None,
                            "returnedAt": None, "returnedBy": None, "returnReason": None})
                elif command == "acknowledge":
                    require(revision.get("status") == "released", "ACK_STATE_INVALID", "Only a released revision can be acknowledged")
                    require(actor["partyId"] in revision.get("requiredRecipientPartyIds", []), "NOT_AUTHORIZED", "Only a required recipient can acknowledge receipt")
                    store.engine.authorize(drawing, "render_document", actor["partyId"], role["id"])
                    receipt = next((item for item in revision.setdefault("receipts", [])
                                    if item.get("recipientPartyId") == actor["partyId"] and item.get("deliveredAt") and not item.get("receivedAt")), None)
                    require(receipt is not None, "RECEIPT_NOT_DELIVERED", "No unacknowledged delivery exists for this recipient")
                    receipt["receivedAt"] = now; receipt["receivedBy"] = actor["partyId"]
                elif command == "return_copy":
                    require(revision.get("status") in {"superseded", "withdrawn"}, "RETURN_STATE_INVALID", "Only obsolete copies can be returned")
                    require(actor["partyId"] in revision.get("requiredRecipientPartyIds", []), "NOT_AUTHORIZED", "Only the recipient can return their copy")
                    store.engine.authorize(drawing, "render_document", actor["partyId"], role["id"])
                    receipt = next((item for item in revision.setdefault("receipts", [])
                                    if item.get("recipientPartyId") == actor["partyId"] and item.get("deliveredAt") and not item.get("returnedAt")), None)
                    require(receipt is not None, "COPY_NOT_OUTSTANDING", "No outstanding copy exists for this recipient")
                    receipt["returnedAt"] = now; receipt["returnedBy"] = actor["partyId"]; receipt["returnReason"] = payload["reason"].strip()
                elif command == "withdraw":
                    require(revision.get("status") in {"registered", "released"}, "WITHDRAW_STATE_INVALID", "Only registered or released revisions can be withdrawn")
                    require((group == "ADM" and role_code == "project_admin") or (group == "SUP" and role_code == "chief_supervisor"),
                            "NOT_AUTHORIZED", "Withdrawal requires administrator or supervision authority")
                    authority = "render_document" if group == "ADM" else "review_approval"
                    store.engine.authorize(drawing, authority, actor["partyId"], role["id"], qualification=True if group == "SUP" else None)
                    revision["status"] = "withdrawn"; revision["withdrawnAt"] = now
                revision["version"] += 1
                revision["updatedAt"] = now
                store.requests[request_key] = {"hash": fingerprint, "id": revision["id"]}
                _audit(store, command, revision, actor, role, before=before, reason=payload.get("reason"), at=now)
                response = _projection(store, project_id, revision, binding, actor, role)
                store.requests[request_key]["response"] = deepcopy(response)
                return JSONResponse(response, status_code=200)
        except ContractError as exc:
            code = exc.code
            status = (401 if code == "UNAUTHENTICATED" else 403 if code == "NOT_AUTHORIZED" else 404 if code == "NOT_FOUND" else
                      409 if code in {"REFERENCE_STALE", "SOURCE_STALE", "APPROVAL_STALE", "APPROVAL_EXPIRED", "APPROVAL_NOT_CURRENT_TECHNICAL", "APPROVAL_MISSING", "APPROVAL_STALE", "CHANGE_STALE", "CHANGE_NOT_APPROVED", "CHANGE_TARGET_MISMATCH", "CHANGE_APPROVAL_INVALID", "RELEASE_STATE_INVALID", "RELEASE_GATE_BLOCKED", "SUPERSEDES_NOT_CURRENT", "DISTRIBUTION_STATE_INVALID", "ALREADY_DISTRIBUTED", "ACK_STATE_INVALID", "RECEIPT_NOT_DELIVERED", "RETURN_STATE_INVALID", "COPY_NOT_OUTSTANDING", "WITHDRAW_STATE_INVALID", "IDEMPOTENCY_CONFLICT"}
                      else 413 if code == "PAYLOAD_TOO_LARGE" else 422)
            return _error(code, str(exc), status, current_version=exc.current_version)
        except (KeyError, ValueError, TypeError, json.JSONDecodeError):
            return _error("INVALID_REQUEST", "Field drawing command is invalid", 422)
