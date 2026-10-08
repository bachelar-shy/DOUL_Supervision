"""Real in-process DOUL HTTP API for the connected payment browser acceptance.

The only direct engine writes are named, trusted upstream test fixtures:
an active calculation-rule Requirement, an accepted/released Inspection, and
exact-version Owner Decision records created on demand. Every BOQ,
measurement, claim, review, recommendation and payment record/command is sent
through the same HTTP API used by the browser.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import os
from pathlib import Path
import secrets

import uvicorn
from fastapi import HTTPException, Request

from app.reference.engine import uid
from services.api.main import create_app


BEFORE = "2026-01-01T00:00:00Z"


def make_app(database: str):
    app = create_app(database, demo=True)
    store = app.state.store
    engine = store.engine
    project_id = store.meta["projectId"]
    scope = deepcopy(store.meta["scope"])
    requirement_id = store.meta["requirementRef"]["objectId"]
    evidence_id = store.meta["evidenceId"]

    # Explicit trusted configuration prerequisite used by the payment engine.
    payment_rule_id = uid()
    with store.transaction(True):
        engine.bootstrap(
            "Requirement",
            {
                "id": payment_rule_id,
                "projectId": project_id,
                "kind": "contract",
                "title": "Browser fixture payment calculation rule",
                "effectiveFrom": BEFORE,
                "status": "active",
                "applicability": {
                    "paymentCalculationRule": {
                        "formulaId": "verified-eligible-net-v1",
                        "baseComponents": [
                            "verifiedGrossAmount",
                            "eligibleVariationAmount",
                            "eligibleMaterialOnSiteAmount",
                        ],
                        "addComponents": ["taxAmount"],
                        "subtractComponents": [
                            "retentionAmount",
                            "advanceRecoveryAmount",
                            "otherDeductionAmount",
                        ],
                        "deductionTypeMap": {
                            "retention": "retentionAmount",
                            "advance_recovery": "advanceRecoveryAmount",
                            "other": "otherDeductionAmount",
                        },
                        "rounding": {
                            "id": "vnd-whole-half-up-v1",
                            "quantum": "1",
                            "mode": "half_up",
                        },
                    }
                },
                **scope,
            },
        )

    # The demo has a passed hold-point Inspection awaiting release. Seed a
    # distinct accepted/released upstream Inspection so this test starts after
    # the inspection-release boundary, which has its own acceptance coverage.
    inspection = next(
        record
        for (kind, _), record in engine._records.items()
        if kind == "Inspection"
        and record["projectId"] == project_id
        and record.get("resultStatus") == "pass"
    )
    accepted_inspection = deepcopy(inspection)
    accepted_inspection.update(
        id=uid(), version=1, status="passed", nextWorkAllowed=True, holdPoint=False
    )
    with store.transaction(True):
        engine.bootstrap("Inspection", accepted_inspection)

    drawing = next(
        record
        for (kind, _), record in engine._records.items()
        if kind == "InformationItem"
        and record["projectId"] == project_id
        and record.get("subtype") == "Drawing"
    )
    app.state.payment_browser_fixture = {
        "projectId": project_id,
        "scope": scope,
        "requirementRef": {"objectType": "Requirement", "objectId": requirement_id,
                           "version": engine.get("Requirement", requirement_id)["version"]},
        "paymentRuleRef": {"objectType": "Requirement", "objectId": payment_rule_id,
                           "version": engine.get("Requirement", payment_rule_id)["version"]},
        "evidenceId": evidence_id,
        "evidenceRef": {"objectType": "Evidence", "objectId": evidence_id,
                        "version": engine.get("Evidence", evidence_id)["version"]},
        "acceptedInspectionRef": {"objectType": "Inspection", "objectId": accepted_inspection["id"],
                                   "version": accepted_inspection["version"]},
        "drawingRef": {"objectType": "InformationItem", "objectId": drawing["id"],
                       "version": drawing["version"]},
    }

    token = os.environ.get("PAYMENT_TEST_FIXTURE_TOKEN", "")

    def fixture_authorized(request: Request):
        if not token or not secrets.compare_digest(
            request.headers.get("x-test-fixture-token", ""), token
        ):
            raise HTTPException(status_code=404, detail="not found")

    @app.get("/test-fixtures/payment-metadata")
    def payment_metadata(request: Request):
        fixture_authorized(request)
        return app.state.payment_browser_fixture

    @app.post("/test-fixtures/payment-owner-decision")
    def payment_owner_decision(body: dict, request: Request):
        fixture_authorized(request)
        machine = body.get("machine")
        object_id = body.get("objectId")
        target_map = {
            "contract_boq": ("InformationItem", "ContractBOQ"),
            "payment_claim": ("WorkItem", "PaymentClaim"),
        }
        if machine not in target_map or not isinstance(object_id, str):
            raise HTTPException(status_code=400, detail="unsupported decision target")
        object_type, subtype = target_map[machine]
        target = engine.get(object_type, object_id)
        if target.get("projectId") != project_id or target.get("subtype") != subtype:
            raise HTTPException(status_code=404, detail="target not found")
        decision_id = uid()
        with store.transaction(True):
            engine.bootstrap(
                "Decision",
                {
                    "id": decision_id,
                    "projectId": project_id,
                    "status": "decided",
                    "title": body.get("title") or "Browser fixture exact-version Owner decision",
                    "targetRef": {"objectType": object_type, "objectId": object_id,
                                  "version": target["version"]},
                    "options": [{"id": "A"}],
                    "impact": {"cost": "contractual"},
                    "recommendation": "approved",
                    "actionIds": [],
                    "decision": "approved",
                    "decisionReason": body.get("reason") or "Fixture for exact-version UI acceptance",
                    "decisionAt": "2026-10-04T12:00:00Z",
                    **scope,
                },
            )
        return {"ref": {"objectType": "Decision", "objectId": decision_id,
                        "version": engine.get("Decision", decision_id)["version"]},
                "targetVersion": target["version"]}

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--port", type=int, default=8793)
    args = parser.parse_args()
    Path(args.database).parent.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("PAYMENT_TEST_FIXTURE_TOKEN", secrets.token_urlsafe(32))
    uvicorn.run(make_app(args.database), host="127.0.0.1", port=args.port,
                log_level="warning", log_config=None, access_log=False)


if __name__ == "__main__":
    main()
