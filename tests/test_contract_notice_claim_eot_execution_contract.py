from datetime import datetime, timezone
import hashlib
import json
import unittest
from pathlib import Path

from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import AT, Fixture

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class ContractNoticeClaimEOTExecutionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.machines = load("app/schema/state_machines_v1.json")["machines"]
        cls.policies = load("app/schema/authority_matrix_v1.json")["policies"]
        cls.schemas = load("app/schema/domain_schemas_v2.json")["components"]["schemas"]
        cls.execution = load(
            "app/schema/contract_notice_claim_eot_execution_contract_v1.json"
        )
        cls.registers = {
            row["register_id"]: row
            for row in load("app/schema/register_projection_map_v2.json")["registers"]
        }

    def setUp(self):
        self.f = Fixture()
        self.baseline = self.bootstrap_baseline()

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
            "sourceFileHash": hashlib.sha256(
                f"baseline-{revision}".encode()
            ).hexdigest(),
            "sourceFileVersion": revision,
            "contractualCompletionAt": completion,
            "forecastCompletionAt": completion,
        }
        if basis:
            schedule["revisionBasisRef"] = basis
        self.f.engine.bootstrap(
            "InformationItem",
            {
                "id": oid,
                "projectId": self.f.project,
                "subtype": "Schedule",
                "title": f"Contract Baseline {revision}",
                "revision": revision,
                "status": "effective",
                "fileIds": [file_id],
                "schedule": schedule,
                **self.f.scope(),
            },
        )
        return self.f.engine.get("InformationItem", oid)

    def create_delay(self):
        ref = self.f.ref("InformationItem", self.baseline["id"])
        return self.f.create(
            "delay_event",
            {
                "title": "Forecast delay",
                "data": {
                    "delayEventNo": "DE-001",
                    "eventType": "forecast_delay",
                    "observedAt": AT,
                    "knownAt": AT,
                    "description": "Contract completion forecast delayed",
                    "baselineScheduleRef": ref,
                    "currentScheduleRef": ref,
                },
                "evidenceIds": [self.f.evidence],
            },
            actor="SUP",
        )

    def create_notice(self, delay, *, submit=True):
        notice = self.f.create(
            "contract_notice",
            {
                "title": "Delay contractual notice",
                "data": {
                    "noticeNo": "NT-001",
                    "eventRef": self.f.ref("WorkItem", delay["id"]),
                    "clauseRef": self.f.ref("Requirement", self.f.requirement),
                    "contractRuleRef": self.f.ref("Requirement", self.f.requirement),
                    "awareAt": AT,
                    "eventAt": AT,
                    "senderPartyId": self.f.actors["CON"][0],
                    "recipientPartyId": self.f.actors["SUP"][0],
                    "subject": "Reservation of time entitlement",
                },
            },
            actor="CON",
        )
        notice = self.f.command(
            "contract_notice",
            notice,
            "calculate_notice_due",
            {"noticeDueAt": "2026-10-05T12:00:00Z"},
            actor="SUP",
            evidence=[],
        )
        if submit:
            notice = self.f.command(
                "contract_notice",
                notice,
                "submit_notice",
                actor="CON",
                evidence=[self.f.evidence],
            )
        return notice

    def create_decision(self, target, outcome="approved", title="Owner decision"):
        decision_id = uid()
        self.f.engine.bootstrap(
            "Decision",
            {
                "id": decision_id,
                "projectId": self.f.project,
                "status": "decided",
                "title": title,
                "targetRef": self.f.ref("WorkItem", target["id"]),
                "options": [{"id": "A"}],
                "impact": {"schedule": "contractual"},
                "recommendation": "review completed",
                "actionIds": [],
                "decision": outcome,
                "decisionReason": f"{outcome} by Owner",
                "decisionAt": AT,
                **self.f.scope(),
            },
        )
        return self.f.engine.get("Decision", decision_id)

    def advance_eot_to_decision_pending(self, eot, delay, notice):
        eot = self.f.command(
            "eot_request",
            eot,
            "submit_eot",
            {
                "delayEventRefs": [self.f.ref("WorkItem", delay["id"])],
                "noticeRefs": [self.f.ref("WorkItem", notice["id"])],
                "baselineScheduleRef": self.f.ref(
                    "InformationItem", self.baseline["id"]
                ),
                "impactAnalysisRefs": [
                    self.f.ref("Evidence", self.f.evidence)
                ],
                "daysClaimed": 10,
                "concurrentDelayAssessment": "No concurrent delay identified",
            },
            actor="CON",
            evidence=[self.f.evidence],
        )
        eot = self.f.command(
            "eot_request",
            eot,
            "receive_eot",
            actor="SUP",
            evidence=[self.f.evidence],
        )
        eot = self.f.command(
            "eot_request",
            eot,
            "start_time_impact_review",
            {
                "timeImpactAssessment": "Critical-path impact verified",
                "daysAssessed": 10,
                "assessedCompletionDate": "2027-01-10T00:00:00Z",
            },
            actor="SUP",
            evidence=[self.f.evidence],
        )
        eot = self.f.command(
            "eot_request",
            eot,
            "start_eot_entitlement_review",
            {"entitlementAssessment": "Time entitlement technically supported"},
            actor="SUP",
            evidence=[self.f.evidence],
        )
        return self.f.command(
            "eot_request",
            eot,
            "request_eot_decision",
            {"recommendation": "Approve 10 calendar days"},
            actor="SUP",
            evidence=[],
        )

    def test_f08_has_three_typed_machines_and_human_only_contract_authorities(self):
        expected = {
            "contract_notice": ("ContractNotice", "identified"),
            "claim": ("Claim", "draft"),
            "eot_request": ("EOTRequest", "draft"),
        }
        for machine, (subtype, initial) in expected.items():
            self.assertEqual(self.machines[machine]["object_type"], "WorkItem")
            self.assertEqual(self.machines[machine]["subtype"], subtype)
            self.assertEqual(self.machines[machine]["initial"], initial)

        typed = {
            item["if"]["properties"]["subtype"]["const"]:
            item["then"]["properties"]["data"]["$ref"]
            for item in self.schemas["WorkItem"]["allOf"]
            if item.get("if", {}).get("properties", {}).get("subtype", {}).get("const")
        }
        self.assertEqual(
            typed["ContractNotice"], "#/components/schemas/ContractNoticeData"
        )
        self.assertEqual(typed["Claim"], "#/components/schemas/ClaimData")
        self.assertEqual(
            typed["EOTRequest"], "#/components/schemas/EOTRequestData"
        )

        for authority, policy in self.policies.items():
            if authority.startswith("contract."):
                self.assertTrue(policy["official"])
                self.assertNotIn("SYSTEM", policy["actor_groups"])
                self.assertNotIn("AI", policy["actor_groups"])

    def test_time_bar_is_parallel_risk_flag_not_forfeiture_state(self):
        delay = self.create_delay()
        notice = self.create_notice(delay, submit=False)
        self.assertEqual(notice["status"], "notice_due")
        self.assertNotIn(
            "time_bar_risk", self.machines["contract_notice"]["states"]
        )

        self.f.clock = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
        notice = self.f.command(
            "contract_notice",
            notice,
            "flag_time_bar_risk",
            actor="SUP",
            evidence=[self.f.evidence],
        )
        self.assertEqual(notice["status"], "notice_due")
        self.assertTrue(notice["data"]["timeBarRisk"])

        notice = self.f.command(
            "contract_notice",
            notice,
            "submit_notice",
            actor="CON",
            evidence=[self.f.evidence],
        )
        self.assertEqual(notice["status"], "submitted")
        self.assertTrue(notice["data"]["timeBarRisk"])
        self.assertTrue(
            self.execution["noticeDeadline"][
                "overdue_sets_risk_flag_not_automatic_forfeiture"
            ]
        )

    def test_delay_event_alone_cannot_submit_eot_without_notice(self):
        delay = self.create_delay()
        eot = self.f.create(
            "eot_request",
            {"title": "EOT draft", "data": {"eotNo": "EOT-001"}},
            actor="CON",
        )
        with self.assertRaisesRegex(ContractError, "Required command fields"):
            self.f.command(
                "eot_request",
                eot,
                "submit_eot",
                {
                    "delayEventRefs": [self.f.ref("WorkItem", delay["id"])],
                    "baselineScheduleRef": self.f.ref(
                        "InformationItem", self.baseline["id"]
                    ),
                    "impactAnalysisRefs": [
                        self.f.ref("Evidence", self.f.evidence)
                    ],
                    "daysClaimed": 10,
                },
                actor="CON",
                evidence=[self.f.evidence],
            )
        current = self.f.engine.get("WorkItem", eot["id"])
        self.assertEqual(current["status"], "draft")
        self.assertTrue(
            self.execution["principles"]["delay_event_is_fact_not_entitlement"]
        )

    def test_owner_decision_must_target_exact_current_eot_version(self):
        delay = self.create_delay()
        notice = self.create_notice(delay)
        eot = self.f.create(
            "eot_request",
            {"title": "EOT draft", "data": {"eotNo": "EOT-EXACT"}},
            actor="CON",
        )
        eot = self.advance_eot_to_decision_pending(eot, delay, notice)

        stale_target = {
            "objectType": "WorkItem",
            "objectId": eot["id"],
            "version": eot["version"] - 1,
        }
        decision_id = uid()
        self.f.engine.bootstrap(
            "Decision",
            {
                "id": decision_id,
                "projectId": self.f.project,
                "status": "decided",
                "title": "Stale EOT decision",
                "targetRef": stale_target,
                "options": [{"id": "A"}],
                "impact": {},
                "recommendation": "approve",
                "actionIds": [],
                "decision": "approved",
                "decisionReason": "stale target probe",
                "decisionAt": AT,
                **self.f.scope(),
            },
        )
        with self.assertRaisesRegex(ContractError, "exact contract-track version"):
            self.f.command(
                "eot_request",
                eot,
                "approve_eot",
                {
                    "decisionRef": self.f.ref("Decision", decision_id),
                    "daysApproved": 10,
                    "revisedCompletionDate": "2027-01-10T00:00:00Z",
                },
                actor="OWN",
                evidence=[self.f.evidence],
            )

    def test_full_eot_dispute_resolution_cannot_record_partial_days(self):
        delay = self.create_delay()
        notice = self.create_notice(delay)
        eot = self.f.create(
            "eot_request",
            {"title": "EOT draft", "data": {"eotNo": "EOT-DISPUTE"}},
            actor="CON",
        )
        eot = self.advance_eot_to_decision_pending(eot, delay, notice)
        returned = self.create_decision(eot, "returned", "Return EOT decision")
        eot = self.f.command(
            "eot_request",
            eot,
            "dispute_eot",
            {
                "decisionRef": self.f.ref("Decision", returned["id"]),
                "disputeReason": "Owner returned entitlement for negotiation",
            },
            actor="OWN",
            evidence=[self.f.evidence],
        )
        approved = self.create_decision(eot, "approved", "Resolve EOT dispute")
        with self.assertRaisesRegex(
            ContractError, "Full approval must equal claimed EOT days"
        ):
            self.f.command(
                "eot_request",
                eot,
                "resolve_eot_dispute_approved",
                {
                    "decisionRef": self.f.ref("Decision", approved["id"]),
                    "daysApproved": 5,
                    "revisedCompletionDate": "2027-01-05T00:00:00Z",
                },
                actor="OWN",
                evidence=[self.f.evidence],
            )

    def test_approved_eot_exact_version_is_preserved_as_baseline_revision_basis(self):
        delay = self.create_delay()
        notice = self.create_notice(delay)
        eot = self.f.create(
            "eot_request",
            {"title": "EOT draft", "data": {"eotNo": "EOT-002"}},
            actor="CON",
        )
        eot = self.advance_eot_to_decision_pending(eot, delay, notice)
        decision = self.create_decision(eot, "approved", "Approve EOT")

        approved = self.f.command(
            "eot_request",
            eot,
            "approve_eot",
            {
                "decisionRef": self.f.ref("Decision", decision["id"]),
                "daysApproved": 10,
                "revisedCompletionDate": "2027-01-10T00:00:00Z",
            },
            actor="OWN",
            evidence=[self.f.evidence],
        )
        self.assertEqual(approved["status"], "approved")

        pending = self.f.command(
            "eot_request",
            approved,
            "request_baseline_update",
            actor="SUP",
            evidence=[],
        )
        basis = pending["data"]["baselineRevisionBasisRef"]
        self.assertEqual(basis["objectId"], approved["id"])
        self.assertEqual(basis["version"], approved["version"])
        self.assertEqual(
            self.f.engine.resolve(basis, self.f.project)["status"], "approved"
        )
        self.assertTrue(
            self.f.engine._approved_schedule_revision_basis(
                basis, self.f.project
            )
        )
        self.assertEqual(
            self.f.engine.get("InformationItem", self.baseline["id"])[
                "status"
            ],
            "effective",
        )

        revised = self.bootstrap_baseline(
            revision="B1",
            completion="2027-01-10T00:00:00Z",
            basis=basis,
        )
        closed = self.f.command(
            "eot_request",
            pending,
            "confirm_baseline_update",
            {"baselineRevisionRef": self.f.ref("InformationItem", revised["id"])},
            actor="SUP",
            evidence=[],
        )
        self.assertEqual(closed["status"], "closed")
        self.assertNotEqual(revised["id"], self.baseline["id"])
        self.assertEqual(revised["schedule"]["revisionBasisRef"], basis)

    def test_eot_cannot_close_against_baseline_without_exact_eot_basis(self):
        delay = self.create_delay()
        notice = self.create_notice(delay)
        eot = self.f.create(
            "eot_request",
            {"title": "EOT draft", "data": {"eotNo": "EOT-BAD-BASIS"}},
            actor="CON",
        )
        eot = self.advance_eot_to_decision_pending(eot, delay, notice)
        decision = self.create_decision(eot)
        approved = self.f.command(
            "eot_request",
            eot,
            "approve_eot",
            {
                "decisionRef": self.f.ref("Decision", decision["id"]),
                "daysApproved": 10,
                "revisedCompletionDate": "2027-01-10T00:00:00Z",
            },
            actor="OWN",
        )
        pending = self.f.command(
            "eot_request",
            approved,
            "request_baseline_update",
            actor="SUP",
            evidence=[],
        )
        wrong = self.bootstrap_baseline(
            revision="B1",
            completion="2027-01-10T00:00:00Z",
            basis=self.f.ref("Decision", decision["id"]),
        )
        with self.assertRaisesRegex(
            ContractError, "must cite the exact approved EOT version"
        ):
            self.f.command(
                "eot_request",
                pending,
                "confirm_baseline_update",
                {
                    "baselineRevisionRef": self.f.ref(
                        "InformationItem", wrong["id"]
                    )
                },
                actor="SUP",
                evidence=[],
            )

    def test_partial_claim_preserves_original_claimed_amount(self):
        delay = self.create_delay()
        notice = self.create_notice(delay)
        claim = self.f.create(
            "claim",
            {"title": "Cost claim", "data": {"claimNo": "CL-001"}},
            actor="CON",
        )
        claim = self.f.command(
            "claim",
            claim,
            "submit_claim",
            {
                "noticeRefs": [self.f.ref("WorkItem", notice["id"])],
                "eventRefs": [self.f.ref("WorkItem", delay["id"])],
                "clauseRefs": [self.f.ref("Requirement", self.f.requirement)],
                "claimType": "cost",
                "reliefRequested": "Additional payment",
                "entitlementBasis": "Contract delay clause",
                "chronology": "Delay event then contractual notice",
                "evidenceRefs": [self.f.ref("Evidence", self.f.evidence)],
                "amountClaimed": 100.0,
                "currency": "USD",
            },
            actor="CON",
            evidence=[self.f.evidence],
        )
        claim = self.f.command(
            "claim",
            claim,
            "receive_claim",
            actor="SUP",
            evidence=[self.f.evidence],
        )
        claim = self.f.command(
            "claim",
            claim,
            "start_entitlement_review",
            {"entitlementAssessment": "Partially supported"},
            actor="SUP",
            evidence=[self.f.evidence],
        )
        claim = self.f.command(
            "claim",
            claim,
            "start_quantum_review",
            {
                "amountAssessed": 60.0,
                "recommendation": "Approve supported portion only",
            },
            actor="SUP",
            evidence=[],
        )
        claim = self.f.command(
            "claim",
            claim,
            "request_claim_decision",
            {"recommendation": "Approve USD 60; preserve balance as disputed"},
            actor="SUP",
            evidence=[],
        )
        decision = self.create_decision(claim, "approved", "Partial claim approval")
        claim = self.f.command(
            "claim",
            claim,
            "partially_approve_claim",
            {
                "decisionRef": self.f.ref("Decision", decision["id"]),
                "amountApproved": 60.0,
                "disputedItems": ["Remaining USD 40"],
            },
            actor="OWN",
            evidence=[self.f.evidence],
        )
        self.assertEqual(claim["status"], "partially_approved")
        self.assertEqual(claim["data"]["amountClaimed"], 100.0)
        self.assertEqual(claim["data"]["amountApproved"], 60.0)
        self.assertEqual(
            claim["data"]["decisionOutcome"], "partially_approved"
        )
        self.assertTrue(
            self.execution["claimBoundary"][
                "claimed_amount_preserved_after_submission"
            ]
        )

    def test_register_26_exposes_commands_without_raw_status_patch(self):
        register = self.registers["26"]
        self.assertFalse(register["raw_status_patch"])
        self.assertIn(
            "contract_notice:flag_time_bar_risk",
            register["allowed_commands"],
        )
        self.assertIn("claim:partially_approve_claim", register["allowed_commands"])
        self.assertIn(
            "eot_request:request_baseline_update",
            register["allowed_commands"],
        )
        self.assertTrue(
            {"notice_due", "time_bar_risk", "claim_status", "eot_status"}
            <= set(register["calculated_fields"])
        )


if __name__ == "__main__":
    unittest.main()
