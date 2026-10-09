"""Ephemeral real API fixture for the Safety equipment browser acceptance.

Direct store writes are limited to trusted prerequisites: the Equipment asset,
approved safety and calibration certificates, applicable safety Requirement
configuration and approved safety-plan source documents. Current actor
qualifications are read from the demo project, never manufactured here. Every
safety equipment inspection and safety permit workflow mutation is submitted
through the browser UI.
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


VALID_FROM = "2020-01-01T00:00:00Z"
VALID_TO = "2035-01-01T00:00:00Z"


def make_app(database: str):
    app = create_app(database, demo=True)
    store = app.state.store
    engine = store.engine
    project_id = store.meta["projectId"]
    scope = deepcopy(store.meta["scope"])

    equipment_id = uid()
    safety_certificate_id = uid()
    calibration_certificate_id = uid()
    requirement_id = uid()
    method_statement_id = uid()
    risk_assessment_id = uid()
    emergency_plan_id = uid()
    evidence_id = store.meta["evidenceId"]
    minimum_rank = 1
    with store.transaction(True):
        safety_requirement = engine.bootstrap(
            "Requirement",
            {
                "id": requirement_id,
                "projectId": project_id,
                "kind": "doul",
                "title": "Safety equipment inspection and permit control",
                "effectiveFrom": VALID_FROM,
                "status": "active",
                **scope,
            },
        )
        equipment = engine.bootstrap(
            "Asset",
            {
                "id": equipment_id,
                "projectId": project_id,
                "subtype": "Equipment",
                "name": "Browser acceptance lifting equipment",
                "serialOrLot": "AC-S-EQUIPMENT-01",
                "certificateRequired": True,
                "calibrationRequired": True,
                "minimumQualificationRank": minimum_rank,
                **scope,
            },
        )
        safety_certificate = engine.bootstrap(
            "InformationItem",
            {
                "id": safety_certificate_id,
                "projectId": project_id,
                "subtype": "Certificate",
                "title": "Browser acceptance equipment safety certificate",
                "revision": "1",
                "status": "approved",
                "certificateKind": "safety",
                "validFrom": VALID_FROM,
                "validTo": VALID_TO,
                **scope,
            },
        )
        calibration_certificate = engine.bootstrap(
            "InformationItem",
            {
                "id": calibration_certificate_id,
                "projectId": project_id,
                "subtype": "Certificate",
                "title": "Browser acceptance calibration certificate",
                "revision": "1",
                "status": "approved",
                "certificateKind": "calibration",
                "validFrom": VALID_FROM,
                "validTo": VALID_TO,
                **scope,
            },
        )
        method_statement = engine.bootstrap(
            "InformationItem",
            {
                "id": method_statement_id,
                "projectId": project_id,
                "subtype": "MethodStatement",
                "title": "Approved equipment handling method statement",
                "revision": "1",
                "status": "approved",
                **scope,
            },
        )
        risk_assessment = engine.bootstrap(
            "InformationItem",
            {
                "id": risk_assessment_id,
                "projectId": project_id,
                "subtype": "GeneralDocument",
                "title": "Approved equipment use risk assessment",
                "revision": "1",
                "status": "approved",
                **scope,
            },
        )
        emergency_plan = engine.bootstrap(
            "InformationItem",
            {
                "id": emergency_plan_id,
                "projectId": project_id,
                "subtype": "GeneralDocument",
                "title": "Approved work emergency response plan",
                "revision": "1",
                "status": "approved",
                **scope,
            },
        )

    # Use the demo supervisor's currently verified qualification rather than
    # manufacturing a qualification. The API still checks it at each official
    # inspection/judgment command.
    supervisor_role = next(
        record
        for (kind, _), record in engine._records.items()
        if kind == "RoleAssignment"
        and record.get("projectId") == project_id
        and record.get("actorGroup") == "SUP"
    )
    qualification = engine.get("Qualification", supervisor_role["qualificationIds"][0])
    if (
        not qualification.get("verified")
        or qualification.get("revoked")
        or qualification.get("rank", 4) > minimum_rank
    ):
        raise RuntimeError("Demo supervisor does not have a current rank-1 qualification")

    fixture = {
        "projectId": project_id,
        "scope": scope,
        "evidenceId": evidence_id,
        "requirementRef": {
            "objectType": "Requirement",
            "objectId": safety_requirement["id"],
            "version": safety_requirement["version"],
        },
        "assetRef": {
            "objectType": "Asset",
            "objectId": equipment["id"],
            "version": equipment["version"],
        },
        "certificateRef": {
            "objectType": "InformationItem",
            "objectId": safety_certificate["id"],
            "version": safety_certificate["version"],
        },
        "calibrationRef": {
            "objectType": "InformationItem",
            "objectId": calibration_certificate["id"],
            "version": calibration_certificate["version"],
        },
        "methodStatementRef": {
            "objectType": "InformationItem",
            "objectId": method_statement["id"],
            "version": method_statement["version"],
        },
        "riskAssessmentRef": {
            "objectType": "InformationItem",
            "objectId": risk_assessment["id"],
            "version": risk_assessment["version"],
        },
        "emergencyPlanRef": {
            "objectType": "InformationItem",
            "objectId": emergency_plan["id"],
            "version": emergency_plan["version"],
        },
        "qualificationRef": {
            "objectType": "Qualification",
            "objectId": qualification["id"],
            "version": qualification["version"],
        },
    }
    app.state.safety_equipment_browser_fixture = fixture
    token = os.environ.get("SAFETY_EQUIPMENT_TEST_FIXTURE_TOKEN", "")

    def fixture_authorized(request: Request):
        if not token or not secrets.compare_digest(
            request.headers.get("x-test-fixture-token", ""), token
        ):
            raise HTTPException(status_code=404, detail="not found")

    @app.get("/test-fixtures/safety-equipment")
    def safety_equipment_fixture(request: Request):
        fixture_authorized(request)
        return app.state.safety_equipment_browser_fixture

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--port", type=int, default=8794)
    args = parser.parse_args()
    Path(args.database).parent.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("SAFETY_EQUIPMENT_TEST_FIXTURE_TOKEN", secrets.token_urlsafe(32))
    uvicorn.run(make_app(args.database), host="127.0.0.1", port=args.port,
                log_level="warning", log_config=None, access_log=False)


if __name__ == "__main__":
    main()
