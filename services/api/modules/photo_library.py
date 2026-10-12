"""Field photo gallery over canonical Evidence with scoped tag overlays.

Photo metadata is not a new Evidence revision or an official approval.
"""
from copy import deepcopy
from datetime import date
from app.reference.engine import uid
from app.reference.validation import ContractError, require

DENIED = frozenset({"SCOPE_MISMATCH", "NOT_AUTHORIZED", "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID", "NOT_FOUND"})
EDITORS = frozenset({"SUP", "CON", "ADM"})
MEDIA = frozenset({"photo", "video"})

def _day(value):
    if value is None or value == "":
        return ""
    require(isinstance(value, str) and len(value) == 10, "INVALID_REQUEST", "Date must be YYYY-MM-DD")
    try:
        require(date.fromisoformat(value).isoformat() == value, "INVALID_REQUEST", "Invalid date")
    except ValueError as exc:
        raise ContractError("INVALID_REQUEST", "Invalid date") from exc
    return value

def _visible(engine, record, party_id, role_id):
    try:
        engine.authorize_read(record, party_id, role_id)
        return True
    except ContractError as exc:
        if exc.code in DENIED:
            return False
        raise

def list_site_photos(engine, project_id, party_id, role_id, *, tag_overlays=None,
                     location_id=None, search="", limit=100, offset=0, media="all",
                     uploader=None, capture_from=None, capture_to=None,
                     upload_from=None, upload_to=None, tag=None):
    require(isinstance(limit, int) and not isinstance(limit, bool) and 1 <= limit <= 200, "INVALID_REQUEST", "Invalid page size")
    require(type(offset) is int and 0 <= offset <= 100000, "INVALID_REQUEST", "Invalid offset")
    require(isinstance(search, str) and len(search) <= 200, "INVALID_REQUEST", "Invalid search")
    require(media in {"all", "photo", "video"}, "INVALID_REQUEST", "Invalid media filter")
    for candidate in (tag, uploader, location_id):
        require(candidate is None or (isinstance(candidate, str) and len(candidate) <= 200), "INVALID_REQUEST", "Invalid filter")
    start_capture, end_capture = _day(capture_from), _day(capture_to)
    start_upload, end_upload = _day(upload_from), _day(upload_to)
    role = engine.get("RoleAssignment", role_id)
    require(role["partyId"] == party_id and role["projectId"] == project_id, "NOT_AUTHORIZED", "Project role mismatch")
    engine.get("Project", project_id)
    overlays = tag_overlays or {}
    records = []
    for (kind, _), record in engine._records.items():
        if kind != "Evidence" or record.get("projectId") != project_id or record.get("mediaType") not in MEDIA:
            continue
        if media != "all" and record["mediaType"] != media:
            continue
        if location_id and not engine._scope([location_id], record.get("locationId"), True):
            continue
        if uploader and record.get("submittedBy") != uploader:
            continue
        captured = str(record.get("capturedAt") or "")[:10]
        uploaded = str(record.get("uploadedAt") or record.get("createdAt") or "")[:10]
        if (start_capture and captured < start_capture) or (end_capture and captured > end_capture):
            continue
        if (start_upload and uploaded < start_upload) or (end_upload and uploaded > end_upload):
            continue
        if not _visible(engine, record, party_id, role_id):
            continue
        overlay = overlays.get(record["id"], {})
        tags = overlay.get("tags", [])
        if tag and tag.casefold() not in {t.casefold() for t in tags}:
            continue
        name = str(record.get("metadata", {}).get("name") or record["id"])
        if search.casefold() not in " ".join([name, record.get("discipline", ""), record.get("reason", ""), " ".join(tags)]).casefold():
            continue
        records.append({
            "id": record["id"], "version": record["version"], "name": name,
            "mediaType": record["mediaType"], "sourceType": record.get("sourceType"),
            "locationId": record.get("locationId"), "discipline": record.get("discipline"),
            "capturedAt": record.get("capturedAt"), "uploadedAt": record.get("uploadedAt"),
            "submittedBy": record.get("submittedBy"), "tags": list(tags),
            "tagVersion": overlay.get("version", 0), "createdAt": record.get("createdAt")
        })
    records.sort(key=lambda r: (r["capturedAt"] or r["uploadedAt"] or r["createdAt"] or "", r["id"]), reverse=True)
    return {"projectId": project_id, "count": len(records), "offset": offset, "limit": limit, "items": records[offset:offset + limit]}

