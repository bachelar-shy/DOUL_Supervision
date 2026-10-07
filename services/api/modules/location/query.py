"""Read-only project-scoped Location tree projection.

The projection consumes authoritative Location records from the reference
engine. parentRef preserves the same-project domain link; treeParentRef is the
safe display edge after malformed/cyclic edges are handled. No location state,
authority, or write behavior is introduced here.
"""
from collections import deque
from copy import deepcopy


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


def query_location_tree(engine, project_id):
    """Return the current locations for one project as a safe flat tree.

    items is ordered breadth-first from the project roots. Each item has a
    stable versioned reference, source parentRef, safe treeParentRef, childRefs
    and depth. Missing/out-of-project parents are detached from the display
    tree and reported without exposing the foreign parent ID. A parent cycle
    is broken only in treeParentRef at its lexically smallest ID; the source
    references remain untouched and every cycle member is marked.

    The function is read-only and deliberately does not infer permissions or
    mutate stored records. Callers must perform project authorization before
    exposing this projection.
    """
    project = engine.get("Project", project_id)
    locations = {
        object_id: deepcopy(record)
        for (kind, object_id), record in engine._records.items()
        if kind == "Location" and record.get("projectId") == project_id
    }

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
            issues_by_id[location_id].append("PARENT_NOT_IN_PROJECT")
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
        return _ref(location_id, record.get("version", 1))

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
                "version": project.get("version", 1),
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
            item["drawingAnchors"] = deepcopy(record["drawingAnchors"])
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
            "version": project.get("version", 1),
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
