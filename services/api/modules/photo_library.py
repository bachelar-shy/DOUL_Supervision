"""Read-only site photo library over authoritative Evidence; never reclassify approvals."""
from copy import deepcopy
from app.reference.validation import require, ContractError

def list_site_photos(engine, project_id, party_id, role_id, *, location_id=None, search="", limit=100):
    require(isinstance(limit, int) and not isinstance(limit, bool) and 1 <= limit <= 200, "INVALID_REQUEST", "Invalid page size")
    require(isinstance(search, str) and len(search) <= 200, "INVALID_REQUEST", "Invalid search")
    role = engine.get("RoleAssignment", role_id)
    require(role["partyId"] == party_id and role["projectId"] == project_id, "NOT_AUTHORIZED", "Project role mismatch")
    rows = []
    for (kind, _), item in engine._records.items():
        if kind != "Evidence" or item.get("projectId") != project_id:
            continue
        if not str(item.get("mimeType", item.get("mediaType", ""))).lower().startswith("image/"):
            continue
        if location_id and item.get("locationId") != location_id:
            continue
        try:
            engine.authorize_read(item, party_id, role_id)
        except ContractError as error:
            if error.code in {"NOT_AUTHORIZED", "SCOPE_MISMATCH", "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID", "NOT_FOUND"}:
                continue
            raise
        if search.casefold() not in " ".join(str(item.get(k, "")) for k in ("name", "filename", "caption", "description", "locationId")).casefold():
            continue
        rows.append(deepcopy(item))
    rows.sort(key=lambda i: (i.get("createdAt", ""), i["id"]), reverse=True)
    return {"projectId": project_id, "count": len(rows), "items": rows[:limit]}

