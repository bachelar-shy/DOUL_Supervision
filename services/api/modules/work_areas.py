"""공사구역 관리: reuse authoritative Location hierarchy and administration authority."""
from copy import deepcopy
from fastapi import Request
from app.reference.engine import uid
from app.reference.validation import require, validate

KINDS = frozenset({"site", "building", "floor", "zone", "room"})
MAX_DEPTH = 5

def _id_from_ref(ref):
    return (ref or {}).get("objectId") if isinstance(ref, dict) else None

def work_area_path(items, area_id):
    index = {_id_from_ref(row.get("reference")) or row.get("id"): row for row in items}
    names = []
    seen = set()
    cursor = area_id
    while cursor in index:
        require(cursor not in seen, "LOCATION_CYCLE", "Cyclic work area path")
        seen.add(cursor)
        current = index[cursor]
        names.append(current["name"])
        cursor = _id_from_ref(current.get("treeParentRef"))
        if not cursor:
            break
    return " / ".join(reversed(names))

def _height(engine, root_id, project_id):
    # Iterative, bounded traversal to prevent 6+ levels even when a subtree moves.
    children = {}
    for (typ, _), location in engine._records.items():
        if typ == "Location" and location.get("projectId") == project_id:
            children.setdefault(location.get("parentId"), []).append(location["id"])
    max_height = 0
    seen = set()
    stack = [(root_id, 1)]
    while stack:
        node, depth = stack.pop()
        require(node not in seen, "LOCATION_CYCLE", "Corrupt area hierarchy")
        seen.add(node)
        max_height = max(max_height, depth)
        stack.extend((child, depth + 1) for child in children.get(node, []))
    return max_height

def _ancestors(engine, project_id, parent_id):
    cursor = parent_id
    seen = set()
    while cursor:
        require(cursor not in seen, "LOCATION_CYCLE", "Location cycle")
        seen.add(cursor)
        location = engine.get("Location", cursor)
        require(location["projectId"] == project_id, "PROJECT_MISMATCH", "Parent belongs to another project")
        yield location
        cursor = location.get("parentId")

def _read_tree(engine, project_id, party_id, role):
    from services.api.modules.location.query import query_location_tree
    class AuthorizedLocationAdapter:
        def __getattr__(self, name):
            return getattr(engine, name)
        def authorize_read(self, record, user_id, role_id):
            if ("Location", record.get("id")) not in engine._records:
                return engine.authorize_read(record, user_id, role_id)
            require(user_id == party_id and role_id == role["id"], "NOT_AUTHORIZED", "Session role mismatch")
            require(record["projectId"] == project_id, "PROJECT_MISMATCH", "Wrong project")
            policy = engine.policies["render_document"]
            require(role["actorGroup"] in policy["actor_groups"] and
                    "render_document" in role.get("authorityCodes", []) and
                    (not policy["role_codes"] or role["roleCode"] in policy["role_codes"]),
                    "NOT_AUTHORIZED", "No area view permission")
            require(engine._scope(role.get("locationIds", []), record["id"], True),
                    "SCOPE_MISMATCH", "Area outside work scope")
            return role
    return query_location_tree(AuthorizedLocationAdapter(), project_id, party_id=party_id, role_id=role["id"])

def project_work_areas(engine, project_id, party_id, role_id, *, parent_id=None):
    role = engine.get("RoleAssignment", role_id)
    require(role["partyId"] == party_id and role["projectId"] == project_id, "NOT_AUTHORIZED", "Project role mismatch")
    data = _read_tree(engine, project_id, party_id, role)
    rows = data["items"]
    if parent_id is not None:
        rows = [r for r in rows if _id_from_ref(r.get("treeParentRef")) == parent_id]
    return {"projectId": project_id, "displayName": "공사구역", "count": len(rows),
            "items": deepcopy(rows), "hierarchyIssues": data["hierarchyIssues"]}