def install_photo_library_routes(app, store, *, identity, role_for, key_for, body_json):
    from fastapi import Request

    def context(project_id, request):
        actor = identity(request)
        role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
        require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Session role mismatch")
        store.engine.get("Project", project_id)
        return actor, role

    @app.get("/projects/{project_id}/field/photos")
    def photos(project_id: str, request: Request, q: str = "", locationId: str = "",
               tag: str = "", media: str = "all", uploader: str = "",
               captureFrom: str = "", captureTo: str = "",
               uploadFrom: str = "", uploadTo: str = "", limit: int = 80, offset: int = 0):
        with store.transaction():
            actor, role = context(project_id, request)
            return list_site_photos(store.engine, project_id, actor["partyId"], role["id"],
                tag_overlays=store.meta.get("fieldPhotoTags", {}).get(project_id, {}),
                search=q, location_id=locationId or None, tag=tag or None, media=media,
                uploader=uploader or None, capture_from=captureFrom or None,
                capture_to=captureTo or None, upload_from=uploadFrom or None,
                upload_to=uploadTo or None, limit=limit, offset=offset)

    @app.post("/projects/{project_id}/field/photos/tags")
    async def update_tags(project_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and set(body) == {"evidenceIds", "tags", "expectedVersions"},
                "INVALID_REQUEST", "Evidence IDs, tags and expected tag versions required")
        ids, tags, versions = body["evidenceIds"], body["tags"], body["expectedVersions"]
        require(isinstance(ids, list) and 1 <= len(ids) <= 50 and len(set(ids)) == len(ids)
                and all(isinstance(i, str) for i in ids), "INVALID_REQUEST", "1-50 unique photo IDs required")
        require(isinstance(tags, list) and len(tags) <= 20
                and all(isinstance(t, str) and 1 <= len(t.strip()) <= 40 for t in tags)
                and len(set(t.casefold().strip() for t in tags)) == len(tags),
                "INVALID_REQUEST", "Invalid photo tags")
        require(isinstance(versions, dict) and set(versions) == set(ids)
                and all(type(v) is int and v >= 0 for v in versions.values()),
                "INVALID_REQUEST", "Tag versions required for each photo")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role["actorGroup"] in EDITORS and "create_evidence" in role.get("authorityCodes", []),
                    "NOT_AUTHORIZED", "Photo editing permission required")
            op = "field_photos:tags"
            previous = store.engine._replay(project_id, actor["partyId"], op, key, body)
            if previous is not None:
                return previous
            overlays = store.meta.setdefault("fieldPhotoTags", {}).setdefault(project_id, {})
            validated = []
            for evidence_id in ids:
                evidence = store.engine.get("Evidence", evidence_id)
                require(evidence["projectId"] == project_id and evidence["mediaType"] in MEDIA,
                        "PROJECT_MISMATCH", "Photo unavailable")
                store.engine.authorize_read(evidence, actor["partyId"], role["id"])
                require(role["actorGroup"] != "CON" or evidence.get("submittedBy") == actor["partyId"],
                        "NOT_AUTHORIZED", "Contractor may tag only own uploaded photos")
                old = overlays.get(evidence_id, {})
                require(old.get("version", 0) == versions[evidence_id],
                        "REFERENCE_STALE", "Photo tags were changed by another user")
                validated.append(evidence_id)
            now = store.engine.at()
            result = []
            for evidence_id in validated:
                current = overlays.get(evidence_id, {})
                update = {"version": current.get("version", 0) + 1,
                          "tags": [t.strip() for t in tags], "updatedAt": now,
                          "updatedBy": actor["partyId"]}
                overlays[evidence_id] = update
                result.append({"evidenceId": evidence_id, **deepcopy(update)})
                store.meta.setdefault("fieldPhotoTagAudit", {}).setdefault(project_id, []).append({
                    "event": "photo_tags_updated", "evidenceId": evidence_id,
                    "partyId": actor["partyId"], "roleAssignmentId": role["id"],
                    "at": now, "version": update["version"]})
            response = {"projectId": project_id, "items": result}
            store.engine._remember(project_id, actor["partyId"], op, key, body, response)
            return response
