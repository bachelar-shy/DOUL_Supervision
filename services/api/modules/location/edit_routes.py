"""Demo-only Location hierarchy editing endpoints.

The authority matrix has no Location management authority. This adapter is
therefore disabled unless the host explicitly enables demo mode, and then
requires the existing ADM/project_admin assignment plus the explicit
render_document visibility authority. It is not a production write route.
"""
from copy import deepcopy
import json
import math

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.reference.engine import uid
from app.reference.validation import ContractError, require, validate


_EDITABLE = {"name", "semanticAnchor", "parentId", "drawingAnchors"}
_MAX_DRAWING_ANCHORS = 1000
_INHERITABLE = ("packageId", "discipline", "responsibleOrganizationId", "reason", "minimumQualificationRank", "requirementRefs", "evidenceIds", "drawingRef", "upstreamInspectionIds")


def _require_admin(demo_enabled, session, role):
    require(demo_enabled is True, "NOT_AUTHORIZED", "Location management is available only in the local demo")
    require(session.get("actorGroup") == "ADM" and role.get("actorGroup") == "ADM" and role.get("roleCode") == "project_admin", "NOT_AUTHORIZED", "Project administrator assignment required")
    require("render_document" in role.get("authorityCodes", []), "NOT_AUTHORIZED", "Location visibility authority required")


def _valid_drawing_anchors(engine, anchors, project_id, party_id, role_id):
    require(isinstance(anchors, list), "INVALID_REQUEST", "drawingAnchors must be an array")
    require(len(anchors) <= _MAX_DRAWING_ANCHORS, "INVALID_REQUEST", f"drawingAnchors cannot exceed {_MAX_DRAWING_ANCHORS} entries")
    result = []
    seen = set()
    for anchor in anchors:
        require(isinstance(anchor, dict), "INVALID_REQUEST", "Each drawing anchor must be an object")
        require(set(anchor) == {"drawingRef", "page", "x", "y", "coordinateSystem"}, "INVALID_REQUEST", "Drawing anchor fields are incomplete or unsupported")
        ref = anchor["drawingRef"]
        require(isinstance(ref, dict) and set(ref) == {"objectType", "objectId", "version"} and ref.get("objectType") == "InformationItem", "REFERENCE_INVALID", "Drawing anchor needs an exact InformationItem reference")
        require(isinstance(ref.get("version"), int) and not isinstance(ref.get("version"), bool) and ref["version"] >= 1, "REFERENCE_INVALID", "Drawing reference version must be positive")
        validate(ref, engine.schemas["DomainRef"], engine.schemas)
        drawing = engine.resolve(ref, project_id=project_id)
        require(drawing.get("subtype") == "Drawing", "REFERENCE_TYPE_INVALID", "Anchor reference must resolve to a Drawing")
        engine.authorize_read(drawing, party_id, role_id)
        page = anchor["page"]
        require(isinstance(page, int) and not isinstance(page, bool) and page > 0, "INVALID_REQUEST", "Drawing page must be a positive integer")
        for coordinate in (anchor["x"], anchor["y"]):
            require(isinstance(coordinate, (int, float)) and not isinstance(coordinate, bool) and math.isfinite(coordinate), "INVALID_REQUEST", "Drawing coordinates must be finite numbers")
        require(anchor["coordinateSystem"] == "pdf_points", "INVALID_REQUEST", "Coordinates must use the canonical pdf_points system")
        identity = (ref["objectId"], ref["version"], page, anchor["x"], anchor["y"], anchor["coordinateSystem"])
        require(identity not in seen, "INVALID_REQUEST", "Duplicate drawing anchor; remove the duplicate entry")
        seen.add(identity)
        result.append(deepcopy(anchor))
    return result


def _assert_scope(engine, project_id, location_id, role, callback=None, record=None):
    require(record is None or record.get("projectId") == project_id, "NOT_FOUND", "Location unavailable")
    if callback:
        require(callback(location_id, role, record) is True, "NOT_AUTHORIZED", "Location is outside the administrator's authorized scope")
    else:
        require(engine._scope(role.get("locationIds", []), location_id, True), "NOT_AUTHORIZED", "Location is outside the administrator's authorized scope")


def _idempotency_key(request):
    key = request.headers.get("idempotency-key", "")
    require(bool(key.strip()) and len(key) <= 160, "IDEMPOTENCY_REQUIRED", "Provide Idempotency-Key, at most 160 characters")
    return key


async def _read_json(request):
    try:
        raw = await request.body()
        return json.loads(
            raw.decode("utf-8"),
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite JSON number")),
        )
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise ContractError("INVALID_REQUEST", "Expected valid JSON with finite numbers") from exc


