"""Read-only, permission-aware traceability context for safety stop orders.

This module follows only persisted references. It is a diagnostic projection, not a
workflow gate, command handler, or source of derived official state.
"""
from app.reference.validation import ContractError


_LINK_FIELDS = (
    ("affectedPermitRefs", "affectedPermitRefs"),
    ("issueRefs", "issueRefs"),
    ("correctiveActionRefs", "correctiveActionRefs"),
    ("resumeVerificationRefs", "resumeVerificationRefs"),
    ("ownerReportRefs", "ownerReportRefs"),
)
_EXPECTED_TYPES = {
    "affectedPermitRefs": "WorkItem",
    "issueRefs": "Issue",
    "correctiveActionRefs": "Action",
    "resumeVerificationRefs": "Inspection",
    "ownerReportRefs": "InformationItem",
}
_EXPECTED_SUBTYPES = {
    "affectedPermitRefs": "SafetyPermit",
    "ownerReportRefs": "Report",
}
_ISSUE_ID_FIELDS = (("actionIds", "Action"), ("inspectionIds", "Inspection"))
_AUTHORIZATION_DENIAL_CODES = {
    "ASSIGNMENT_EXPIRED",
    "AUTHORITY_DENIED",
    "NONHUMAN_OFFICIAL_DENIED",
    "NOT_AUTHORIZED",
    "NOT_FOUND",
    "ORGANIZATION_MISMATCH",
    "PERMISSION_DENIED",
    "PROJECT_MISMATCH",
    "QUALIFICATION_INVALID",
    "SCOPE_MISMATCH",
}


