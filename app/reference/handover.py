"""Contract 34 domain gates and server effects for completion workflows.

The reference engine owns transactions, state changes, authority checks and
audit events. This module supplies F-07's cross-object gates and derived data
for its three WorkItem machines.
"""
from copy import deepcopy
from datetime import timedelta

from .validation import ContractError, instant, require


MACHINES = {"commissioning_package", "handover_package", "warranty_claim"}
_GUARD_NAMES = {
    "commissioning_scope_current", "commissioning_prerequisites_ready",
    "commissioning_precommissioning_complete", "commissioning_test_start_ready",
    "commissioning_test_result_ready", "commissioning_test_accept_ready",
    "commissioning_test_reject_ready", "commissioning_punch_resolution_ready",
    "commissioning_retest_ready", "commissioning_handover_ready",
    "commissioning_close_ready", "handover_package_submission_ready",
    "handover_return_ready", "handover_readiness_review_ready",
    "handover_owner_review_ready", "handover_reservation_accept_ready",
    "handover_accept_ready", "handover_partial_scope_ready",
    "handover_final_scope_ready", "handover_close_ready",
    "warranty_report_ready", "warranty_acknowledgement_ready",
    "warranty_applicability_ready", "warranty_remedy_required_ready",
    "warranty_remedy_start_ready", "warranty_remedy_submission_ready",
    "warranty_reinspection_passed", "warranty_reinspection_failed",
    "warranty_close_ready",
}

_COMMISSIONING_SERVER_FIELDS = {
    "testResultRefs", "testResultHistory", "readinessStatus", "readyAt",
    "closedAt", "lastTestResultAt", "lastTestOutcome",
}
_HANDOVER_SERVER_FIELDS = {
    "ownerAcceptanceRef", "reservations", "handoverReady", "readinessStatus",
    "readinessBlockers", "handoverDate", "acceptedDocumentRefs", "closedAt",
    "warrantyStartAt",
}
_WARRANTY_SERVER_FIELDS = {
    "remedyEvidenceIds", "reinspectionHistoryRefs", "closureEvidenceRefs",
    "assessedAt", "acknowledgedAt", "reportedAt", "remedyStartedAt",
    "remedySubmittedAt", "acceptedAt", "closedAt", "recordedBy",
}
_COMMAND_FIELDS = {
    "declare_test_ready": {"precommissioningChecklist"},
    "submit_test_result": {"testResultRef", "outcome", "acceptanceCriteriaMet", "failureReason"},
    "reject_test": {"failureReason"},
    "require_punch_resolution": {"punchIssueRefs", "correctionActionRefs"},
    "request_retest": {"retestBasisRefs"},
    "return_handover": {"returnReason", "missingItems"},
    "accept_with_reservations": {"ownerDecisionRef", "ownerReservationInputs"},
    "accept_handover": {"ownerDecisionRef"},
    "record_partial_handover": {"acceptedScope", "effectiveAt", "warrantyTrigger"},
    "record_final_handover": {"effectiveAt", "warrantyTrigger"},
    "require_remedy": {"actionRefs", "responseDueAt"},
    "submit_remedy": {"remedySummary"},
    "accept_remedy": {"reinspectionRef"},
    "require_rework": {"reinspectionRef", "reworkReason"},
    "close_warranty_claim": {"closureRef", "ownerDecisionRef"},
}
_ACCEPTED_REF_STATUSES = {"approved", "accepted", "active", "current", "effective", "verified", "passed", "completed", "closed", "released", "final", "signed"}
_ISSUE_OPEN = {"open", "assigned", "in_progress", "ready_for_recheck", "reinspection", "rework_required"}
_ACTION_VERIFIED = {"verified", "closed"}
_REQUIRED_DOCUMENT_KEYS = {"asBuilt", "omManual", "training", "spareParts", "certificates", "statutoryAcceptance"}


def _data(record):
    return record.setdefault("data", {})


def _ref(engine, reference, project_id, object_type=None, subtypes=None, statuses=None, *, current=True, code="REFERENCE_INVALID"):
    require(isinstance(reference, dict), code, "An exact typed reference is required")
    if object_type:
        allowed = {object_type} if isinstance(object_type, str) else set(object_type)
        require(reference.get("objectType") in allowed, code, "Reference has the wrong object type")
    record = engine.resolve(reference, project_id)
    if current:
        latest = engine.get(reference["objectType"], reference["objectId"])
        require(latest["version"] == reference["version"], "REFERENCE_STALE", reference["objectId"])
        record = latest
    if subtypes:
        allowed = {subtypes} if isinstance(subtypes, str) else set(subtypes)
        require(record.get("subtype") in allowed, code, "Reference has the wrong subtype")
    if statuses:
        allowed = set(statuses)
        require(record.get("status") in allowed, code, "Referenced record is not in an eligible state")
    return record


def _refs(engine, references, project_id, object_type=None, subtypes=None, statuses=None, *, current=True, code="REFERENCE_INVALID", nonempty=False):
    require(isinstance(references, list), code, "A reference list is required")
    if nonempty:
        require(bool(references), code, "At least one exact reference is required")
    records = []
    seen = set()
    for reference in references:
        identity = (reference.get("objectType"), reference.get("objectId")) if isinstance(reference, dict) else None
        require(identity not in seen, "REFERENCE_DUPLICATE", "Duplicate exact references are not allowed")
        seen.add(identity)
        records.append(_ref(engine, reference, project_id, object_type, subtypes, statuses, current=current, code=code))
    return records


def _profile(engine, reference, record, key):
    profile = _ref(engine, reference, record["projectId"], "Requirement", statuses={"active"}, code="CONTRACT_PROFILE_REQUIRED")
    require(instant(profile.get("effectiveFrom", "")) <= instant(engine.at()) and (not profile.get("effectiveTo") or instant(engine.at()) < instant(profile["effectiveTo"])), "CONTRACT_PROFILE_STALE", "Exact contract profile is outside its effective period")
    require(all(profile.get(k) == record.get(k) for k in ("packageId", "locationId", "discipline")), "SCOPE_MISMATCH", "Contract profile scope must match this package")
    rule = profile.get("applicability", {}).get(key)
    require(isinstance(rule, dict), "CONTRACT_PROFILE_REQUIRED", f"Exact active Requirement needs applicability.{key}")
    return rule


def _same_scope(source, target):
    return all(source.get(field) == target.get(field) for field in ("packageId", "locationId", "discipline", "responsibleOrganizationId"))


def _approved_drawing(engine, record):
    require(record.get("drawingRef"), "COMMISSIONING_DRAWING_REQUIRED", "A current approved drawing is required")
    drawing = _ref(engine, record["drawingRef"], record["projectId"], "InformationItem", "Drawing", code="COMMISSIONING_DRAWING_REQUIRED")
    require(drawing.get("status") in _ACCEPTED_REF_STATUSES and engine._drawing_has_approval(drawing) and engine._drawing_field_usable(drawing), "DRAWING_STALE", "Drawing is not approved for field use")
    return drawing


