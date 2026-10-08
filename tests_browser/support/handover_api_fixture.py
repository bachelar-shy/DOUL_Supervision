"""Start a real API process seeded with the explicit F-07 HTTP acceptance fixture.

The accepted upstream demo records and three trusted Requirement profiles are
test prerequisites only. The browser creates and transitions all completion
records through the HTTP endpoints.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tests_mvp.test_handover_http import HandoverHttpTests


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    setup = HandoverHttpTests(methodName="runTest")
    setup.setUp()
    retest_evidence = setup.upload_test_evidence("browser-retest")
    upstream_workspace = setup.client.get(f"/projects/{setup.project}/workspace", headers=setup.headers).json()
    upstream_action = next(item["record"] for item in upstream_workspace["items"] if item["machine"] == "action")
    issue = setup.engine.get("Issue", upstream_action["relatedIssueId"])
    action = deepcopy(setup.engine.get("Action", upstream_action["id"]))
    action.update(version=action["version"] + 1, status="verified", updatedAt=setup.engine.at())
    with setup.store.transaction(True):
        setup.engine._save("Action", action)
    upstream_inspection = next(item["record"] for item in upstream_workspace["items"]
                               if item["machine"] == "inspection" and item["record"].get("status") == "passed")
    inspection = setup.engine.get("Inspection", upstream_inspection["id"])
    setup.client.close()
    app = setup.app
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
        "documents": {name: setup.ref("InformationItem", object_id) for name, object_id in setup.document_ids.items()},
        "assets": [setup.ref("Asset", object_id) for object_id in setup.asset_ids],
        "now": setup.now,
        "tomorrow": setup.tomorrow,
        "actors": {group: actor["partyId"] for group, actor in store.meta["actors"].items()},
        "disclosure": "HandoverHttpTests seeds the explicit F-07 Requirement profiles, approved InformationItems, and accepted demo upstream Requirement, drawing, Evidence, Inspection, Asset, Issue, and Action records. The fixture promotes the linked upstream Action to verified in a store transaction and uploads a distinct retest Evidence through the HTTP upload endpoints. Browser-created F-07 records and all F-07 transitions use the real UI and HTTP routes.",
    }
    print(json.dumps(meta), flush=True)
    try:
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
    finally:
        store.close()
        setup.temp.cleanup()


if __name__ == "__main__":
    main()
