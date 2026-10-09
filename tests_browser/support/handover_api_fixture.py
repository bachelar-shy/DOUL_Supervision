"""Start a real API process seeded with the explicit F-07 HTTP acceptance fixture.

The accepted upstream demo records and three trusted Requirement profiles are
test prerequisites only. The browser creates and transitions all completion
records through the HTTP endpoints.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import uvicorn
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests_mvp.test_handover_http import HandoverHttpTests


class MockTrustedVerifier:
    """TEST ONLY: deterministic signature boundary double; not provider proof."""

    def __init__(self):
        self.calls = []

    def verify(self, request):
        self.calls.append(request)
        return {
            "verified": True,
            "partyId": request.party_id,
            "documentHash": request.document_hash,
            "method": request.method,
            "signerRole": request.signer_role,
            "mockAdapter": True,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    setup = HandoverHttpTests(methodName="runTest")
    setup.setUp()
    # The UI uses minute-precision datetime-local controls. Align the trusted
    # warranty profile boundary to the current minute so the seeded start and
    # a UI-entered observation are the same contract instant (and never future).
    warranty_start_at = setup.now[:16] + ":00Z"
    handover_profile = setup.engine.get("Requirement", setup.handover_profile_id)
    handover_profile["version"] += 1
    handover_profile["applicability"]["handoverProfile"]["warrantyPeriodStartAt"] = warranty_start_at
    warranty_period = setup.engine.get("Requirement", setup.warranty_period_id)
    warranty_period["version"] += 1
    warranty_period["applicability"]["warrantyPeriod"]["startsAt"] = warranty_start_at
    with setup.store.transaction(True):
        setup.engine._save("Requirement", handover_profile)
        setup.engine._save("Requirement", warranty_period)
    retest_evidence = setup.upload_test_evidence("browser-retest")
    # The completion lifecycle requires a Punch subtype, so seed the exact
    # accepted upstream kind from the HTTP contract fixture rather than reuse
    # its unrelated NCR issue.
    issue_ref, action_ref = setup._new_punch_and_action()
    issue = setup.engine.get("Issue", issue_ref["objectId"])
    action = setup.engine.get("Action", action_ref["objectId"])
    inspection = setup.engine.get("Inspection", setup.inspection_id)
    issue.update(version=issue["version"] + 1, title="F-07 browser commissioning punch", actionIds=[action["id"]],
                 inspectionIds=[setup.inspection_id],
                 responsiblePartyId=setup.store.meta["actors"]["CON"]["partyId"],
                 responsibleOrganizationId=setup.scope["responsibleOrganizationId"], dueAt=setup.tomorrow)
    action.update(version=action["version"] + 1, title="F-07 browser correction", evidenceIds=[setup.evidence_id],
                  responsiblePartyId=setup.store.meta["actors"]["CON"]["partyId"],
                  responsibleOrganizationId=setup.scope["responsibleOrganizationId"])
    with setup.store.transaction(True):
        setup.engine._save("Issue", issue)
        setup.engine._save("Action", action)
        setup.engine._record_machines[("Issue", issue["id"])] = "issue"
        setup.engine._record_machines[("Action", action["id"])] = "action"
        setup.engine._record_machines[("Inspection", inspection["id"])] = "inspection"
    reservation_issue_ref, reservation_action_ref = setup._new_punch_and_action()
    reservation_issue = setup.engine.get("Issue", reservation_issue_ref["objectId"])
    reservation_action = setup.engine.get("Action", reservation_action_ref["objectId"])
    reservation_issue.update(version=reservation_issue["version"] + 1, title="F-07 browser reservation Punch",
                             actionIds=[reservation_action["id"]],
                             inspectionIds=[setup.inspection_id],
                             responsiblePartyId=setup.store.meta["actors"]["CON"]["partyId"],
                             responsibleOrganizationId=setup.scope["responsibleOrganizationId"], dueAt=setup.tomorrow)
    reservation_action.update(version=reservation_action["version"] + 1, title="F-07 browser reservation action",
                               responsiblePartyId=setup.store.meta["actors"]["CON"]["partyId"],
                               responsibleOrganizationId=setup.scope["responsibleOrganizationId"])
    with setup.store.transaction(True):
        setup.engine._save("Issue", reservation_issue)
        setup.engine._save("Action", reservation_action)
        setup.engine._record_machines[("Issue", reservation_issue["id"])] = "issue"
        setup.engine._record_machines[("Action", reservation_action["id"])] = "action"
    issue_ref = setup.ref("Issue", issue["id"])
    action_ref = setup.ref("Action", action["id"])
    # Use the explicit accepted, project-scoped prerequisite seeded by the
    # contractual fixture and register its machine for the connected case UI.
    setup.client.close()
    app = setup.app
    verifier = MockTrustedVerifier()
    app.state.signature_verifier = verifier

    async def verifier_calls():
        return JSONResponse({
            "testOnly": True,
            "verifier": "MockTrustedVerifier",
            "calls": [{
                "partyId": call.party_id,
                "documentHash": call.document_hash,
                "method": call.method,
                "signerRole": call.signer_role,
            } for call in verifier.calls],
        })

    app.add_api_route("/_test/signature-verifications", verifier_calls, methods=["GET"])
    store = setup.store
    meta = {
        "projectId": setup.project,
        "scope": setup.scope,
        "requirementRef": setup.ref("Requirement", setup.requirement_id),
        "drawingRef": setup.ref("InformationItem", setup.drawing_id),
        "evidenceId": setup.evidence_id,
        "retestEvidenceId": retest_evidence["id"],
        "commissioningProfileRef": setup.ref("Requirement", setup.commissioning_profile_id),
        "handoverProfileRef": setup.ref("Requirement", setup.handover_profile_id),
        "warrantyPeriodRef": setup.ref("Requirement", setup.warranty_period_id),
        "inspectionRef": setup.ref("Inspection", inspection["id"]),
        "procedureRef": setup.ref("InformationItem", setup.procedure_id),
        "issueRef": setup.ref("Issue", issue["id"]),
        "actionRef": setup.ref("Action", action["id"]),
        "reservationIssueRef": setup.ref("Issue", reservation_issue["id"]),
        "reservationActionRef": setup.ref("Action", reservation_action["id"]),
        "documents": {name: setup.ref("InformationItem", object_id) for name, object_id in setup.document_ids.items()},
        "assets": [setup.ref("Asset", object_id) for object_id in setup.asset_ids],
        "now": setup.now,
        "tomorrow": setup.tomorrow,
        "warrantyStartAt": warranty_start_at,
        "actors": {group: actor["partyId"] for group, actor in store.meta["actors"].items()},
        "responsibleOrganizationId": setup.scope["responsibleOrganizationId"],
        "disclosure": "HandoverHttpTests seeds explicit F-07 Requirement profiles, approved InformationItems, and accepted upstream Requirement, drawing, Evidence, project-scoped Inspection, and Asset records. The fixture creates two scoped open Punch Issues and verified Actions using the test contract helper: one for commissioning fail/retest and one reserved for partial handover/warranty. Both exact current Issue refs are linked to the passed source Inspection; this relationship is an explicit upstream fixture prerequisite so the authorized case UI can present the reserved warranty Punch for its later reinspection workflow. The fixture links exact current refs and source Evidence, selects the server-catalogued passed Inspection, and uploads a distinct retest Evidence through the HTTP upload endpoints. These are disclosed upstream prerequisites only. Browser-created commissioning and handover records, the Owner decision sequence, and the warranty claim use real UI and HTTP routes. The scenario stops at the server's current-reference boundary after actual correction, remedy, and reinspection transitions; it does not claim warranty acceptance or close.",
    }
    print(json.dumps(meta), flush=True)
    try:
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    finally:
        store.close()
        setup.temp.cleanup()


if __name__ == "__main__":
    main()
