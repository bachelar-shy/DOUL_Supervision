"""Read-only project-scoped Location tree projection.

The projection consumes authoritative Location records from the reference
engine. parentRef preserves the same-project domain link; treeParentRef is the
safe display edge after malformed/cyclic edges are handled. No location state,
authority, or write behavior is introduced here.
"""
from collections import deque
from copy import deepcopy

from app.reference.validation import ContractError, instant, require


def _ref(location_id, version):
    return {
        "objectType": "Location",
        "objectId": location_id,
        "version": version,
    }


def _sort_key(record):
    return (
        str(record.get("name", "")).casefold(),
        str(record.get("semanticAnchor", "")).casefold(),
        record["id"],
    )


def _authoritative_version(record, kind):
    version = record.get("version")
    require(
        isinstance(version, int) and not isinstance(version, bool) and version >= 1,
        "AUTHORITATIVE_VERSION_INVALID",
        f"{kind} must have a valid authoritative version",
    )
    return version


def _is_visibility_denial(error):
    return error.code in {"SCOPE_MISMATCH", "NOT_FOUND", "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID"}


def _authorize_read(engine, record, party_id, role_id, *, is_location=False):
    # Location records identify themselves with `id`; Engine.authorize_read
    # evaluates the existing location scope against `locationId`.
    authorization_record = (
        dict(record, locationId=record["id"]) if is_location else record
    )
    try:
        engine.authorize_read(authorization_record, party_id, role_id)
        return True
    except ContractError as error:
        if _is_visibility_denial(error):
            return False
        raise


def _readable_drawing_anchors(engine, anchors, project_id, party_id, role_id):
    readable = []
    for anchor in anchors:
        if not isinstance(anchor, dict):
            continue
        drawing_ref = anchor.get("drawingRef")
        if (
            not isinstance(drawing_ref, dict)
            or drawing_ref.get("objectType") != "InformationItem"
            or not isinstance(drawing_ref.get("objectId"), str)
            or not isinstance(drawing_ref.get("version"), int)
            or isinstance(drawing_ref.get("version"), bool)
            or drawing_ref["version"] < 1
        ):
            continue
        try:
            drawing = engine.resolve(drawing_ref, project_id=project_id)
        except ContractError:
            # Missing, malformed, or foreign-project references are not
            # returned to a caller who cannot safely resolve them.
            continue
        if drawing.get("subtype") != "Drawing":
            continue
        if _authorize_read(engine, drawing, party_id, role_id):
            readable.append(deepcopy(anchor))
    return readable