def install_work_area_routes(app, store, *, identity, role_for, key_for, body_json):
    def context(project_id, request):
        actor = identity(request)
        role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
        require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Session role mismatch")
        store.engine.get("Project", project_id)
        return actor, role

    def admin(project_id, actor, role):
        require(role["actorGroup"] == "ADM" and role["roleCode"] == "project_admin",
                "NOT_AUTHORIZED", "Only project administrator may change work areas")
        store.engine.authorize(store.engine.get("Project", project_id),
                               "manage_project_roles", actor["partyId"], role["id"])

    def allowed_parent(project_id, role, parent_id, node_id=None):
        if parent_id is None:
            require("*" in role["locationIds"], "NOT_AUTHORIZED", "Root area needs project-wide admin scope")
            return 0
        ancestors = list(_ancestors(store.engine, project_id, parent_id))
        require(node_id not in {r["id"] for r in ancestors},
                "LOCATION_CYCLE", "Work area cannot be parented under itself")
        require(store.engine._scope(role.get("locationIds", []), parent_id, True),
                "SCOPE_MISMATCH", "Parent is outside administration scope")
        return len(ancestors)

    def unique_sibling(project_id, name, parent_id, existing_id=None):
        for (typ, _), location in store.engine._records.items():
            require_duplicate = (typ == "Location" and location.get("projectId") == project_id
                                 and location.get("parentId") == parent_id
                                 and location.get("name", "").casefold() == name.casefold()
                                 and location["id"] != existing_id)
            require(not require_duplicate, "INVALID_REQUEST", "Area name already exists under this parent")

    @app.get("/projects/{project_id}/field/work-areas")
    def list_areas(project_id: str, request: Request, parentId: str = ""):
        with store.transaction():
            actor, role = context(project_id, request)
            return project_work_areas(store.engine, project_id, actor["partyId"], role["id"],
                                      parent_id=parentId or None)

    @app.post("/projects/{project_id}/field/work-areas")
    async def add_area(project_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and set(body) == {"name", "parentId", "kind"}
                and isinstance(body["parentId"], (str, type(None))) and body["kind"] in KINDS,
                "INVALID_REQUEST", "Name, area kind and parent required")
        name = body["name"]
        require(isinstance(name, str) and 1 <= len(name.strip()) <= 200,
                "INVALID_REQUEST", "Area name required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            admin(project_id, actor, role)
            op = "work_areas:create"
            previous = store.engine._replay(project_id, actor["partyId"], op, key, body)
            if previous is not None:
                return previous
            depth = allowed_parent(project_id, role, body["parentId"])
            require(depth < MAX_DEPTH, "INVALID_REQUEST", "Maximum five area levels")
            unique_sibling(project_id, name.strip(), body["parentId"])
            now = store.engine.at()
            new_id = uid()
            record = {"id": new_id, "projectId": project_id, "version": 1,
                      "createdAt": now, "updatedAt": now, "createdBy": actor["partyId"],
                      "name": name.strip(),
                      "semanticAnchor": "work-area/" + body["kind"] + "/" + new_id}
            if body["parentId"] is not None:
                record["parentId"] = body["parentId"]
            validate(record, store.engine.schemas["Location"], store.engine.schemas)
            store.engine._save("Location", record)
            result = store.engine._event(record, "work_area:create", actor["partyId"],
                                         role["id"], key, body, None)
            store.engine._remember(project_id, actor["partyId"], op, key, body, result)
            return result

    @app.post("/projects/{project_id}/field/work-areas/{area_id}/edit")
    async def edit_area(project_id: str, area_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and set(body) == {"name", "parentId", "expectedVersion"}
                and type(body["expectedVersion"]) is int
                and isinstance(body["parentId"], (str, type(None)))
                and isinstance(body["name"], str) and 1 <= len(body["name"].strip()) <= 200,
                "INVALID_REQUEST", "Area edit fields invalid")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            admin(project_id, actor, role)
            op = "work_areas:edit"
            operation = {"areaId": area_id, **body}
            previous = store.engine._replay(project_id, actor["partyId"], op, key, operation)
            if previous is not None:
                return previous
            current = store.engine.get("Location", area_id)
            require(current["projectId"] == project_id, "PROJECT_MISMATCH", "Area unavailable")
            require(store.engine._scope(role.get("locationIds", []), area_id, True),
                    "SCOPE_MISMATCH", "Area outside assignment")
            require(current["version"] == body["expectedVersion"], "REFERENCE_STALE", "Area updated elsewhere")
            depth = allowed_parent(project_id, role, body["parentId"], area_id)
            require(depth + _height(store.engine, area_id, project_id) <= MAX_DEPTH,
                    "INVALID_REQUEST", "Moving area would exceed five levels")
            unique_sibling(project_id, body["name"].strip(), body["parentId"], area_id)
            proposed = {**deepcopy(current), "name": body["name"].strip(),
                        "version": current["version"] + 1, "updatedAt": store.engine.at()}
            if body["parentId"] is None:
                proposed.pop("parentId", None)
            else:
                proposed["parentId"] = body["parentId"]
            validate(proposed, store.engine.schemas["Location"], store.engine.schemas)
            store.engine._save("Location", proposed)
            result = store.engine._event(proposed, "work_area:edit", actor["partyId"],
                                         role["id"], key, operation, current)
            store.engine._remember(project_id, actor["partyId"], op, key, operation, result)
            return result