def _requirement_refs(engine, record):
    refs = record.get("requirementRefs") or []
    _refs(engine, refs, record["projectId"], "Requirement", statuses={"active"}, code="REQUIREMENT_STALE", nonempty=True)
    return refs


def _scope_within(role, scope, original=None, *, strict=False):
    require(isinstance(scope, dict), "HANDOVER_SCOPE_INVALID", "Exact handover scope is required")
    require(bool(scope.get("scopeId", "").strip()) and bool(scope.get("system", "").strip()), "HANDOVER_SCOPE_INVALID", "Scope identity and system are required")
    locations = scope.get("locationIds")
    require(isinstance(locations, list) and bool(locations) and len(set(locations)) == len(locations), "HANDOVER_SCOPE_INVALID", "Exact non-empty unique location scope is required")
    require(all(isinstance(location_id, str) and location_id for location_id in locations), "HANDOVER_SCOPE_INVALID", "Location scope cannot be empty")
    if original is not None:
        require(scope["scopeId"] == original["scopeId"] and scope["system"] == original["system"], "HANDOVER_SCOPE_MISMATCH", "A partial acceptance must retain the original scope identity")
        allowed_locations = set(original["locationIds"])
        allowed_assets = {(x["objectType"], x["objectId"], x["version"]) for x in original.get("assetRefs", [])}
        require(set(locations) <= allowed_locations, "HANDOVER_SCOPE_MISMATCH", "Partial acceptance cannot add locations")
        asset_refs = scope.get("assetRefs", [])
        require({(x["objectType"], x["objectId"], x["version"]) for x in asset_refs} <= allowed_assets, "HANDOVER_SCOPE_MISMATCH", "Partial acceptance cannot add assets or change asset versions")
        is_equal = set(locations) == allowed_locations and {(x["objectType"], x["objectId"], x["version"]) for x in asset_refs} == allowed_assets
        if strict:
            require(not is_equal, "HANDOVER_SCOPE_NOT_PARTIAL", "Use final handover for the complete submitted scope")
    else:
        asset_refs = scope.get("assetRefs", [])
    return locations, asset_refs


def initialize_create(engine, machine, record):
    """Reject caller-supplied derived fields and initialize machine-owned values."""
    if machine not in MACHINES:
        return
    data = _data(record)
    protected = (_COMMISSIONING_SERVER_FIELDS if machine == "commissioning_package" else
                 _HANDOVER_SERVER_FIELDS if machine == "handover_package" else _WARRANTY_SERVER_FIELDS)
    protected = set(protected)
    if machine == "commissioning_package":
        protected |= {"testResultRef", "outcome", "acceptanceCriteriaMet", "failureReason", "retestBasisRefs"}
    elif machine == "handover_package":
        protected |= {"ownerDecisionRef", "ownerReservationInputs", "returnReason", "missingItems", "effectiveAt", "acceptedScope", "warrantyTrigger"}
    else:
        protected |= {"remedySummary", "reworkReason", "ownerDecisionRef", "reinspectionRef", "closureRef"}
    forged = protected & set(data)
    require(not forged, "IMMUTABLE_FIELD", "Server-derived fields cannot be supplied: " + ", ".join(sorted(forged)))
    if machine == "commissioning_package":
        data.update(testResultRefs=[], testResultHistory=[], readinessStatus="pending")
    elif machine == "handover_package":
        data.update(reservations=[], handoverReady=False, readinessStatus="pending", readinessBlockers=[], acceptedDocumentRefs=[])
    else:
        data.update(remedyEvidenceIds=[], reinspectionHistoryRefs=[], closureEvidenceRefs=[])


