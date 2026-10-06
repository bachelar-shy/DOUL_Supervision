"""Operational Safety workflow gate executed through the deployed HTTPS API.

Fixture setup is trusted synthetic CI preparation. Every Safety command below crosses
JWT authentication, the TLS proxy, the running API, and PostgreSQL persistence.
"""

from __future__ import annotations

import json
from uuid import uuid4

from services.deployment.auth import subject_key


READINESS = {
    "methodStatementCurrent": True,
    "riskAssessmentCurrent": True,
    "personnelQualified": True,
    "equipmentReady": True,
    "controlMeasuresReady": True,
    "emergencyReady": True,
    "environmentalConditionsReady": True,
    "noBlockingSafetyIssue": True,
}
AT = "2026-10-06T10:00:00Z"


def ref(record):
    return {
        "objectType": "WorkItem" if record.get("subtype") else (
            "Inspection" if "resultStatus" in record else "Action"
        ),
        "objectId": record["id"],
        "version": record["version"],
    }


def seed_safety_fixture(store, issuer):
    """Prepare only prerequisites that precede the operational Stop/Resume flow."""
    with store.transaction(True):
        project = store.meta["projectId"]
        scope = dict(store.meta["scope"])
        evidence_id = store.meta["evidenceId"]
        sup = store.meta["actors"]["SUP"]
        con = store.meta["actors"]["CON"]

        store.meta["provisioning"] = {
            "environment": "staging",
            "snapshotFormat": 1,
            "approvedBy": "SYNTHETIC-CI",
            "approvalRef": "disposable-test-only",
            "syntheticData": True,
        }
        store.meta["identityBindings"] = {
            subject_key(issuer, "synthetic-supervisor"): {
                "active": True,
                "partyId": sup["partyId"],
                "defaultRoleAssignmentId": sup["roleAssignmentId"],
                "validAfter": 0,
            },
            subject_key(issuer, "synthetic-contractor"): {
                "active": True,
                "partyId": con["partyId"],
                "defaultRoleAssignmentId": con["roleAssignmentId"],
                "validAfter": 0,
            },
        }

        def active_permit(label):
            return store.engine.bootstrap(
                "WorkItem",
                {
                    "id": str(uuid4()),
                    "projectId": project,
                    "createdBy": con["partyId"],
                    **scope,
                    "subtype": "SafetyPermit",
                    "status": "active",
                    "title": f"Operational Safety Permit {label}",
                    "data": {
                        "permitNo": f"SAFE-E2E-{label}",
                        "workType": "hot-work",
                        "riskLevel": "high",
                        "responsiblePartyId": con["partyId"],
                        "safetyResponsiblePartyId": sup["partyId"],
                        "validFrom": "2026-01-01T00:00:00Z",
                        "validTo": "2027-01-01T00:00:00Z",
                        "readiness": dict(READINESS),
                        "workAuthorized": True,
                        "blockedReasons": [],
                        "equipmentRefs": [],
                    },
                },
            )

        permit = active_permit("A")
        stale_target = active_permit("B")
        stale_target_ref = ref(stale_target)
        current = store.engine.get("WorkItem", stale_target["id"])
        current["version"] += 1
        current["updatedAt"] = store.engine.at()
        store.engine._save("WorkItem", current)

        action = next(
            record
            for (kind, _), record in store.engine._records.items()
            if kind == "Action"
        )
        action = store.engine.get("Action", action["id"])
        action["status"] = "closed"
        action["rootCause"] = "synthetic fall-protection gap corrected"
        action["updatedAt"] = store.engine.at()
        store.engine._save("Action", action)
        action = store.engine.get("Action", action["id"])

        inspection = next(
            record
            for (kind, _), record in store.engine._records.items()
            if kind == "Inspection"
            and record.get("status") in {"passed", "completed"}
            and record.get("resultStatus") == "pass"
        )
        inspection = store.engine.get("Inspection", inspection["id"])

        return {
            "projectId": project,
            "scope": scope,
            "evidenceId": evidence_id,
            "supRoleAssignmentId": sup["roleAssignmentId"],
            "conRoleAssignmentId": con["roleAssignmentId"],
            "permit": permit,
            "stalePermitRef": stale_target_ref,
            "actionRef": {
                "objectType": "Action",
                "objectId": action["id"],
                "version": action["version"],
            },
            "inspectionRef": {
                "objectType": "Inspection",
                "objectId": inspection["id"],
                "version": inspection["version"],
            },
        }


def _decode(status, body):
    try:
        payload = json.loads(body or b"{}")
    except json.JSONDecodeError as exc:
        raise AssertionError(f"Non-JSON API response for status {status}") from exc
    return status, payload


