"""Backend acceptance for Product F-08 Contract Notice / Claim / EOT.

Exercises the real FastAPI + SQLite snapshot boundary. Product owns lifecycle,
authority and contract semantics; Backend proves HTTP exposure, durable state,
idempotency/version handling, exact Owner Decision targeting and the F-04
Baseline revision handoff without mutating the existing effective Baseline.
"""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


AT = "2026-10-04T12:00:00Z"
DUE = "2026-10-05T12:00:00Z"
NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)


class ContractNoticeClaimEOTHttpPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "state.db")
        self.app = create_app(self.path, demo=True)
        self.app.state.store.engine.now = lambda: NOW
        self.client = TestClient(self.app)
        self.sessions = {}
        self.headers = {}
        for group in ["CON", "SUP", "OWN", "ADM"]:
            session, headers = self.login(group)
            self.sessions[group] = session
            self.headers[group] = headers
        self.project_id = self.sessions["CON"]["projectId"]
        workspace = self.client.get(
            f"/projects/{self.project_id}/workspace",
            headers=self.headers["CON"],
        )
        self.assertEqual(workspace.status_code, 200, workspace.text)
        context = workspace.json()["context"]
        self.scope = context["scope"]
        self.evidence_id = context["evidenceId"]
        self.requirement_ref = context["requirementRef"]

    def tearDown(self):
        if self.client is not None:
            self.client.close()
        if self.app is not None:
            self.app.state.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        return session, {
            "Authorization": "Bearer " + session["accessToken"],
            "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
        }

    def reopen(self):
        self.client.close()
        self.app.state.store.close()
        self.app = create_app(self.path, demo=True)
        self.app.state.store.engine.now = lambda: NOW
        self.client = TestClient(self.app)
        self.sessions = {}
        self.headers = {}
        for group in ["CON", "SUP", "OWN", "ADM"]:
            session, headers = self.login(group)
            self.sessions[group] = session
            self.headers[group] = headers

    @staticmethod
    def ref(record, object_type=None):
        return {
            "objectType": object_type
            or ("InformationItem" if record.get("subtype") == "Schedule" else "WorkItem"),
            "objectId": record["id"],
            "version": record["version"],
        }

    def create(self, collection, actor, title, data, *, evidence_ids=None, key=None):
        response = self.client.post(
            f"/projects/{self.project_id}/{collection}",
            headers={**self.headers[actor], "Idempotency-Key": key or uid()},
            json={
                "roleAssignmentId": self.sessions[actor]["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": {
                    **self.scope,
                    "title": title,
                    "data": data,
                    **({"evidenceIds": evidence_ids} if evidence_ids is not None else {}),
                },
            },
        )
        return response

    def command(
        self,
        collection,
        record,
        command,
        actor,
        payload=None,
        evidence=None,
        key=None,
    ):
        return self.client.post(
            f"/projects/{self.project_id}/{collection}/{record['id']}/{command.replace('_','-')}",
            headers={**self.headers[actor], "Idempotency-Key": key or uid()},
            json={
                "roleAssignmentId": self.sessions[actor]["actor"]["roleAssignmentId"],
                "expectedVersion": record["version"],
                "payload": payload or {},
                "evidenceIds": evidence or [],
            },
        )

    def read(self, collection, record_id, actor="SUP"):
        return self.client.get(
            f"/projects/{self.project_id}/{collection}/{record_id}",
            headers=self.headers[actor],
        )

    def bootstrap_baseline(
        self,
        revision="B0",
        completion="2026-12-31T00:00:00Z",
        basis=None,
    ):
        oid = uid()
        file_id = uid()
        schedule = {
            "scheduleNo": f"BL-{revision}",
            "scheduleKind": "baseline",
            "revision": revision,
            "sourceFileRef": file_id,
            "sourceFormat": "xer",
            "sourceFileHash": sha256(f"baseline-{revision}".encode()).hexdigest(),
            "sourceFileVersion": revision,
            "contractualCompletionAt": completion,
            "forecastCompletionAt": completion,
        }
        if basis is not None:
            schedule["revisionBasisRef"] = basis
        with self.app.state.store.transaction(True):
            record = self.app.state.store.engine.bootstrap(
                "InformationItem",
                {
                    "id": oid,
                    "projectId": self.project_id,
                    "subtype": "Schedule",
                    "title": f"Contract Baseline {revision}",
                    "revision": revision,
                    "status": "effective",
                    "fileIds": [file_id],
                    "schedule": schedule,
                    **self.scope,
                },
            )
        return record

    def create_delay(self, baseline):
        response = self.create(
            "delay-events",
            "SUP",
            "Forecast delay",
            {
                "delayEventNo": "DE-F08-001",
                "eventType": "forecast_delay",
                "observedAt": AT,
                "knownAt": AT,
                "description": "Contract completion forecast delayed",
                "baselineScheduleRef": self.ref(baseline),
                "currentScheduleRef": self.ref(baseline),
            },
            evidence_ids=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def create_notice(self, delay, *, submit=True):
        response = self.create(
            "contract-notices",
            "CON",
            "Delay contractual notice",
            {
                "noticeNo": "NT-F08-001",
                "eventRef": self.ref(delay),
                "clauseRef": self.requirement_ref,
                "contractRuleRef": self.requirement_ref,
                "awareAt": AT,
                "eventAt": AT,
                "senderPartyId": self.sessions["CON"]["actor"]["partyId"],
                "recipientPartyId": self.sessions["SUP"]["actor"]["partyId"],
                "subject": "Reservation of time entitlement",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        notice = response.json()["record"]
        response = self.command(
            "contract-notices",
            notice,
            "calculate_notice_due",
            "SUP",
            {"noticeDueAt": DUE},
        )
        self.assertEqual(response.status_code, 200, response.text)
        notice = response.json()["record"]
        if submit:
            response = self.command(
                "contract-notices",
                notice,
                "submit_notice",
                "CON",
                evidence=[self.evidence_id],
            )
            self.assertEqual(response.status_code, 200, response.text)
            notice = response.json()["record"]
        return notice

    def bootstrap_decision(self, target, outcome="approved", title="Owner decision"):
        with self.app.state.store.transaction(True):
            decision = self.app.state.store.engine.bootstrap(
                "Decision",
                {
                    "id": uid(),
                    "projectId": self.project_id,
                    "status": "decided",
                    "title": title,
                    "targetRef": self.ref(target),
                    "options": [{"id": "A"}],
                    "impact": {"schedule": "contractual"},
                    "recommendation": "review completed",
                    "actionIds": [],
                    "decision": outcome,
                    "decisionReason": f"{outcome} by Owner",
                    "decisionAt": AT,
                    **self.scope,
                },
            )
        return decision

    def create_eot_draft(self, number="EOT-F08-001"):
        response = self.create(
            "eot-requests",
            "CON",
            "EOT draft",
            {"eotNo": number},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def advance_eot_to_decision_pending(self, eot, delay, notice, baseline):
        response = self.command(
            "eot-requests",
            eot,
            "submit_eot",
            "CON",
            {
                "delayEventRefs": [self.ref(delay)],
                "noticeRefs": [self.ref(notice)],
                "baselineScheduleRef": self.ref(baseline),
                "impactAnalysisRefs": [
                    {
                        "objectType": "Evidence",
                        "objectId": self.evidence_id,
                        "version": 1,
                    }
                ],
                "daysClaimed": 10,
                "concurrentDelayAssessment": "No concurrent delay identified",
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        eot = response.json()["record"]

        response = self.command(
            "eot-requests",
            eot,
            "receive_eot",
            "SUP",
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        eot = response.json()["record"]

        response = self.command(
            "eot-requests",
            eot,
            "start_time_impact_review",
            "SUP",
            {
                "timeImpactAssessment": "Critical-path impact verified",
                "daysAssessed": 10,
                "assessedCompletionDate": "2027-01-10T00:00:00Z",
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        eot = response.json()["record"]

        response = self.command(
            "eot-requests",
            eot,
            "start_eot_entitlement_review",
            "SUP",
            {"entitlementAssessment": "Time entitlement technically supported"},
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        eot = response.json()["record"]

        response = self.command(
            "eot-requests",
            eot,
            "request_eot_decision",
            "SUP",
            {"recommendation": "Approve 10 calendar days"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["record"]

    def test_notice_deadline_risk_is_parallel_and_persists_after_restart(self):
        baseline = self.bootstrap_baseline()
        delay = self.create_delay(baseline)
        notice = self.create_notice(delay, submit=False)

        self.assertEqual(notice["status"], "notice_due")
        response = self.command(
            "contract-notices",
            notice,
            "flag_time_bar_risk",
            "SUP",
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        notice = response.json()["record"]
        self.assertEqual(notice["status"], "notice_due")
        self.assertTrue(notice["data"]["timeBarRisk"])

        key = uid()
        body_record = notice
        first = self.command(
            "contract-notices",
            body_record,
            "submit_notice",
            "CON",
            evidence=[self.evidence_id],
            key=key,
        )
        self.assertEqual(first.status_code, 200, first.text)
        submitted = first.json()["record"]
        replay = self.command(
            "contract-notices",
            body_record,
            "submit_notice",
            "CON",
            evidence=[self.evidence_id],
            key=key,
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(submitted["status"], "submitted")
        self.assertTrue(submitted["data"]["timeBarRisk"])

        stale = self.command(
            "contract-notices",
            body_record,
            "submit_notice",
            "CON",
            evidence=[self.evidence_id],
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["code"], "VERSION_CONFLICT")

        self.reopen()
        persisted = self.read("contract-notices", submitted["id"])
        self.assertEqual(persisted.status_code, 200, persisted.text)
        self.assertEqual(persisted.json()["status"], "submitted")
        self.assertTrue(persisted.json()["data"]["timeBarRisk"])
        replay_after_restart = self.command(
            "contract-notices",
            body_record,
            "submit_notice",
            "CON",
            evidence=[self.evidence_id],
            key=key,
        )
        self.assertEqual(replay_after_restart.status_code, 200, replay_after_restart.text)
        self.assertEqual(replay_after_restart.json(), first.json())

    def test_eot_submission_requires_notice_and_preserves_failed_state(self):
        baseline = self.bootstrap_baseline()
        delay = self.create_delay(baseline)
        eot = self.create_eot_draft("EOT-NO-NOTICE")

        response = self.command(
            "eot-requests",
            eot,
            "submit_eot",
            "CON",
            {
                "delayEventRefs": [self.ref(delay)],
                "baselineScheduleRef": self.ref(baseline),
                "impactAnalysisRefs": [
                    {
                        "objectType": "Evidence",
                        "objectId": self.evidence_id,
                        "version": 1,
                    }
                ],
                "daysClaimed": 10,
                "concurrentDelayAssessment": "none",
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 422, response.text)
        current = self.read("eot-requests", eot["id"], "CON")
        self.assertEqual(current.status_code, 200, current.text)
        self.assertEqual(current.json()["status"], "draft")
        self.assertNotIn("daysClaimed", current.json()["data"])

    def test_eot_owner_decision_exact_version_and_baseline_revision_handoff(self):
        baseline = self.bootstrap_baseline()
        original_baseline = dict(baseline["schedule"])
        delay = self.create_delay(baseline)
        notice = self.create_notice(delay)
        eot = self.advance_eot_to_decision_pending(
            self.create_eot_draft(),
            delay,
            notice,
            baseline,
        )

        stale_target = dict(eot)
        stale_target["version"] -= 1
        stale = self.bootstrap_decision(stale_target, "approved", "Stale EOT decision")
        response = self.command(
            "eot-requests",
            eot,
            "approve_eot",
            "OWN",
            {
                "decisionRef": self.ref(stale, "Decision"),
                "daysApproved": 10,
                "revisedCompletionDate": "2027-01-10T00:00:00Z",
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "CONTRACT_DECISION_TARGET_INVALID")
        current = self.read("eot-requests", eot["id"], "OWN").json()
        self.assertEqual(current["status"], "decision_pending")

        decision = self.bootstrap_decision(eot, "approved", "Approve EOT")
        response = self.command(
            "eot-requests",
            eot,
            "approve_eot",
            "OWN",
            {
                "decisionRef": self.ref(decision, "Decision"),
                "daysApproved": 10,
                "revisedCompletionDate": "2027-01-10T00:00:00Z",
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        approved = response.json()["record"]
        self.assertEqual(approved["status"], "approved")

        response = self.command(
            "eot-requests",
            approved,
            "request_baseline_update",
            "SUP",
        )
        self.assertEqual(response.status_code, 200, response.text)
        pending = response.json()["record"]
        basis = pending["data"]["baselineRevisionBasisRef"]
        self.assertEqual(basis["objectId"], approved["id"])
        self.assertEqual(basis["version"], approved["version"])

        unchanged = self.app.state.store.engine.get("InformationItem", baseline["id"])
        self.assertEqual(unchanged["status"], "effective")
        self.assertEqual(unchanged["schedule"], original_baseline)

        wrong = self.bootstrap_baseline(
            "B1-WRONG",
            "2027-01-10T00:00:00Z",
            self.ref(decision, "Decision"),
        )
        response = self.command(
            "eot-requests",
            pending,
            "confirm_baseline_update",
            "SUP",
            {"baselineRevisionRef": self.ref(wrong)},
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "EOT_BASELINE_REVISION_CONFIRMED")

        revised = self.bootstrap_baseline("B1", "2027-01-10T00:00:00Z", basis)
        response = self.command(
            "eot-requests",
            pending,
            "confirm_baseline_update",
            "SUP",
            {"baselineRevisionRef": self.ref(revised)},
        )
        self.assertEqual(response.status_code, 200, response.text)
        closed = response.json()["record"]
        self.assertEqual(closed["status"], "closed")
        self.assertEqual(closed["data"]["baselineRevisionBasisRef"], basis)
        self.assertEqual(closed["data"]["baselineRevisionRef"], self.ref(revised))

        self.reopen()
        persisted = self.read("eot-requests", closed["id"])
        self.assertEqual(persisted.status_code, 200, persisted.text)
        self.assertEqual(persisted.json()["status"], "closed")
        self.assertEqual(
            persisted.json()["data"]["baselineRevisionBasisRef"],
            basis,
        )
        historical = self.app.state.store.engine.resolve(basis, self.project_id)
        self.assertEqual(historical["subtype"], "EOTRequest")
        self.assertEqual(historical["status"], "approved")
        original_after_restart = self.app.state.store.engine.get(
            "InformationItem", baseline["id"]
        )
        self.assertEqual(original_after_restart["status"], "effective")
        self.assertEqual(original_after_restart["schedule"], original_baseline)

    def test_partial_claim_preserves_claimed_amount_and_exact_owner_decision(self):
        baseline = self.bootstrap_baseline()
        delay = self.create_delay(baseline)
        notice = self.create_notice(delay)

        response = self.create(
            "claims",
            "CON",
            "Cost claim",
            {"claimNo": "CL-F08-001"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        claim = response.json()["record"]

        response = self.command(
            "claims",
            claim,
            "submit_claim",
            "CON",
            {
                "noticeRefs": [self.ref(notice)],
                "eventRefs": [self.ref(delay)],
                "clauseRefs": [self.requirement_ref],
                "claimType": "cost",
                "reliefRequested": "Additional payment",
                "entitlementBasis": "Contract delay clause",
                "chronology": "Delay event then contractual notice",
                "evidenceRefs": [
                    {
                        "objectType": "Evidence",
                        "objectId": self.evidence_id,
                        "version": 1,
                    }
                ],
                "amountClaimed": 100.0,
                "currency": "USD",
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        claim = response.json()["record"]

        for command, payload, evidence in [
            ("receive_claim", {}, [self.evidence_id]),
            (
                "start_entitlement_review",
                {"entitlementAssessment": "Partially supported"},
                [self.evidence_id],
            ),
            (
                "start_quantum_review",
                {
                    "amountAssessed": 60.0,
                    "recommendation": "Approve supported portion only",
                },
                [],
            ),
            (
                "request_claim_decision",
                {"recommendation": "Approve USD 60; preserve balance as disputed"},
                [],
            ),
        ]:
            response = self.command(
                "claims",
                claim,
                command,
                "SUP",
                payload,
                evidence=evidence,
            )
            self.assertEqual(response.status_code, 200, response.text)
            claim = response.json()["record"]

        wrong_target = dict(claim)
        wrong_target["version"] -= 1
        stale = self.bootstrap_decision(
            wrong_target,
            "approved",
            "Stale partial claim decision",
        )
        response = self.command(
            "claims",
            claim,
            "partially_approve_claim",
            "OWN",
            {
                "decisionRef": self.ref(stale, "Decision"),
                "amountApproved": 60.0,
                "disputedItems": ["Remaining USD 40"],
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "CONTRACT_DECISION_TARGET_INVALID")

        decision = self.bootstrap_decision(
            claim,
            "approved",
            "Partial claim approval",
        )
        response = self.command(
            "claims",
            claim,
            "partially_approve_claim",
            "OWN",
            {
                "decisionRef": self.ref(decision, "Decision"),
                "amountApproved": 60.0,
                "disputedItems": ["Remaining USD 40"],
            },
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        claim = response.json()["record"]
        self.assertEqual(claim["status"], "partially_approved")
        self.assertEqual(claim["data"]["amountClaimed"], 100.0)
        self.assertEqual(claim["data"]["amountAssessed"], 60.0)
        self.assertEqual(claim["data"]["amountApproved"], 60.0)
        self.assertEqual(claim["data"]["decisionOutcome"], "partially_approved")

        self.reopen()
        persisted = self.read("claims", claim["id"])
        self.assertEqual(persisted.status_code, 200, persisted.text)
        data = persisted.json()["data"]
        self.assertEqual(data["amountClaimed"], 100.0)
        self.assertEqual(data["amountApproved"], 60.0)

    def test_contract_authority_is_enforced_at_http_boundary(self):
        baseline = self.bootstrap_baseline()
        delay = self.create_delay(baseline)
        notice = self.create_notice(delay, submit=False)

        response = self.command(
            "contract-notices",
            notice,
            "submit_notice",
            "OWN",
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()["code"], "NOT_AUTHORIZED")
        current = self.read("contract-notices", notice["id"], "SUP")
        self.assertEqual(current.json()["status"], "notice_due")


if __name__ == "__main__":
    unittest.main()
