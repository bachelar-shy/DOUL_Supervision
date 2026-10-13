"""Authorized photo-to-drawing-pin linking over existing Evidence and DrawingSheetPin.

This is a field collaboration index, not a second drawing/issue schema.
All references are project-scoped. Links are retained with unlink audit history.
"""
from copy import deepcopy
from fastapi import Request
from app.reference.engine import uid
from app.reference.validation import ContractError, require

WRITERS = frozenset({"ADM", "SUP", "CON"})
MEDIA_TYPES = frozenset({"photo", "video"})
DENIED = frozenset({"SCOPE_MISMATCH", "NOT_AUTHORIZED", "NOT_FOUND",
                    "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID",
                    "REFERENCE_STALE", "ASSIGNMENT_EXPIRED"})

def install_photo_link_routes(app, store, *, identity, role_for, key_for, body_json):
    def context(project_id, request):
        actor = identity(request)
        role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
        require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Session role mismatch")
        store.engine.get("Project", project_id)
        return actor, role

    def pin_for(project_id, sheet_id, pin_id):
        sheet = store.meta.get("drawingSheets", {}).get(project_id, {}).get(sheet_id)
        require(sheet is not None and sheet.get("projectId") == project_id,
                "NOT_FOUND", "Drawing sheet unavailable")
        pin = store.meta.get("drawingSheetPins", {}).get(project_id, {}).get(sheet_id, {}).get(pin_id)
        require(pin is not None and pin.get("projectId") == project_id
                and pin.get("sheetId") == sheet_id, "NOT_FOUND", "Pin unavailable")
        return sheet, pin

    def authorize_pin(project_id, pin, actor, role):
        ref = pin.get("recordRef")
        if ref:
            require(isinstance(ref, dict), "REFERENCE_INVALID", "Pin reference invalid")
            item = store.engine.get(ref["objectType"], ref["objectId"])
            require(item["projectId"] == project_id, "PROJECT_MISMATCH", "Linked work belongs to another project")
            store.engine.authorize_read(item, actor["partyId"], role["id"])
        else:
            # Standalone pins must be within a role's authorized Location scope.
            # Drawing sheet access is already bound to the current authenticated project.
            require(role["actorGroup"] in {"SUP", "ADM", "CON", "OWN", "DES"},
                    "NOT_AUTHORIZED", "No sheet-pin read permission")

    def photo_for(project_id, ref, actor, role, *, exact_version=False):
        require(isinstance(ref, dict) and set(ref) == {"objectType", "objectId", "version"}
                and ref["objectType"] == "Evidence"
                and isinstance(ref["objectId"], str) and bool(ref["objectId"])
                and type(ref["version"]) is int and ref["version"] > 0,
                "REFERENCE_INVALID", "Versioned photo evidence reference required")
        # Linked history retains its original EvidenceRef, while current
        # project permissions govern every read and unlink operation.
        evidence = store.engine.get("Evidence", ref["objectId"])
        require(evidence["projectId"] == project_id, "PROJECT_MISMATCH", "Other project photo")
        if exact_version:
            require(evidence["version"] == ref["version"], "REFERENCE_STALE", "Photo version changed")
        require(evidence.get("mediaType") in MEDIA_TYPES,
                "INVALID_REQUEST", "Only photo/video evidence can be linked")
        store.engine.authorize_read(evidence, actor["partyId"], role["id"])
        return evidence

    def visible(project_id, row, actor, role):
        try:
            photo_for(project_id, row["evidenceRef"], actor, role)
            _, pin = pin_for(project_id, row["sheetId"], row["pinId"])
            authorize_pin(project_id, pin, actor, role)
            return True
        except ContractError as exc:
            if exc.code in DENIED:
                return False
            raise

    def presentation(project_id, row):
        sheet, pin = pin_for(project_id, row["sheetId"], row["pinId"])
        return {**deepcopy(row), "sheetNumber": sheet["number"], "sheetTitle": sheet["title"],
                "pinKind": pin["kind"], "pinComment": pin["comment"],
                "recordRef": deepcopy(pin.get("recordRef"))}

    @app.get("/projects/{project_id}/field/photo-links")
    def list_links(project_id: str, request: Request,
                   sheetId: str = "", pinId: str = "", evidenceId: str = ""):
        with store.transaction():
            actor, role = context(project_id, request)
            links = store.meta.get("fieldPhotoLinks", {}).get(project_id, {})
            items = []
            for row in links.values():
                if row.get("unlinkedAt"):
                    continue
                if sheetId and row["sheetId"] != sheetId:
                    continue
                if pinId and row["pinId"] != pinId:
                    continue
                if evidenceId and row["evidenceRef"]["objectId"] != evidenceId:
                    continue
                if visible(project_id, row, actor, role):
                    items.append(presentation(project_id, row))
            items.sort(key=lambda r: (r["createdAt"], r["id"]), reverse=True)
            return {"projectId": project_id, "count": len(items), "items": items}

    @app.post("/projects/{project_id}/field/photo-links")
    async def add_link(project_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and set(body) == {
            "sheetId", "pinId", "evidenceRef", "expectedPinVersion"},
            "INVALID_REQUEST", "Drawing pin and photo reference required")
        require(isinstance(body["sheetId"], str) and isinstance(body["pinId"], str)
                and bool(body["sheetId"]) and bool(body["pinId"])
                and type(body["expectedPinVersion"]) is int
                and body["expectedPinVersion"] > 0,
                "INVALID_REQUEST", "Pin ID and version required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role["actorGroup"] in WRITERS
                    and "create_evidence" in role.get("authorityCodes", []),
                    "NOT_AUTHORIZED", "Photo association requires evidence permission")
            op = "field_photo_links:create"
            previous = store.engine._replay(project_id, actor["partyId"], op, key, body)
            if previous is not None:
                return previous
            _, pin = pin_for(project_id, body["sheetId"], body["pinId"])
            require(pin["version"] == body["expectedPinVersion"],
                    "REFERENCE_STALE", "Pin was updated")
            authorize_pin(project_id, pin, actor, role)
            evidence = photo_for(project_id, body["evidenceRef"], actor, role, exact_version=True)
            require(role["actorGroup"] != "CON" or (
                evidence.get("submittedBy") == actor["partyId"]
                and pin.get("createdByPartyId") == actor["partyId"]),
                "NOT_AUTHORIZED", "Contractor may attach own photo to own pin only")
            links = store.meta.setdefault("fieldPhotoLinks", {}).setdefault(project_id, {})
            require(not any(row["sheetId"] == body["sheetId"] and
                row["pinId"] == body["pinId"] and
                row["evidenceRef"]["objectId"] == evidence["id"] and
                not row.get("unlinkedAt") for row in links.values()),
                "INVALID_REQUEST", "Photo already linked to the pin")
            now = store.engine.at()
            row = {"id": uid(), "version": 1, "projectId": project_id,
                   "sheetId": body["sheetId"], "pinId": body["pinId"],
                   "pinVersion": pin["version"], "evidenceRef": deepcopy(body["evidenceRef"]),
                   "createdAt": now, "createdBy": actor["partyId"],
                   "roleAssignmentId": role["id"]}
            links[row["id"]] = row
            store.meta.setdefault("fieldPhotoLinkAudit", {}).setdefault(project_id, []).append({
                "event": "photo_link_created", "linkId": row["id"],
                "actorPartyId": actor["partyId"], "at": now})
            response = {"link": presentation(project_id, row)}
            store.engine._remember(project_id, actor["partyId"], op, key, body, response)
            return response

    @app.post("/projects/{project_id}/field/photo-links/{link_id}/unlink")
    async def unlink(project_id: str, link_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and set(body) == {"expectedVersion"}
                and type(body["expectedVersion"]) is int and body["expectedVersion"] > 0,
                "INVALID_REQUEST", "Link version required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "Unlink not permitted")
            op = "field_photo_links:unlink"
            fingerprint = {"linkId": link_id, **body}
            previous = store.engine._replay(project_id, actor["partyId"], op, key, fingerprint)
            if previous is not None:
                return previous
            row = store.meta.get("fieldPhotoLinks", {}).get(project_id, {}).get(link_id)
            require(row is not None and not row.get("unlinkedAt"), "NOT_FOUND", "Photo link unavailable")
            require(row["version"] == body["expectedVersion"], "REFERENCE_STALE", "Link changed")
            photo = photo_for(project_id, row["evidenceRef"], actor, role)
            _, pin = pin_for(project_id, row["sheetId"], row["pinId"])
            authorize_pin(project_id, pin, actor, role)
            require(role["actorGroup"] != "CON" or (
                row["createdBy"] == actor["partyId"] and photo.get("submittedBy") == actor["partyId"]),
                "NOT_AUTHORIZED", "Only owner may unlink submitted photo")
            now = store.engine.at()
            row.update(version=row["version"] + 1, unlinkedAt=now, unlinkedBy=actor["partyId"])
            store.meta.setdefault("fieldPhotoLinkAudit", {}).setdefault(project_id, []).append({
                "event": "photo_link_unlinked", "linkId": link_id,
                "actorPartyId": actor["partyId"], "at": now})
            result = {"link": deepcopy(row)}
            store.engine._remember(project_id, actor["partyId"], op, key, fingerprint, result)
            return result