def run_safety_operational_e2e(request, restart_api, fixture, sup_token, con_token):
    """Run the Safety critical path through an already-running operational API."""

    def call(path, token, method="GET", payload=None, idem=None):
        headers = {}
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload, separators=(",", ":")).encode()
        if idem:
            headers["Idempotency-Key"] = idem
        return _decode(*request(path, token=token, method=method, data=data, headers=headers))

    project = fixture["projectId"]
    permit = fixture["permit"]
    evidence_id = fixture["evidenceId"]
    stop_endpoint = f"/api/projects/{project}/safety-stop-orders"
    permit_endpoint = f"/api/projects/{project}/safety-permits/{permit['id']}"

    def stop_body(stop_id, refs, number):
        return {
            "roleAssignmentId": fixture["supRoleAssignmentId"],
            "clientObjectId": stop_id,
            "payload": {
                **fixture["scope"],
                "title": f"Operational Safety Stop {number}",
                "evidenceIds": [evidence_id],
                "data": {
                    "stopOrderNo": number,
                    "stopScopeType": "permit",
                    "stopReason": "synthetic immediate hazard",
                    "observedAt": AT,
                    "effectiveAt": AT,
                    "affectedPermitRefs": refs,
                },
            },
        }

    # Atomicity gate: one stale affected Permit must roll back the entire Stop package.
    rejected_stop_id = str(uuid4())
    status, error = call(
        stop_endpoint,
        sup_token,
        "POST",
        stop_body(
            rejected_stop_id,
            [ref(permit), fixture["stalePermitRef"]],
            "SAFE-E2E-ROLLBACK",
        ),
        str(uuid4()),
    )
    assert status == 409 and error.get("code") == "REFERENCE_STALE", (
        "Stale affected Permit did not reject the entire Stop package"
    )
    status, unchanged = call(permit_endpoint, sup_token)
    assert status == 200, ("permit-after-rollback", status, unchanged)
    assert unchanged["status"] == "active"
    assert unchanged["version"] == permit["version"]
    assert unchanged["data"]["workAuthorized"] is True
    assert call(
        f"/api/projects/{project}/safety-stop-orders/{rejected_stop_id}",
        sup_token,
    )[0] == 404, "Rolled-back Stop Order became visible"

    # Successful Stop package plus idempotent replay.
    stop_id = str(uuid4())
    stop_key = str(uuid4())
    body = stop_body(stop_id, [ref(permit)], "SAFE-E2E-001")
    status, created = call(stop_endpoint, sup_token, "POST", body, stop_key)
    assert status == 201, created
    stop = created["record"]
    assert stop["status"] == "issued"
    status, suspended = call(permit_endpoint, sup_token)
    assert status == 200
    assert suspended["status"] == "suspended"
    assert suspended["version"] == permit["version"] + 1
    assert suspended["data"]["workAuthorized"] is False

    status, replay = call(stop_endpoint, sup_token, "POST", body, stop_key)
    assert status == 201 and replay == created, "Stop idempotent replay changed response"
    status, replayed_permit = call(permit_endpoint, sup_token)
    assert status == 200 and replayed_permit["version"] == suspended["version"]

    # Container restart must preserve both the Stop and the suspended Permit.
    restart_api()
    status, persisted_stop = call(
        f"/api/projects/{project}/safety-stop-orders/{stop_id}", sup_token
    )
    assert status == 200 and persisted_stop["status"] == "issued"
    status, persisted_permit = call(permit_endpoint, sup_token)
    assert status == 200
    assert persisted_permit["status"] == "suspended"
    assert persisted_permit["data"]["workAuthorized"] is False
    assert call(
        f"/api/projects/{project}/safety-stop-orders/{rejected_stop_id}",
        sup_token,
    )[0] == 404

    status, replay_after_restart = call(
        stop_endpoint, sup_token, "POST", body, stop_key
    )
    assert status == 201 and replay_after_restart == created

    # Stale expectedVersion must be rejected at the deployed HTTP boundary.
    ack_body = {
        "roleAssignmentId": fixture["conRoleAssignmentId"],
        "expectedVersion": persisted_stop["version"],
        "payload": {},
        "evidenceIds": [],
    }
    ack_path = (
        f"/api/projects/{project}/safety-stop-orders/{stop_id}/acknowledge-stop"
    )
    status, acknowledged = call(
        ack_path, con_token, "POST", ack_body, str(uuid4())
    )
    assert status == 200 and acknowledged["record"]["status"] == "acknowledged"
    stop = acknowledged["record"]
    status, stale = call(ack_path, con_token, "POST", ack_body, str(uuid4()))
    assert status == 409 and stale.get("code") == "VERSION_CONFLICT"

    # Contractor correction -> resume request -> supervisor verification -> Stop Lift.
    status, response = call(
        f"/api/projects/{project}/safety-stop-orders/{stop_id}/start-correction",
        con_token,
        "POST",
        {
            "roleAssignmentId": fixture["conRoleAssignmentId"],
            "expectedVersion": stop["version"],
            "payload": {"correctiveActionRefs": [fixture["actionRef"]]},
            "evidenceIds": [],
        },
        str(uuid4()),
    )
    assert status == 200, response
    stop = response["record"]

    status, response = call(
        f"/api/projects/{project}/safety-stop-orders/{stop_id}/request-resume",
        con_token,
        "POST",
        {
            "roleAssignmentId": fixture["conRoleAssignmentId"],
            "expectedVersion": stop["version"],
            "payload": {},
            "evidenceIds": [evidence_id],
        },
        str(uuid4()),
    )
    assert status == 200, response
    stop = response["record"]

    status, response = call(
        f"/api/projects/{project}/safety-stop-orders/{stop_id}/start-resume-verification",
        sup_token,
        "POST",
        {
            "roleAssignmentId": fixture["supRoleAssignmentId"],
            "expectedVersion": stop["version"],
            "payload": {"resumeVerificationRefs": [fixture["inspectionRef"]]},
            "evidenceIds": [],
        },
        str(uuid4()),
    )
    assert status == 200, response
    stop = response["record"]

    status, response = call(
        f"/api/projects/{project}/safety-stop-orders/{stop_id}/lift-stop",
        sup_token,
        "POST",
        {
            "roleAssignmentId": fixture["supRoleAssignmentId"],
            "expectedVersion": stop["version"],
            "payload": {},
            "evidenceIds": [evidence_id],
        },
        str(uuid4()),
    )
    assert status == 200, response
    stop = response["record"]
    assert stop["status"] == "lifted"
    assert all(stop["data"]["resumeGate"].values())

    # Stop Lift must not revive the Permit.
    status, permit_after_lift = call(permit_endpoint, sup_token)
    assert status == 200
    assert permit_after_lift["status"] == "suspended"
    assert permit_after_lift["data"]["workAuthorized"] is False

    status, response = call(
        f"{permit_endpoint}/request-resume",
        con_token,
        "POST",
        {
            "roleAssignmentId": fixture["conRoleAssignmentId"],
            "expectedVersion": permit_after_lift["version"],
            "payload": {"readiness": dict(READINESS), "blockedReasons": []},
            "evidenceIds": [evidence_id],
        },
        str(uuid4()),
    )
    assert status == 200, response
    permit_review = response["record"]
    assert permit_review["status"] == "resume_review"
    assert permit_review["data"]["workAuthorized"] is False

    approve_path = f"{permit_endpoint}/approve-resume"
    approve_body = {
        "roleAssignmentId": fixture["conRoleAssignmentId"],
        "expectedVersion": permit_review["version"],
        "payload": {"readiness": dict(READINESS)},
        "evidenceIds": [evidence_id],
    }
    status, forbidden = call(
        approve_path, con_token, "POST", approve_body, str(uuid4())
    )
    assert status == 403 and forbidden.get("code") == "NOT_AUTHORIZED", (
        "Contractor self-resume was not rejected"
    )

    approve_body["roleAssignmentId"] = fixture["supRoleAssignmentId"]
    status, response = call(
        approve_path, sup_token, "POST", approve_body, str(uuid4())
    )
    assert status == 200, response
    resumed = response["record"]
    assert resumed["status"] == "active"
    assert resumed["data"]["workAuthorized"] is True

    # Final restart proves the completed operational state is PostgreSQL-durable.
    restart_api()
    status, final_stop = call(
        f"/api/projects/{project}/safety-stop-orders/{stop_id}", sup_token
    )
    assert status == 200 and final_stop["status"] == "lifted"
    status, final_permit = call(permit_endpoint, sup_token)
    assert status == 200
    assert final_permit["status"] == "active"
    assert final_permit["data"]["workAuthorized"] is True

    return {
        "result": "safety-operational-e2e-ok",
        "staleStopRollback": True,
        "idempotentStopReplay": True,
        "restartPersistence": True,
        "staleVersionRejected": True,
        "stopLiftSeparatedFromPermitResume": True,
        "contractorSelfResumeRejected": True,
        "supervisorResumeAuthorized": True,
    }