def _commissioning(engine, guard, record, role):
    data = _data(record)
    project = record["projectId"]
    if guard == "commissioning_scope_current":
        require(bool(data.get("commissioningNo", "").strip()) and bool(data.get("system", "").strip()), "COMMISSIONING_SCOPE_CURRENT", "Commissioning package number and system are required")
        profile = _profile(engine, data.get("commissioningProfileRef"), record, "commissioningProfile")
        for flag in ("requiresMaterialReadiness", "requiresEquipmentReadiness", "requiresCalibration", "requiresUtilities", "requiresSafetyPermit", "requiresTestWitness"):
            require(type(profile.get(flag)) is bool, "CONTRACT_PROFILE_REQUIRED", f"Commissioning profile must explicitly define {flag}")
        _requirement_refs(engine, record)
        _approved_drawing(engine, record)
        procedures = _refs(engine, data.get("testProcedureRefs"), project, "InformationItem", current=True, code="COMMISSIONING_PROCEDURE_INVALID", nonempty=True)
        for procedure in procedures:
            require(procedure.get("subtype") == "MethodStatement" and procedure.get("status") in _ACCEPTED_REF_STATUSES, "COMMISSIONING_PROCEDURE_INVALID", "Test procedure must be a current approved MethodStatement")
        required_procedures = profile.get("requiredTestProcedureRefs")
        require(isinstance(required_procedures, list), "CONTRACT_PROFILE_REQUIRED", "Commissioning profile must define requiredTestProcedureRefs")
        require(set(map(_ref_key, required_procedures)) <= set(map(_ref_key, data.get("testProcedureRefs", []))), "COMMISSIONING_PROCEDURE_INVALID", "Profile-required current test procedures are missing")
        _refs(engine, data.get("prerequisiteInspectionRefs"), project, "Inspection", current=True, code="COMMISSIONING_PREREQUISITE_INVALID", nonempty=True)
        for item in data.get("prerequisiteInspectionRefs", []):
            inspection = _ref(engine, item, project, "Inspection", current=True, code="COMMISSIONING_PREREQUISITE_INVALID")
            require(inspection.get("resultStatus") == "pass" and inspection.get("nextWorkAllowed") is True and inspection.get("status") in {"passed", "completed"}, "COMMISSIONING_PREREQUISITE_INVALID", "Prerequisite inspection must pass and release its hold point")
            if inspection.get("locationId"):
                require(engine._scope(role.get("locationIds", []), inspection["locationId"], True), "SCOPE_MISMATCH", "Prerequisite inspection exceeds active role location scope")
        _refs(engine, data.get("materialReadinessRefs"), project, ["WorkItem", "InformationItem"], current=True, code="COMMISSIONING_MATERIAL_NOT_READY")
        _refs(engine, data.get("equipmentReadinessRefs"), project, ["WorkItem", "InformationItem"], current=True, code="COMMISSIONING_EQUIPMENT_NOT_READY")
        _refs(engine, data.get("calibrationRefs"), project, ["InformationItem", "Requirement"], current=True, code="COMMISSIONING_CALIBRATION_INVALID")
        _refs(engine, data.get("utilityReadinessRefs"), project, ["Evidence", "InformationItem"], current=True, code="COMMISSIONING_UTILITIES_INVALID")
        _refs(engine, data.get("safetyPermitRefs"), project, "WorkItem", current=True, code="COMMISSIONING_SAFETY_PERMIT_INVALID")
        _refs(engine, data.get("integratedTestRefs"), project, ["Evidence", "InformationItem"], current=True, code="COMMISSIONING_INTEGRATED_TEST_INVALID")
        required_integrated = profile.get("requiredIntegratedTestRefs")
        require(isinstance(required_integrated, list), "CONTRACT_PROFILE_REQUIRED", "Commissioning profile must define requiredIntegratedTestRefs")
        require(set(map(_ref_key, required_integrated)) <= set(map(_ref_key, data.get("integratedTestRefs", []))), "COMMISSIONING_INTEGRATED_TEST_INVALID", "Profile-required integrated tests are missing")
        for reference, result in zip(data.get("calibrationRefs", []), _refs(engine, data.get("calibrationRefs", []), project, ["InformationItem", "Requirement"], current=True, code="COMMISSIONING_CALIBRATION_INVALID")):
            if reference["objectType"] == "Requirement":
                require(result.get("status") == "active", "COMMISSIONING_CALIBRATION_INVALID", "Calibration Requirement must be active")
            else:
                require(result.get("subtype") == "Certificate", "COMMISSIONING_CALIBRATION_INVALID", "Calibration evidence must be an accepted Certificate InformationItem")
                _date_current(result, engine, "COMMISSIONING_CALIBRATION_INVALID")
        for reference, result in zip(data.get("utilityReadinessRefs", []), _refs(engine, data.get("utilityReadinessRefs", []), project, ["Evidence", "InformationItem"], current=True, code="COMMISSIONING_UTILITIES_INVALID")):
            if reference["objectType"] == "InformationItem":
                require(result.get("status") in _ACCEPTED_REF_STATUSES, "COMMISSIONING_UTILITIES_INVALID", "Utility/temporary-condition record is not accepted")
    elif guard == "commissioning_prerequisites_ready":
        _commissioning(engine, "commissioning_scope_current", record, role)
        profile = _profile(engine, data["commissioningProfileRef"], record, "commissioningProfile")
        if profile.get("requiresMaterialReadiness") is True:
            _accepted_readiness(engine, data.get("materialReadinessRefs", []), project, "COMMISSIONING_MATERIAL_NOT_READY", work_subtypes={"MaterialSubmittal"})
        if profile.get("requiresEquipmentReadiness") is True:
            _accepted_readiness(engine, data.get("equipmentReadinessRefs", []), project, "COMMISSIONING_EQUIPMENT_NOT_READY", work_subtypes={"SafetyEquipmentInspection"})
        if profile.get("requiresCalibration") is True:
            require(bool(data.get("calibrationRefs")), "COMMISSIONING_CALIBRATION_INVALID", "Current calibration/certificate references are required")
            for reference in data["calibrationRefs"]:
                if reference["objectType"] != "Requirement":
                    _date_current(_ref(engine, reference, project, current=True), engine, "COMMISSIONING_CALIBRATION_INVALID")
        if profile.get("requiresUtilities") is True:
            require(bool(data.get("utilityReadinessRefs")), "COMMISSIONING_UTILITIES_INVALID", "Utility/temporary condition evidence is required")
        if profile.get("requiresSafetyPermit") is True:
            permits = _refs(engine, data.get("safetyPermitRefs", []), project, "WorkItem", current=True, code="COMMISSIONING_SAFETY_PERMIT_INVALID", nonempty=True)
            require(all(x.get("subtype") == "SafetyPermit" and x.get("data", {}).get("workAuthorized") is True for x in permits), "COMMISSIONING_SAFETY_PERMIT_INVALID", "Applicable safety permits must be current and authorized")
    elif guard == "commissioning_precommissioning_complete":
        profile = _profile(engine, data.get("commissioningProfileRef"), record, "commissioningProfile")
        checklist = {item["itemId"]: item for item in data.get("precommissioningChecklist", [])}
        required = profile.get("requiredPrecommissioningItemIds")
        require(isinstance(required, list) and bool(required), "CONTRACT_PROFILE_REQUIRED", "Commissioning profile must define required pre-commissioning checklist items")
        require(set(required) <= set(checklist), "COMMISSIONING_CHECKLIST_INCOMPLETE", "Required checklist items are missing")
        for item_id in required:
            item = checklist[item_id]
            require(item.get("completed") is True and bool(item.get("evidenceIds")), "COMMISSIONING_CHECKLIST_INCOMPLETE", item_id)
            _evidence(engine, item["evidenceIds"], record, role)
    elif guard == "commissioning_test_start_ready":
        _commissioning(engine, "commissioning_scope_current", record, role)
        profile = _profile(engine, data.get("commissioningProfileRef"), record, "commissioningProfile")
        _approved_drawing(engine, record)
        require(bool(data.get("testProcedureRefs")), "COMMISSIONING_PROCEDURE_INVALID", "Approved test procedure is required")
        procedures = _refs(engine, data["testProcedureRefs"], project, "InformationItem", current=True, code="COMMISSIONING_PROCEDURE_INVALID", nonempty=True)
        require(all(item.get("subtype") == "MethodStatement" and item.get("status") in _ACCEPTED_REF_STATUSES for item in procedures), "COMMISSIONING_PROCEDURE_INVALID", "Test procedure must be an approved MethodStatement")
        if profile.get("requiresTestWitness") is True:
            require(bool(data.get("testWitnessPartyIds")), "COMMISSIONING_WITNESS_REQUIRED", "Configured test witness is required")
            for party_id in data["testWitnessPartyIds"]:
                party = engine.get("Party", party_id)
                assignments = [assignment for (kind, _), assignment in engine._records.items()
                               if kind == "RoleAssignment" and assignment.get("partyId") == party_id
                               and assignment.get("projectId") == project and assignment.get("active")
                               and assignment.get("actorGroup") in {"SUP", "DES", "OWN"}
                               and engine._scope(assignment.get("packageIds", []), record.get("packageId"))
                               and engine._scope(assignment.get("locationIds", []), record.get("locationId"), True)
                               and engine._scope(assignment.get("disciplines", []), record.get("discipline"))]
                require(party.get("projectId") == project and party_id != record.get("createdBy") and bool(assignments), "COMMISSIONING_WITNESS_REQUIRED", "Witness must be an independent project technical/Owner participant assigned to this scope")
    elif guard == "commissioning_test_result_ready":
        result_ref = data.get("testResultRef")
        _ref(engine, result_ref, project, "Evidence", current=True, code="COMMISSIONING_TEST_RESULT_REQUIRED")
        prior = data.get("testResultRefs", [])
        require(_ref_key(result_ref) not in {_ref_key(x) for x in prior}, "COMMISSIONING_TEST_RESULT_DUPLICATE", "Retest must use a new immutable test result evidence record")
        require(data.get("outcome") in {"pass", "fail"} and type(data.get("acceptanceCriteriaMet")) is bool, "COMMISSIONING_TEST_RESULT_INVALID", "Test result needs a recorded outcome and acceptance result")
        if data["outcome"] == "fail" or data["acceptanceCriteriaMet"] is False:
            require(bool(data.get("failureReason", "").strip()), "COMMISSIONING_FAILURE_REASON_REQUIRED", "Failed result needs a reason")
    elif guard == "commissioning_test_accept_ready":
        latest = _latest_test(data)
        require(latest is not None and latest["outcome"] == "pass" and latest["acceptanceCriteriaMet"] is True, "COMMISSIONING_TEST_NOT_ACCEPTABLE", "Supervisor can accept only a passing result that meets criteria")
        _ref(engine, latest["testResultRef"], project, "Evidence", current=True, code="COMMISSIONING_TEST_RESULT_REQUIRED")
    elif guard == "commissioning_test_reject_ready":
        latest = _latest_test(data)
        require(latest is not None and (latest["outcome"] == "fail" or latest["acceptanceCriteriaMet"] is False), "COMMISSIONING_TEST_NOT_FAILED", "Reject requires a failed result")
        require(bool(data.get("failureReason", "").strip()), "COMMISSIONING_FAILURE_REASON_REQUIRED", "Supervisor rejection needs a reason")
    elif guard == "commissioning_punch_resolution_ready":
        issues = _refs(engine, data.get("punchIssueRefs", []), project, "Issue", subtypes="Punch", current=True, code="COMMISSIONING_PUNCH_REQUIRED", nonempty=True)
        actions = _refs(engine, data.get("correctionActionRefs", []), project, "Action", current=True, code="COMMISSIONING_PUNCH_ACTION_REQUIRED", nonempty=True)
        issue_ids = {x["id"] for x in issues}
        require(all(x.get("relatedIssueId") in issue_ids for x in actions), "COMMISSIONING_PUNCH_ACTION_REQUIRED", "Punch correction Actions must belong to a referenced Punch Issue")
        require(any(x.get("status") in _ISSUE_OPEN for x in issues), "COMMISSIONING_PUNCH_REQUIRED", "Punch Issue must remain open while in punch resolution")
    elif guard == "commissioning_retest_ready":
        refs = _refs(engine, data.get("retestBasisRefs", []), project, "Action", current=True, code="COMMISSIONING_RETEST_BASIS_REQUIRED", nonempty=True)
        require(all(x.get("status") in _ACTION_VERIFIED for x in refs), "COMMISSIONING_RETEST_BASIS_REQUIRED", "Correction Actions must be verified before a retest")
        require(set(_ref_key(x) for x in data["retestBasisRefs"]) <= set(_ref_key(x) for x in data.get("correctionActionRefs", [])), "COMMISSIONING_RETEST_BASIS_REQUIRED", "Retest basis must be linked to this package's corrective Actions")
        require(_latest_test(data) is not None and _latest_test(data)["outcome"] == "fail", "COMMISSIONING_RETEST_BASIS_REQUIRED", "Retest is available only after a failed test")
    elif guard == "commissioning_handover_ready":
        latest = _latest_test(data)
        require(latest is not None and latest["outcome"] == "pass" and latest["acceptanceCriteriaMet"] is True, "COMMISSIONING_NOT_READY", "Required test results must pass")
        _commissioning(engine, "commissioning_prerequisites_ready", record, role)
        issues = _refs(engine, data.get("punchIssueRefs", []), project, "Issue", subtypes="Punch", current=True, code="COMMISSIONING_PUNCH_BLOCKED")
        require(all(x.get("status") not in _ISSUE_OPEN for x in issues), "COMMISSIONING_PUNCH_BLOCKED", "Blocking Punch Issues must be closed before commissioning readiness")
    elif guard == "commissioning_close_ready":
        require(record.get("status") == "ready_for_handover", "COMMISSIONING_NOT_READY", "Commissioning snapshot closes only after readiness")
        require(data.get("readinessStatus") == "ready" and bool(data.get("testResultHistory")), "COMMISSIONING_CLOSE_READY", "Commissioning readiness snapshot is incomplete")
    else:
        raise ContractError("GUARD_UNIMPLEMENTED", guard)


