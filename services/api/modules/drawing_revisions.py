"""Read-only drawing revision context over existing authoritative records.

This module deliberately does not create a drawing lifecycle or infer which
revision is current for construction. Product 43 contains release/distribution
requirements that the present InformationItem schema cannot represent.
"""
from copy import deepcopy

from app.reference.validation import ContractError


def _is_readable(engine, record, party_id, role_id):
    try:
        engine.authorize_read(record, party_id, role_id)
    except ContractError:
        return False
    return True


def _exact_ref(reference, target):
    return (
        isinstance(reference, dict)
        and reference.get("objectType") == target["objectType"]
        and reference.get("objectId") == target["objectId"]
        and reference.get("version") == target["version"]
    )


def _ref(kind, record):
    return {"objectType": kind, "objectId": record["id"], "version": record["version"]}


def _record_summary(kind, record, link_field):
    return {
        "domainRef": _ref(kind, record),
        "title": record.get("title"),
        "status": record.get("status"),
        "linkField": link_field,
    }


def list_drawing_revision_records(engine, project_id, party_id, role_id):
    """List readable current Drawing InformationItems without ranking revisions.

    Each row is one authoritative InformationItem record. The function does
    not group by title, discipline, location, or revision label.
    """
    rows = []
    for (kind, _), record in engine._records.items():
        if kind != "InformationItem" or record.get("subtype") != "Drawing":
            continue
        if record.get("projectId") != project_id:
            continue
        if not _is_readable(engine, record, party_id, role_id):
            continue
        rows.append({
            "domainRef": _ref(kind, record),
            "title": record.get("title"),
            "revision": record.get("revision"),
            "sourceStatus": record.get("status"),
            "discipline": record.get("discipline"),
            "packageId": record.get("packageId"),
            "locationId": record.get("locationId"),
            "fileIds": deepcopy(record.get("fileIds", [])),
        })
    rows.sort(key=lambda row: (row.get("title") or "", row["domainRef"]["objectId"]))
    return rows


def build_drawing_revision_context(engine, project_id, drawing_ref, party_id, role_id):
    """Build a read-only context for one exact InformationItem version.

    Links are included only when an authoritative exact-version reference
    exists in Approval.targetRef, record.drawingRef, or record.relatedRefs.
    No join is inferred from title, location, package, or revision text.
    """
    if not isinstance(drawing_ref, dict) or drawing_ref.get("objectType") != "InformationItem":
        raise ContractError("REFERENCE_TYPE_INVALID", "Drawing reference must target InformationItem")

    drawing = engine.resolve(drawing_ref, project_id)
    if drawing.get("subtype") != "Drawing":
        raise ContractError("REFERENCE_TYPE_INVALID", "Reference must target a Drawing InformationItem")
    if not _is_readable(engine, drawing, party_id, role_id):
        raise ContractError("NOT_AUTHORIZED", "Drawing is not available to this role")

    target = {
        "objectType": "InformationItem",
        "objectId": drawing["id"],
        "version": drawing_ref["version"],
    }
    related_by_ref = {}
    for linked_ref in drawing.get("relatedRefs", []):
        linked_record = engine.resolve(linked_ref, project_id)
        linked_kind = linked_ref["objectType"]
        if _is_readable(engine, linked_record, party_id, role_id):
            summary = _record_summary(linked_kind, linked_record, "relatedRefs")
            key = (linked_kind, linked_record["id"], linked_record["version"])
            related_by_ref[key] = summary

    for (kind, _), candidate in engine._records.items():
        if candidate.get("projectId") != project_id:
            continue
        links = []
        if kind == "Approval" and _exact_ref(candidate.get("targetRef"), target):
            links.append("targetRef")
        if _exact_ref(candidate.get("drawingRef"), target):
            links.append("drawingRef")
        if any(_exact_ref(ref, target) for ref in candidate.get("relatedRefs", [])):
            links.append("relatedRefs")
        if not links or not _is_readable(engine, candidate, party_id, role_id):
            continue
        summary = _record_summary(kind, candidate, links[0])
        key = (kind, candidate["id"], candidate["version"])
        related_by_ref.setdefault(key, summary)

    related = sorted(related_by_ref.values(), key=lambda item: (
        item["domainRef"]["objectType"],
        item["domainRef"]["objectId"],
        item["domainRef"]["version"],
    ))
    return {
        "drawing": {
            "domainRef": target,
            "title": drawing.get("title"),
            "revision": drawing.get("revision"),
            "sourceStatus": drawing.get("status"),
            "discipline": drawing.get("discipline"),
            "packageId": drawing.get("packageId"),
            "locationId": drawing.get("locationId"),
            "fileIds": deepcopy(drawing.get("fileIds", [])),
        },
        "exactLinkedRecords": related,
        "releaseReadinessDiagnostic": {
            "result": "unknown",
            "isOfficialWorkflowState": False,
            "code": "DRAWING_RELEASE_DATA_UNAVAILABLE",
            "unknownBecause": [
                "issuedFor is not represented on the current Drawing InformationItem schema",
                "releaseAt and supersedesRef are not represented on the current Drawing InformationItem schema",
                "required field distribution/transmittal completion is not represented by the current schema",
            ],
        },
    }