def _valid_version(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _matches_record(record, kind, object_id, version=None):
    return (record.get("id") == object_id
            and record.get("objectType", kind) == kind
            and _valid_version(record.get("version"))
            and (version is None or record["version"] == version))


def _diagnostic(relation, source_field, status):
    # Never include a target id, title, or exception message for inaccessible links.
    return {
        "relation": relation,
        "sourceField": source_field,
        "status": status,
        "target": None,
    }


def _row(relation, source_field, *, reference, version_resolution, record):
    return {
        "relation": relation,
        "sourceField": source_field,
        "status": "readable",
        "reference": reference,
        "versionResolution": version_resolution,
        "record": {
            "version": record.get("version"),
            "subtype": record.get("subtype"),
            "status": record.get("status"),
            "locationId": record.get("locationId"),
        },
    }


def _classify_error(error):
    if error.code == "OBJECT_NOT_FOUND":
        return "missing"
    if error.code in {"PROJECT_MISMATCH", "CROSS_PROJECT_REFERENCE"}:
        return "foreign_project"
    if error.code in {
        "SCOPE_MISMATCH", "AUTHORITY_DENIED", "NOT_AUTHORIZED",
        "PERMISSION_DENIED", "NOT_FOUND", "ASSIGNMENT_EXPIRED",
        "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID",
        "NONHUMAN_OFFICIAL_DENIED",
    }:
        return "unauthorized"
    return "invalid_reference"


def _authorize_link(engine, record, party_id, role_id, relation, source_field, diagnostics):
    try:
        engine.authorize_read(record, party_id, role_id)
    except ContractError as error:
        if error.code not in _AUTHORIZATION_DENIAL_CODES:
            raise
        diagnostics.append(_diagnostic(relation, source_field, _classify_error(error)))
        return False
    return True


def _add_domain_ref(engine, ref, project_id, party_id, role_id, relation,
                    source_field, rows, diagnostics, *, expected_type, expected_subtype=None):
    if not isinstance(ref, dict) or not {"objectType", "objectId", "version"} <= set(ref):
        diagnostics.append(_diagnostic(relation, source_field, "invalid_reference"))
        return None
    if (ref["objectType"] != expected_type or not isinstance(ref["objectId"], str)
            or not ref["objectId"] or not _valid_version(ref["version"])):
        diagnostics.append(_diagnostic(relation, source_field, "invalid_reference"))
        return None
    try:
        record = engine.resolve(ref, project_id)
    except ContractError as error:
        diagnostics.append(_diagnostic(relation, source_field, _classify_error(error)))
        return None
    if (not _matches_record(record, expected_type, ref["objectId"], ref["version"])
            or (expected_subtype and record.get("subtype") != expected_subtype)):
        diagnostics.append(_diagnostic(relation, source_field, "invalid_reference"))
        return None
    if not _authorize_link(engine, record, party_id, role_id, relation, source_field, diagnostics):
        return None
    safe_ref = {
        "objectType": ref["objectType"],
        "objectId": ref["objectId"],
        "version": ref["version"],
    }
    rows.append(_row(
        relation, source_field, reference=safe_ref,
        version_resolution="exact_historical_version", record=record,
    ))
    return record


def _add_current_id(engine, object_type, object_id, project_id, party_id, role_id,
                    relation, source_field, rows, diagnostics):
    if not isinstance(object_id, str) or not object_id:
        diagnostics.append(_diagnostic(relation, source_field, "invalid_reference"))
        return None
    try:
        record = engine.get(object_type, object_id)
    except ContractError as error:
        diagnostics.append(_diagnostic(relation, source_field, _classify_error(error)))
        return None
    if record.get("projectId") != project_id:
        diagnostics.append(_diagnostic(relation, source_field, "foreign_project"))
        return None
    if not _matches_record(record, object_type, object_id):
        diagnostics.append(_diagnostic(relation, source_field, "invalid_reference"))
        return None
    authorization_record = record
    if object_type == "Location":
        # Engine scope checks use locationId, while the Location object schema
        # stores only id. This transient adapter is authorization context only.
        authorization_record = dict(record, locationId=record["id"])
    if not _authorize_link(
        engine, authorization_record, party_id, role_id,
        relation, source_field, diagnostics,
    ):
        return None
    rows.append(_row(
        relation, source_field,
        reference={"objectType": object_type, "objectId": object_id, "version": None},
        version_resolution="current_lookup_only_no_version_in_source",
        record=record,
    ))
    return record


def _trace_context(engine, record, project_id, party_id, role_id, relation_prefix,
                   source_field_prefix, rows, diagnostics):
    """Follow exact drawing refs and current-lookup location/evidence identifiers."""
    drawing_ref = record.get("drawingRef")
    if drawing_ref:
        _add_domain_ref(
            engine, drawing_ref, project_id, party_id, role_id,
            relation_prefix + ".drawing", source_field_prefix + ".drawingRef",
            rows, diagnostics, expected_type="InformationItem", expected_subtype="Drawing",
        )
    location_id = record.get("locationId")
    if location_id:
        _add_current_id(
            engine, "Location", location_id, project_id, party_id, role_id,
            relation_prefix + ".location", source_field_prefix + ".locationId",
            rows, diagnostics,
        )
    for evidence_id in record.get("evidenceIds", []):
        _add_current_id(
            engine, "Evidence", evidence_id, project_id, party_id, role_id,
            relation_prefix + ".evidence", source_field_prefix + ".evidenceIds",
            rows, diagnostics,
        )


def build_safety_stop_traceability(engine, stop_order_ref, party_id, role_id):
    """Build a read-only traceability projection for an exact SafetyStopOrder version.

    DomainRef fields retain their recorded historical versions. Fields represented
    only as UUID identifiers (such as locationId/evidenceIds/actionIds) are resolved
    as current lookups and explicitly labeled as such.
    """
    if not isinstance(stop_order_ref, dict) or not {
        "objectType", "objectId", "version"
    } <= set(stop_order_ref):
        raise ContractError("REFERENCE_INVALID", "SafetyStopOrder reference is invalid")
    if stop_order_ref.get("objectType") != "WorkItem":
        raise ContractError("REFERENCE_TYPE_INVALID", "SafetyStopOrder must be a WorkItem")
    if (not isinstance(stop_order_ref["objectId"], str) or not stop_order_ref["objectId"]
            or not _valid_version(stop_order_ref["version"])):
        raise ContractError("REFERENCE_INVALID", "SafetyStopOrder reference is invalid")
    root = engine.resolve(stop_order_ref)
    if (not _matches_record(root, "WorkItem", stop_order_ref["objectId"], stop_order_ref["version"])
            or root.get("subtype") != "SafetyStopOrder"):
        raise ContractError("REFERENCE_TYPE_INVALID", "WorkItem is not a SafetyStopOrder")
    engine.authorize_read(root, party_id, role_id)

    project_id = root["projectId"]
    rows = []
    diagnostics = []
    _trace_context(
        engine, root, project_id, party_id, role_id, "stopOrder", "stopOrder",
        rows, diagnostics,
    )

    data = root.get("data", {})
    resolved = {}
    for field, relation in _LINK_FIELDS:
        for ref in data.get(field, []):
            linked = _add_domain_ref(
                engine, ref, project_id, party_id, role_id,
                relation, "data." + field, rows, diagnostics,
                expected_type=_EXPECTED_TYPES[field],
                expected_subtype=_EXPECTED_SUBTYPES.get(field),
            )
            if linked is not None:
                resolved.setdefault(field, []).append(linked)
                _trace_context(
                    engine, linked, project_id, party_id, role_id,
                    relation, "data." + field, rows, diagnostics,
                )

    # Issue references explicitly carry the corrective/reinspection chain's
    # source object identities. Follow the stored Issue actionIds/inspectionIds;
    # they do not carry historical versions and are labeled current-lookup-only.
    for issue in resolved.get("issueRefs", []):
        for id_field, object_type in _ISSUE_ID_FIELDS:
            for object_id in issue.get(id_field, []):
                child = _add_current_id(
                    engine, object_type, object_id, project_id, party_id, role_id,
                    "issue." + id_field, "Issue." + id_field, rows, diagnostics,
                )
                if child is not None:
                    _trace_context(
                        engine, child, project_id, party_id, role_id,
                        "issue." + id_field, "Issue." + id_field,
                        rows, diagnostics,
                    )

    return {
        "readOnly": True,
        "officialStateChanged": False,
        "rootReference": {
            "objectType": stop_order_ref["objectType"],
            "objectId": stop_order_ref["objectId"],
            "version": stop_order_ref["version"],
        },
        "links": rows,
        "diagnostics": diagnostics,
    }