def _handover(engine, guard, record, role):
    data = _data(record)
    project = record["projectId"]
    profile = None
    if data.get("handoverProfileRef"):
        profile = _profile(engine, data["handoverProfileRef"], record, "handoverProfile")
    if guard in {"handover_package_submission_ready", "handover_readiness_review_ready", "handover_owner_review_ready", "handover_reservation_accept_ready", "handover_accept_ready", "handover_partial_scope_ready", "handover_final_scope_ready", "handover_close_ready"}:
        require(bool(data.get("handoverNo", "").strip()), "HANDOVER_PACKAGE_INCOMPLETE", "Handover number is required")
        locations, assets = _scope_within(role, data.get("handoverScope"))
        require(role.get("packageIds") and ("*" in role["packageIds"] or record.get("packageId") in role["packageIds"]), "SCOPE_MISMATCH", "Role is outside handover package scope")
        for location_id in locations:
            require(engine._scope(role.get("locationIds", []), location_id, True), "SCOPE_MISMATCH", "Handover location exceeds active role location scope")
        asset_records = _refs(engine, assets, project, "Asset", current=True, code="HANDOVER_SCOPE_MISMATCH")
        for asset in asset_records:
            require(asset.get("locationId") in locations and _same_scope(record, asset), "HANDOVER_SCOPE_MISMATCH", "Handover asset lies outside the exact submitted package/location/discipline scope")
        if profile is None:
            profile = _profile(engine, data.get("handoverProfileRef"), record, "handoverProfile")
        _requirement_refs(engine, record)
        _approved_drawing(engine, record)
        packages = _refs(engine, data.get("commissioningPackageRefs", []), project, "WorkItem", subtypes="CommissioningPackage", current=True, code="HANDOVER_COMMISSIONING_REQUIRED", nonempty=True)
        for package in packages:
            require(package.get("status") in {"ready_for_handover", "closed"} and package.get("data", {}).get("readinessStatus") == "ready", "HANDOVER_COMMISSIONING_REQUIRED", "Only ready commissioned packages can be handed over")
            require(_same_scope(record, package), "SCOPE_MISMATCH", "Commissioning package does not match handover scope")
        required_packages = profile.get("requiredCommissioningPackageRefs", [])
        require(set(map(_ref_key, required_packages)) <= set(map(_ref_key, data["commissioningPackageRefs"])), "HANDOVER_COMMISSIONING_REQUIRED", "Profile-required CommissioningPackages are missing")
        _handover_documents(engine, record, profile)
        issue_records = _refs(engine, data.get("openIssueRefs", []), project, "Issue", current=True, code="HANDOVER_ISSUE_REFERENCE_INVALID")
        for issue in issue_records:
            require(_same_scope(record, issue) and issue.get("status") in _ISSUE_OPEN, "HANDOVER_ISSUE_REFERENCE_INVALID", "Open issue reference must be current and in the submitted package scope")
    if guard == "handover_package_submission_ready":
        return
    if guard == "handover_return_ready":
        require(bool(data.get("returnReason", "").strip()) and bool(data.get("missingItems")), "HANDOVER_RETURN_REASON_REQUIRED", "Return needs concrete missing items and reason")
    elif guard == "handover_readiness_review_ready":
        require(data.get("readinessStatus") in {"pending", "blocked", "ready"}, "HANDOVER_READINESS_INVALID", "Readiness state must be server-derived")
    elif guard == "handover_owner_review_ready":
        proposals = _reservation_inputs(engine, record, data.get("reservationProposals", []), expected_issues=data.get("openIssueRefs", []), allow_unaccepted=True)
        ready = _technical_handover_ready(data, profile) and not data.get("openIssueRefs")
        require(ready or proposals, "HANDOVER_NOT_READY", "Technical gates must pass or each remaining open Issue needs an explicit reservation proposal")
    elif guard in {"handover_reservation_accept_ready", "handover_accept_ready"}:
        decision_ref = data.get("ownerDecisionRef")
        decision = _ref(engine, decision_ref, project, "Decision", statuses={"decided", "executing", "verified", "closed"}, current=True, code="HANDOVER_OWNER_DECISION_REQUIRED")
        require(decision.get("decision") == "approved" and decision.get("targetRef") == {"objectType":"WorkItem","objectId":record["id"],"version":record["version"]}, "HANDOVER_OWNER_DECISION_REQUIRED", "Owner Decision must approve this exact HandoverPackage version")
        if guard == "handover_reservation_accept_ready":
            inputs = data.get("ownerReservationInputs", [])
            _reservation_inputs(engine, record, inputs, expected_issues=data.get("openIssueRefs", []), allow_unaccepted=False)
        else:
            require(not data.get("openIssueRefs"), "HANDOVER_RESERVATIONS_REQUIRED", "Unresolved Punch/Issue requires explicit conditional acceptance")
            require(_technical_handover_ready(data, profile), "HANDOVER_NOT_READY", "Required documents, commissioning and statutory acceptance are incomplete")
    elif guard == "handover_partial_scope_ready":
        accepted_scope = data.get("acceptedScope")
        locations, assets = _scope_within(role, accepted_scope, data.get("handoverScope"), strict=True)
        for location_id in locations:
            require(engine._scope(role.get("locationIds", []), location_id, True), "SCOPE_MISMATCH", "Partial handover location exceeds the active role scope")
        _refs(engine, assets, project, "Asset", current=True, code="HANDOVER_SCOPE_MISMATCH")
        require(instant(data["effectiveAt"]) <= instant(engine.at()), "HANDOVER_EFFECTIVE_DATE_INVALID", "Handover effective date cannot be in the future")
        _validate_warranty_trigger(profile, record, partial=True)
    elif guard == "handover_final_scope_ready":
        require(data.get("openIssueRefs") == [], "HANDOVER_RESERVATIONS_REQUIRED", "Final handover requires all open issues resolved")
        require(data.get("acceptedScope") in (None, data.get("handoverScope")), "HANDOVER_SCOPE_MISMATCH", "Final handover must retain the complete submitted scope")
        require(_technical_handover_ready(data, profile), "HANDOVER_NOT_READY", "Final handover requires complete documents and commissioning")
        require(instant(data["effectiveAt"]) <= instant(engine.at()), "HANDOVER_EFFECTIVE_DATE_INVALID", "Handover effective date cannot be in the future")
        _validate_warranty_trigger(profile, record, partial=False)
    elif guard == "handover_close_ready":
        require(data.get("handoverReady") is True and bool(data.get("ownerAcceptanceRef")), "HANDOVER_CLOSE_READY", "Close requires preserved Owner acceptance and readiness snapshot")
        require(data.get("effectiveAt") and data.get("acceptedDocumentRefs"), "HANDOVER_CLOSE_READY", "Close requires effective date and accepted document snapshot")