def query_location_tree(engine, project_id, *, party_id=None, role_id=None):
    """Return the current locations for one project as a safe flat tree.

    items is ordered breadth-first from the project roots. Each item has a
    stable versioned reference, source parentRef, safe treeParentRef, childRefs
    and depth. Missing/out-of-project parents are detached from the display
    tree and reported without exposing the foreign parent ID. A parent cycle
    is broken only in treeParentRef at its lexically smallest ID; the source
    references remain untouched and every cycle member is marked.

    Supplying party_id and role_id validates current project membership before
    reading project metadata, then applies the existing engine read policy to
    every returned location and filters inaccessible locations and drawing
    anchors. The pair is mandatory for API use. Omitting both is reserved for
    trusted internal callers; it does not authorize an HTTP response.

    The function is read-only and does not mutate stored records or infer
    authority beyond Engine.authorize_read.
    """
    require(
        (party_id is None) == (role_id is None),
        "AUTHENTICATION_CONTEXT_INVALID",
        "party_id and role_id must be supplied together",
    )
    authenticated = party_id is not None
    if authenticated:
        # Membership is independent of child visibility. Never return project
        # metadata merely because there are no locations to authorize.
        role = engine.get("RoleAssignment", role_id)
        require(role["partyId"] == party_id, "NOT_AUTHORIZED",
                "Role does not belong to authenticated party")
        require(role["projectId"] == project_id, "PROJECT_MISMATCH",
                "Project assignment mismatch")
        now = instant(engine.at())
        require(role["active"] and instant(role["validFrom"]) <= now < instant(role["validTo"]),
                "ASSIGNMENT_EXPIRED", "Inactive or out of deployment period")
    project = engine.get("Project", project_id)
    _authoritative_version(project, "Project")
    locations = {
        object_id: deepcopy(record)
        for (kind, object_id), record in engine._records.items()
        if kind == "Location" and record.get("projectId") == project_id
    }
    if authenticated:
        locations = {
            location_id: record
            for location_id, record in locations.items()
            if _authorize_read(engine, record, party_id, role_id, is_location=True)
        }
    for record in locations.values():
        _authoritative_version(record, "Location")

    parent_by_id = {}
    issues_by_id = {location_id: [] for location_id in locations}
    for location_id, record in locations.items():
        parent_id = record.get("parentId")
        if not parent_id:
            parent_by_id[location_id] = None
        elif parent_id not in locations:
            # This also covers a parent record in a different project. Do not
            # return its identifier or any details from outside this project.
            parent_by_id[location_id] = None
            hidden_parent = engine._records.get(("Location", parent_id), {})
            issue_code = (
                "PARENT_NOT_VISIBLE"
                if hidden_parent.get("projectId") == project_id
                else "PARENT_NOT_IN_PROJECT"
            )
            issues_by_id[location_id].append(issue_code)
        else:
            parent_by_id[location_id] = parent_id

    display_parent = dict(parent_by_id)
    traversal_state = {location_id: 0 for location_id in locations}
    cycles = []

    # Location has at most one parent, so iterative path walks find every cycle
    # in O(n) time without recursion or unbounded traversal.
    for start_id in sorted(locations):
        if traversal_state[start_id] != 0:
            continue
        path = []
        path_positions = {}
        current_id = start_id
        while current_id is not None and traversal_state[current_id] == 0:
            traversal_state[current_id] = 1
            path_positions[current_id] = len(path)
            path.append(current_id)
            current_id = parent_by_id[current_id]

        if current_id in path_positions:
            cycle_ids = path[path_positions[current_id]:]
            display_root_id = min(cycle_ids)
            display_parent[display_root_id] = None
            cycles.append(tuple(sorted(cycle_ids)))
            for cycle_id in cycle_ids:
                issues_by_id[cycle_id].append("PARENT_CYCLE")

        for visited_id in path:
            traversal_state[visited_id] = 2

    children_by_id = {location_id: [] for location_id in locations}
    root_ids = []
    for location_id, parent_id in display_parent.items():
        if parent_id is None:
            root_ids.append(location_id)
        else:
            children_by_id[parent_id].append(location_id)

    for child_ids in children_by_id.values():
        child_ids.sort(key=lambda item: _sort_key(locations[item]))
    root_ids.sort(key=lambda item: _sort_key(locations[item]))

    depth_by_id = {}
    queue = deque((location_id, 0) for location_id in root_ids)
    ordered_ids = []
    while queue:
        location_id, depth = queue.popleft()
        # Defensive guard: the display graph should be a forest after cycle
        # breaks, but a repeated node must never produce duplicate output.
        if location_id in depth_by_id:
            continue
        depth_by_id[location_id] = depth
        ordered_ids.append(location_id)
        queue.extend(
            (child_id, depth + 1)
            for child_id in children_by_id[location_id]
        )

    # All stored nodes are reachable after dangling edges are detached and
    # cycles are broken. Keep a final deterministic fallback if the source
    # snapshot contains another malformed graph shape.
    for location_id in sorted(set(locations) - set(depth_by_id)):
        depth_by_id[location_id] = 0
        ordered_ids.append(location_id)
        root_ids.append(location_id)
        issues_by_id[location_id].append("TREE_DISCONNECTED")

    def reference_for(location_id):
        record = locations[location_id]
        return _ref(location_id, record["version"])

    items = []
    for location_id in ordered_ids:
        record = locations[location_id]
        source_parent_id = record.get("parentId")
        parent_ref = (
            reference_for(source_parent_id)
            if source_parent_id in locations
            else None
        )
        tree_parent_id = display_parent.get(location_id)
        item = {
            "reference": reference_for(location_id),
            "projectRef": {
                "objectType": "Project",
                "objectId": project["id"],
                "version": project["version"],
            },
            "name": record["name"],
            "semanticAnchor": record["semanticAnchor"],
            "parentRef": parent_ref,
            "treeParentRef": (
                reference_for(tree_parent_id)
                if tree_parent_id is not None
                else None
            ),
            "childRefs": [
                reference_for(child_id)
                for child_id in children_by_id[location_id]
            ],
            "depth": depth_by_id[location_id],
            "hierarchyIssues": sorted(set(issues_by_id[location_id])),
        }
        if "drawingAnchors" in record:
            item["drawingAnchors"] = (
                _readable_drawing_anchors(
                    engine,
                    record["drawingAnchors"],
                    project_id,
                    party_id,
                    role_id,
                )
                if authenticated
                else deepcopy(record["drawingAnchors"])
            )
        items.append(item)

    hierarchy_issues = [
        {
            "code": issue_code,
            "locationRef": reference_for(location_id),
        }
        for location_id, issue_codes in issues_by_id.items()
        for issue_code in issue_codes
    ]
    hierarchy_issues.sort(
        key=lambda item: (
            item["code"],
            item["locationRef"]["objectId"],
        )
    )

    return {
        "projectRef": {
            "objectType": "Project",
            "objectId": project["id"],
            "version": project["version"],
        },
        "rootRefs": [reference_for(location_id) for location_id in root_ids],
        "items": items,
        "hierarchyIssues": hierarchy_issues,
        "cycleRefs": [
            [reference_for(location_id) for location_id in cycle]
            for cycle in sorted(cycles)
        ],
    }


__all__ = ["query_location_tree"]