def register_location_edit_routes(app, *, store, identity, role_for, demo_enabled, location_scope_check=None):
    """Install optional routes; caller owns auth/session plumbing and mount point.

    Routes are POST `/locations` and PUT `/locations/{location_id}` relative to
    the caller's `/projects/{project_id}/parallel` prefix.
    """
    router = APIRouter()

    @router.post("/locations")
    async def create_location(project_id: str, request: Request):
        session = identity(request)
        with store.transaction(True):
            role = role_for(session, project_id, request.headers.get("x-roleassignment-id"))
            _require_admin(demo_enabled, session, role)
            body = await _read_json(request)
            key = _idempotency_key(request)
            require(isinstance(body, dict) and set(body) <= (_EDITABLE | {"clientObjectId"}) and {"name", "semanticAnchor", "parentId"} <= set(body), "INVALID_REQUEST", "Location name, semantic anchor and parent are required")
            parent_id = body["parentId"]
            parent = None
            if parent_id is not None:
                parent = store.engine._records.get(("Location", parent_id))
                require(parent is not None and parent.get("projectId") == project_id, "NOT_FOUND", "Parent location unavailable")
                _assert_scope(store.engine, project_id, parent_id, role, location_scope_check, parent)
            else:
                require(role.get("locationIds") == ["*"], "NOT_AUTHORIZED", "Creating a root location requires explicit wildcard location scope")
            location_id = body.get("clientObjectId") or uid()
            request_payload = {k: v for k, v in body.items() if k != "clientObjectId"}
            cached = store.engine._replay(project_id, session["partyId"], "Location:create", key, request_payload)
            if cached:
                return JSONResponse(cached, status_code=201)
            now = store.engine.at()
            record = {"id": location_id, "projectId": project_id, "version": 1, "createdAt": now, "updatedAt": now, "createdBy": session["partyId"], "name": body["name"], "semanticAnchor": body["semanticAnchor"], "parentId": parent_id}
            for field in _INHERITABLE:
                if field in body:
                    record[field] = body[field]
                elif parent and field in parent:
                    record[field] = deepcopy(parent[field])
            if "drawingAnchors" in body:
                record["drawingAnchors"] = _valid_drawing_anchors(store.engine, body["drawingAnchors"], project_id, session["partyId"], role["id"])
            validate(record, store.engine.schemas["Location"], store.engine.schemas)
            store.engine._save("Location", record)
            result = store.engine._event(record, "Location:create", session["partyId"], role["id"], key, request_payload, None)
            store.engine._remember(project_id, session["partyId"], "Location:create", key, request_payload, result)
            return JSONResponse(result, status_code=201)

    @router.put("/locations/{location_id}")
    async def update_location(project_id: str, location_id: str, request: Request):
        session = identity(request)
        with store.transaction(True):
            role = role_for(session, project_id, request.headers.get("x-roleassignment-id"))
            _require_admin(demo_enabled, session, role)
            current = store.engine._records.get(("Location", location_id))
            require(current is not None and current.get("projectId") == project_id, "NOT_FOUND", "Location unavailable")
            _assert_scope(store.engine, project_id, location_id, role, location_scope_check, current)
            body = await _read_json(request)
            key = _idempotency_key(request)
            require(isinstance(body, dict) and set(body) <= (_EDITABLE | {"expectedVersion"}) and isinstance(body.get("expectedVersion"), int) and not isinstance(body.get("expectedVersion"), bool), "INVALID_REQUEST", "Expected version and editable location fields are required")
            request_payload = dict(body)
            cached = store.engine._replay(project_id, session["partyId"], "Location:update", key, request_payload)
            if cached:
                return cached
            require(current["version"] == body["expectedVersion"], "REFERENCE_STALE", "Location version changed")
            proposed = deepcopy(current)
            for field in _EDITABLE & set(body):
                proposed[field] = deepcopy(body[field])
            parent_id = proposed.get("parentId")
            if "parentId" in body and parent_id is None:
                require(role.get("locationIds") == ["*"], "NOT_AUTHORIZED", "Moving a location to the project root requires explicit wildcard location scope")
            if parent_id is not None:
                parent = store.engine._records.get(("Location", parent_id))
                require(parent is not None and parent.get("projectId") == project_id, "NOT_FOUND", "Parent location unavailable")
                _assert_scope(store.engine, project_id, parent_id, role, location_scope_check, parent)
                require(parent_id != location_id, "LOCATION_CYCLE", "A location cannot parent itself")
                cursor = parent_id
                seen = set()
                while cursor and cursor not in seen:
                    require(cursor != location_id, "LOCATION_CYCLE", "Reparenting would create a cycle")
                    seen.add(cursor)
                    cursor = store.engine._records.get(("Location", cursor), {}).get("parentId")
            if "drawingAnchors" in body:
                proposed["drawingAnchors"] = _valid_drawing_anchors(store.engine, body["drawingAnchors"], project_id, session["partyId"], role["id"])
            proposed["version"] += 1
            proposed["updatedAt"] = store.engine.at()
            validate(proposed, store.engine.schemas["Location"], store.engine.schemas)
            store.engine._save("Location", proposed)
            result = store.engine._event(proposed, "Location:update", session["partyId"], role["id"], key, request_payload, current)
            store.engine._remember(project_id, session["partyId"], "Location:update", key, request_payload, result)
            return result

    app.include_router(router, prefix="/projects/{project_id}/parallel")