def _warranty(engine, guard, record, role):
    data = _data(record)
    project = record["projectId"]
    if guard in {"warranty_report_ready", "warranty_acknowledgement_ready", "warranty_applicability_ready", "warranty_remedy_required_ready", "warranty_remedy_start_ready", "warranty_remedy_submission_ready", "warranty_reinspection_passed", "warranty_reinspection_failed", "warranty_close_ready"}:
        require(bool(data.get("claimNo", "").strip()), "WARRANTY_CLAIM_INCOMPLETE", "Warranty claim number is required")
        handover = _ref(engine, data.get("handoverRef"), project, "WorkItem", subtypes="HandoverPackage", current=False, code="WARRANTY_HANDOVER_REQUIRED")
        require(handover.get("status") in {"partial_handover", "final_handover", "closed"} and handover.get("data", {}).get("warrantyTrigger") is True, "WARRANTY_HANDOVER_REQUIRED", "Defect must fall within an accepted handover scope whose contract recorded a warranty trigger")
        current_handover = engine.get("WorkItem", handover["id"])
        require(current_handover.get("subtype") == "HandoverPackage" and current_handover.get("status") in {"partial_handover", "final_handover", "closed"}, "WARRANTY_HANDOVER_REQUIRED", "Handover must remain accepted")
        period = _profile(engine, data.get("warrantyPeriodRef"), record, "warrantyPeriod")
        start_at, end_at = period.get("startsAt"), period.get("endsAt")
        require(start_at and end_at and instant(start_at) < instant(end_at), "WARRANTY_PERIOD_INVALID", "Exact contract Requirement must define the accepted warranty period dates")
        require(handover.get("data", {}).get("warrantyStartAt") == start_at, "WARRANTY_PERIOD_INVALID", "Warranty period must begin at the exact start date recorded by accepted handover")
        observed = instant(data.get("defectObservedAt", ""))
        require(instant(start_at) <= observed <= instant(end_at) and observed <= instant(engine.at()), "WARRANTY_PERIOD_INVALID", "Observed defect is outside the contract warranty period")
        accepted_scope = handover.get("data", {}).get("acceptedScope") or handover.get("data", {}).get("handoverScope")
        locations, assets = _scope_within(role, data.get("defectScope"), accepted_scope)
        for location_id in locations:
            require(engine._scope(role.get("locationIds", []), location_id, True), "SCOPE_MISMATCH", "Warranty defect location exceeds active role scope")
        asset_records = _refs(engine, assets, project, "Asset", current=True, code="WARRANTY_SCOPE_MISMATCH")
        for asset in asset_records:
            require(asset.get("locationId") in locations, "WARRANTY_SCOPE_MISMATCH", "Warranty asset lies outside exact defect location scope")
        require(data.get("defectDescription") and data.get("causeDescription") and data.get("operationalImpact"), "WARRANTY_CAUSE_IMPACT_REQUIRED", "Defect observation, cause and operational impact are required")
        issue = _ref(engine, data.get("issueRef"), project, "Issue", current=True, code="WARRANTY_ISSUE_REQUIRED")
        require(issue.get("subtype") in {"Defect", "Punch", "NCR"} and _same_scope(record, issue), "WARRANTY_ISSUE_REQUIRED", "A current defect Issue in the warranty scope is required")
        if guard == "warranty_remedy_required_ready":
            require(data.get("responseDueAt"), "WARRANTY_RESPONSE_DUE_INVALID", "Supervisor must record a response deadline from the exact contract period")
            require(instant(data["responseDueAt"]) >= observed, "WARRANTY_RESPONSE_DUE_INVALID", "Contract response deadline cannot precede the defect observation")
            hours = period.get("responseDueHours")
            require(type(hours) is int and hours > 0 and instant(data["responseDueAt"]) <= observed + timedelta(hours=hours), "WARRANTY_RESPONSE_DUE_INVALID", "Response deadline exceeds the contract-configured response period")
    if guard == "warranty_report_ready":
        require(bool(record.get("evidenceIds")), "WARRANTY_EVIDENCE_REQUIRED", "Original defect evidence is required")
        issue = engine.get("Issue", data["issueRef"]["objectId"])
        for evidence_id in record.get("evidenceIds", []):
            _evidence(engine, [evidence_id], record, role)
    elif guard == "warranty_acknowledgement_ready":
        require(record.get("status") == "reported", "WARRANTY_ACKNOWLEDGEMENT_INVALID", "Only a reported claim can be acknowledged")
    elif guard == "warranty_applicability_ready":
        _refs(engine, data.get("actionRefs", []), project, "Action", current=True, code="WARRANTY_ACTION_REFERENCE_INVALID")
    elif guard == "warranty_remedy_required_ready":
        actions = _refs(engine, data.get("actionRefs", []), project, "Action", current=True, code="WARRANTY_ACTION_REQUIRED", nonempty=True)
        issue_id = data["issueRef"]["objectId"]
        require(all(a.get("relatedIssueId") == issue_id and a.get("status") not in {"closed", "cancelled", "superseded"} for a in actions), "WARRANTY_ACTION_REQUIRED", "Remedy Actions must address this Issue and remain open")
        require(instant(data["responseDueAt"]) > instant(engine.at()), "WARRANTY_RESPONSE_DUE_INVALID", "Response deadline has passed")
    elif guard == "warranty_remedy_start_ready":
        actions = _refs(engine, data.get("actionRefs", []), project, "Action", current=True, code="WARRANTY_ACTION_REQUIRED", nonempty=True)
        require(all(a.get("responsibleOrganizationId") == record.get("responsibleOrganizationId") and a.get("status") in {"assigned", "in_progress"} for a in actions), "WARRANTY_ACTION_REQUIRED", "Contractor may start only its assigned, accepted corrective Actions")
    elif guard == "warranty_remedy_submission_ready":
        require(bool(record.get("evidenceIds")) and bool(data.get("remedySummary", "").strip()), "WARRANTY_REMEDY_EVIDENCE_REQUIRED", "Remedy submission needs a summary and preserved evidence")
    elif guard in {"warranty_reinspection_passed", "warranty_reinspection_failed"}:
        inspection = _ref(engine, data.get("reinspectionRef"), project, "Inspection", current=True, code="WARRANTY_REINSPECTION_REQUIRED")
        require(inspection.get("relatedIssueId") in (None, data["issueRef"]["objectId"]), "WARRANTY_REINSPECTION_SCOPE_MISMATCH", "Reinspection must apply to the linked defect Issue")
        if guard == "warranty_reinspection_passed":
            require(inspection.get("resultStatus") == "pass" and inspection.get("status") in {"passed", "completed"} and inspection.get("nextWorkAllowed") is True, "WARRANTY_REINSPECTION_FAILED", "Remedy cannot be accepted without a passing released reinspection")
        else:
            require(inspection.get("resultStatus") in {"fail", "conditional", "hold"} or inspection.get("status") in {"failed", "conditional", "hold"}, "WARRANTY_REINSPECTION_NOT_FAILED", "Rework requires a failed/conditional/held reinspection")
            require(bool(data.get("reworkReason", "").strip()), "WARRANTY_REWORK_REASON_REQUIRED", "Rework needs a reason")
    elif guard == "warranty_close_ready":
        require(data.get("acceptedAt") and data.get("remedyEvidenceIds") and data.get("reinspectionHistoryRefs"), "WARRANTY_CLOSE_READY", "Warranty closure requires remedy evidence and accepted reinspection")
        period = _profile(engine, data["warrantyPeriodRef"], record, "warrantyPeriod")
        close_group = period.get("closeAuthorityActorGroup")
        require(close_group in {"SUP", "OWN"} and role.get("actorGroup") == close_group, "WARRANTY_CLOSE_AUTHORITY_UNCONFIGURED", "The exact contract warranty Requirement must select SUP or OWN as close authority")
        closure = _ref(engine, data.get("closureRef"), project, ["Decision", "Issue", "InformationItem"], current=True, code="WARRANTY_CLOSURE_PROOF_REQUIRED")
        closure_ref = data["closureRef"]
        if closure_ref["objectType"] == "Decision":
            require(closure.get("targetRef") == {"objectType":"WorkItem", "objectId":record["id"], "version":record["version"]} and closure.get("decision") == "approved", "WARRANTY_CLOSURE_PROOF_REQUIRED", "Closure Decision must approve this exact WarrantyClaim version")
        elif closure_ref["objectType"] == "Issue":
            require(closure["id"] == data["issueRef"]["objectId"] and closure.get("status") in {"closed", "verified"}, "WARRANTY_CLOSURE_PROOF_REQUIRED", "Closure Issue must be the linked defect and verified closed")
        else:
            require(closure.get("status") in _ACCEPTED_REF_STATUSES and closure.get("projectId") == project, "WARRANTY_CLOSURE_PROOF_REQUIRED", "Closure information must be accepted in this project")
        require(bool(record.get("evidenceIds")), "WARRANTY_CLOSURE_PROOF_REQUIRED", "Closure evidence is required")
        if close_group == "OWN":
            decision_ref = data.get("ownerDecisionRef")
            decision = _ref(engine, decision_ref, project, "Decision", current=True, code="WARRANTY_OWNER_DECISION_REQUIRED")
            require(decision.get("decision") == "approved" and decision.get("targetRef") == {"objectType":"WorkItem","objectId":record["id"],"version":record["version"]}, "WARRANTY_OWNER_DECISION_REQUIRED", "Owner Decision must target this exact current WarrantyClaim")


def check_guard(engine, guard_name, record, payload, party_id, role, command=None):
    """Engine hook: evaluate one F-07 guard against the proposed record."""
    require(guard_name in _GUARD_NAMES, "GUARD_UNIMPLEMENTED", guard_name)
    if command is not None:
        require(set(payload) <= _COMMAND_FIELDS.get(command, set()), "COMMAND_FIELD_NOT_ALLOWED", "Command cannot change unrelated completion package fields")
    protected = _COMMISSIONING_SERVER_FIELDS | _HANDOVER_SERVER_FIELDS | _WARRANTY_SERVER_FIELDS
    require(not (protected & set(payload)), "IMMUTABLE_FIELD", "Server-derived completion fields cannot be supplied by a command")
    if guard_name.startswith("commissioning_"):
        return _commissioning(engine, guard_name, record, role)
    if guard_name.startswith("handover_"):
        return _handover(engine, guard_name, record, role)
    return _warranty(engine, guard_name, record, role)


GUARDS = {name: check_guard for name in _GUARD_NAMES}


def apply_effect(engine, machine, command, record, payload, evidence_ids, party_id, role):
    """Engine hook: append immutable result history and server-stamp decisions."""
    data = _data(record)
    now = engine.at()
    if machine == "commissioning_package":
        if command == "submit_test_result":
            entry = {
                "testResultRef": deepcopy(payload["testResultRef"]),
                "testCycle": len(data.setdefault("testResultHistory", [])) + 1,
                "outcome": payload["outcome"],
                "acceptanceCriteriaMet": payload["acceptanceCriteriaMet"],
                "submittedBy": party_id,
                "submittedAt": now,
            }
            if payload.get("failureReason"):
                entry["failureReason"] = payload["failureReason"]
            data["testResultHistory"].append(entry)
            data.setdefault("testResultRefs", []).append(deepcopy(payload["testResultRef"]))
            data["lastTestResultAt"] = now
            data["lastTestOutcome"] = payload["outcome"]
        elif command == "reject_test":
            data["lastTestOutcome"] = "fail"
        elif command == "require_punch_resolution":
            data["readinessStatus"] = "blocked"
        elif command == "request_retest":
            data["retestBasisRefs"] = deepcopy(payload["retestBasisRefs"])
        elif command == "mark_ready_for_handover":
            data["readinessStatus"] = "ready"
            data["readyAt"] = now
        elif command == "close_commissioning":
            data["closedAt"] = now
    elif machine == "handover_package":
        if command in {"start_readiness_review", "submit_owner_review"}:
            blockers = _handover_blockers(engine, record)
            data["readinessBlockers"] = blockers
            data["handoverReady"] = not blockers
            data["readinessStatus"] = "ready" if not blockers else "blocked"
        elif command in {"accept_handover", "accept_with_reservations"}:
            data["ownerAcceptanceRef"] = deepcopy(payload["ownerDecisionRef"])
            data["reservations"] = []
            if command == "accept_with_reservations":
                data["reservations"] = [
                    {**deepcopy(item), "approvedBy": party_id, "approvedAt": now}
                    for item in payload["ownerReservationInputs"]
                ]
            blockers = _handover_blockers(engine, record, reservations=data["reservations"])
            data["readinessBlockers"] = blockers
            data["handoverReady"] = not blockers
            data["readinessStatus"] = "ready" if not blockers else "blocked"
        elif command in {"record_partial_handover", "record_final_handover"}:
            data["handoverDate"] = payload["effectiveAt"]
            data["acceptedDocumentRefs"] = _all_handover_documents(data)
            if payload.get("warrantyTrigger"):
                profile = _profile(engine, data["handoverProfileRef"], record, "handoverProfile")
                require(profile.get("warrantyPeriodStartAt"), "CONTRACT_PROFILE_REQUIRED", "Contract profile must explicitly configure warranty start when its trigger applies")
                data["warrantyStartAt"] = profile["warrantyPeriodStartAt"]
        elif command == "close_handover_package":
            data["closedAt"] = now
    elif machine == "warranty_claim":
        if command == "report_warranty_defect":
            data["reportedAt"] = now
            data["recordedBy"] = party_id
        elif command == "acknowledge_claim":
            data["acknowledgedAt"] = now
        elif command == "assess_warranty":
            data["assessedAt"] = now
        elif command == "require_remedy":
            data["actionRefs"] = deepcopy(payload["actionRefs"])
            data["responseDueAt"] = payload["responseDueAt"]
        elif command == "start_remedy":
            data["remedyStartedAt"] = now
        elif command == "submit_remedy":
            data["remedyEvidenceIds"] = list(dict.fromkeys(data.get("remedyEvidenceIds", []) + list(evidence_ids or [])))
            data["remedySubmittedAt"] = now
        elif command in {"accept_remedy", "require_rework"}:
            data.setdefault("reinspectionHistoryRefs", []).append(deepcopy(payload["reinspectionRef"]))
            data["reinspectionRef"] = deepcopy(payload["reinspectionRef"])
            if command == "accept_remedy":
                data["acceptedAt"] = now
        elif command == "close_warranty_claim":
            data["closedAt"] = now
            data["closureEvidenceRefs"] = list(dict.fromkeys(data.get("closureEvidenceRefs", []) + list(evidence_ids or [])))
    return record


def _ref_key(reference):
    return (reference.get("objectType"), reference.get("objectId"), reference.get("version"))


def _date_current(record, engine, code):
    require(record.get("status") in _ACCEPTED_REF_STATUSES, code, "Referenced certificate or readiness record is not current/accepted")
    for key in ("validTo", "validUntil", "expiresAt", "effectiveTo"):
        if record.get(key):
            require(instant(engine.at()) < instant(record[key]), code, "Referenced certificate or readiness record has expired")


def _latest_test(data):
    history = data.get("testResultHistory", [])
    return history[-1] if history else None


def _evidence(engine, evidence_ids, record, role):
    for evidence_id in evidence_ids:
        evidence = engine.get("Evidence", evidence_id)
        require(evidence.get("projectId") == record["projectId"], "EVIDENCE_INVALID", evidence_id)
        engine._evidence_access(evidence_id, record, role)


def _accepted_readiness(engine, references, project_id, code, *, work_subtypes):
    records = _refs(engine, references, project_id, ["WorkItem", "InformationItem"], current=True, code=code, nonempty=True)
    for reference, record in zip(references, records):
        require(record.get("status") in _ACCEPTED_REF_STATUSES, code, "Referenced material/equipment is not accepted/current")
        if reference["objectType"] == "WorkItem":
            require(record.get("subtype") in work_subtypes, code, "Readiness WorkItem has the wrong material/equipment subtype")
        else:
            require(record.get("subtype") in {"Certificate", "GeneralDocument"}, code, "Readiness InformationItem is not an accepted certificate/document")
    return records


def _reservation_inputs(engine, record, inputs, expected_issues, *, allow_unaccepted):
    require(isinstance(inputs, list), "HANDOVER_RESERVATIONS_REQUIRED", "Reservation list is required")
    issue_ids = {x["objectId"] for x in expected_issues}
    seen = set()
    for item in inputs:
        issue = _ref(engine, item.get("issueRef"), record["projectId"], "Issue", current=True, code="HANDOVER_RESERVATION_INVALID")
        require(issue["id"] in issue_ids and issue.get("status") in _ISSUE_OPEN and _same_scope(record, issue), "HANDOVER_RESERVATION_INVALID", "Reservation must identify a current open issue in this package")
        require(issue["id"] not in seen, "HANDOVER_RESERVATION_INVALID", "Issue may appear in only one reservation")
        seen.add(issue["id"])
        owner = engine.get("Party", item.get("ownerPartyId"))
        owner_roles = [assignment for (kind, _), assignment in engine._records.items()
                       if kind == "RoleAssignment" and assignment.get("partyId") == item.get("ownerPartyId")
                       and assignment.get("projectId") == record["projectId"] and assignment.get("active")
                       and engine._scope(assignment.get("packageIds", []), record.get("packageId"))
                       and engine._scope(assignment.get("locationIds", []), record.get("locationId"), True)
                       and engine._scope(assignment.get("disciplines", []), record.get("discipline"))]
        require(owner.get("projectId") == record["projectId"] and bool(owner_roles), "HANDOVER_RESERVATION_INVALID", "Reservation owner must be an active project participant assigned to this scope")
        require(bool(item.get("closureRequirement", "").strip()), "HANDOVER_RESERVATION_INVALID", "Reservation must state its closure requirement")
        require(instant(item.get("dueAt", "")) >= instant(engine.at()), "HANDOVER_RESERVATION_INVALID", "Reservation due date cannot be in the past")
    require(seen == issue_ids, "HANDOVER_RESERVATIONS_REQUIRED", "Every open issue must have exactly one explicit reservation")
    return inputs


def _handover_documents(engine, record, profile):
    fields = {
        "asBuilt": ("asBuiltRefs", {"Drawing", "GeneralDocument"}),
        "omManual": ("omManualRefs", {"Manual", "GeneralDocument"}),
        "training": ("trainingRefs", {"MeetingRecord", "Certificate", "GeneralDocument"}),
        "spareParts": ("sparePartsRefs", {"GeneralDocument", "Certificate", "Manual"}),
        "certificates": ("certificateRefs", {"Certificate"}),
        "statutoryAcceptance": ("statutoryAcceptanceRefs", {"Certificate"}),
    }
    required = profile.get("requiredDocumentSets")
    require(isinstance(required, list) and bool(required) and set(required) <= _REQUIRED_DOCUMENT_KEYS, "CONTRACT_PROFILE_REQUIRED", "Handover profile must define its required document sets")
    for key in required:
        field, subtypes = fields[key]
        refs = record["data"].get(field, [])
        records = _refs(engine, refs, record["projectId"], ["InformationItem", "DocumentSnapshot"], current=True, code="HANDOVER_DOCUMENTS_INCOMPLETE")
        require(bool(records), "HANDOVER_DOCUMENTS_INCOMPLETE", f"Required document set {key} is empty")
        for reference, item in zip(refs, records):
            if reference["objectType"] == "InformationItem":
                require(item.get("subtype") in subtypes and item.get("status") in _ACCEPTED_REF_STATUSES, "HANDOVER_DOCUMENTS_INCOMPLETE", f"{key} reference is not the accepted document type/status")
            else:
                require(item.get("status") in _ACCEPTED_REF_STATUSES and bool(item.get("snapshot", item.get("data"))), "HANDOVER_DOCUMENTS_INCOMPLETE", f"{key} snapshot is not a current accepted record")


def _technical_handover_ready(data, profile):
    required_sets = profile.get("requiredDocumentSets", [])
    fields = {"asBuilt":"asBuiltRefs","omManual":"omManualRefs","training":"trainingRefs","spareParts":"sparePartsRefs","certificates":"certificateRefs","statutoryAcceptance":"statutoryAcceptanceRefs"}
    docs_ready = all(bool(data.get(fields[key])) for key in required_sets)
    packages_ready = bool(data.get("commissioningPackageRefs"))
    issues_clear = not data.get("openIssueRefs")
    return docs_ready and packages_ready and issues_clear


def _handover_blockers(engine, record, reservations=None):
    data = record["data"]
    blockers = []
    try:
        profile = _profile(engine, data.get("handoverProfileRef"), record, "handoverProfile")
        _handover_documents(engine, record, profile)
    except ContractError as exc:
        blockers.append(exc.code)
    for reference in data.get("commissioningPackageRefs", []):
        try:
            package = _ref(engine, reference, record["projectId"], "WorkItem", "CommissioningPackage", current=True)
            if package.get("status") not in {"ready_for_handover", "closed"}:
                blockers.append("COMMISSIONING_NOT_READY")
        except ContractError as exc:
            blockers.append(exc.code)
    issues = {x.get("objectId") for x in data.get("openIssueRefs", [])}
    reserved = {x.get("issueRef", {}).get("objectId") for x in (reservations if reservations is not None else data.get("reservations", []))}
    if issues - reserved:
        blockers.append("HANDOVER_OPEN_ISSUES")
    return list(dict.fromkeys(blockers))


def _all_handover_documents(data):
    refs = []
    for key in ("asBuiltRefs", "omManualRefs", "trainingRefs", "sparePartsRefs", "certificateRefs", "statutoryAcceptanceRefs"):
        refs.extend(deepcopy(data.get(key, [])))
    return list({ _ref_key(x): x for x in refs }.values())


def _validate_warranty_trigger(profile, record, *, partial):
    key = "warrantyTriggerOnPartialHandover" if partial else "warrantyTriggerOnFinalHandover"
    expected = profile.get(key)
    require(type(expected) is bool, "CONTRACT_PROFILE_REQUIRED", f"Exact Handover Requirement must define {key}")
    require(_data(record).get("warrantyTrigger") is expected, "WARRANTY_TRIGGER_CONFLICT", "Warranty trigger must match the exact contract profile")
    if expected:
        start = profile.get("warrantyPeriodStartAt")
        require(start, "CONTRACT_PROFILE_REQUIRED", "Exact contract profile must define the warranty start date when its trigger applies")
