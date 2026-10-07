import unittest

from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import AT, Fixture
from tests.test_schedule_execution_contract import ScheduleExecutionContractTests


class RecoveryDecisionTargetRegressionTests(ScheduleExecutionContractTests):
    def prepare_recovery(self):
        baseline = self.make_baseline()
        progress = self.freeze_progress(baseline)
        delay = self.delay(baseline, progress)
        recovery = self.f.create(
            "recovery_plan",
            {
                "title": "Owner decision recovery",
                "data": {"triggerDelayEventRefs": [self.f.ref("WorkItem", delay["id"])]},
            },
            "SUP",
        )
        recovery = self.f.command("recovery_plan", recovery, "begin_recovery_draft", {}, "CON")
        payload = dict(
            recoveryPlanNo="RP-DEC-001",
            targetMilestoneIds=["M1"],
            targetCompletionAt="2026-12-31T00:00:00Z",
            currentForecastCompletionAt="2027-01-15T00:00:00Z",
            proposedForecastCompletionAt="2026-12-31T00:00:00Z",
            strategy="Resequence critical activities",
            qualityImpact="none",
            safetyImpact="none",
            costImpact="separate review",
            contractImpact="separate review",
            qualityStandardsRelaxed=False,
            safetyStandardsRelaxed=False,
            recoveryScheduleRef=self.recovery_schedule(),
            ownerDecisionRequired=True,
            monitoringPeriod="weekly",
            monitoringKpis=["forecast completion"],
        )
        recovery = self.f.command("recovery_plan", recovery, "submit_recovery", payload, "CON")
        recovery = self.f.command("recovery_plan", recovery, "receive_recovery", {}, "SUP")
        recovery = self.f.command("recovery_plan", recovery, "start_recovery_review", {}, "SUP")
        return self.f.command("recovery_plan", recovery, "request_recovery_decision", {}, "SUP")

    def decision(self, target, *, scope=None):
        decision_id = uid()
        values = self.f.scope()
        if scope:
            values.update(scope)
        self.f.engine.bootstrap(
            "Decision",
            dict(
                id=decision_id,
                projectId=self.f.project,
                status="decided",
                title="Owner Recovery Decision",
                targetRef=target,
                options=[{"id": "A"}],
                impact={"schedule": "recovery"},
                recommendation="approve",
                actionIds=[],
                decision="approved",
                decisionReason="Approved",
                decisionAt=AT,
                **values,
            ),
        )
        return self.f.engine.get("Decision", decision_id)

    def test_unrelated_or_stale_owner_decision_cannot_accept_recovery(self):
        recovery = self.prepare_recovery()
        unrelated = self.decision(self.f.ref("Requirement", self.f.requirement))
        with self.assertRaisesRegex(ContractError, "exact Recovery Plan version"):
            self.f.command(
                "recovery_plan",
                recovery,
                "accept_recovery",
                {"decisionRefs": [self.f.ref("Decision", unrelated["id"])]},
                "SUP",
            )

        stale_target = {"objectType": "WorkItem", "objectId": recovery["id"], "version": recovery["version"] - 1}
        stale = self.decision(stale_target)
        with self.assertRaisesRegex(ContractError, "exact Recovery Plan version"):
            self.f.command(
                "recovery_plan",
                recovery,
                "accept_recovery",
                {"decisionRefs": [self.f.ref("Decision", stale["id"])]},
                "SUP",
            )

    def test_exact_owner_decision_accepts_recovery(self):
        recovery = self.prepare_recovery()
        decision = self.decision(self.f.ref("WorkItem", recovery["id"]))
        accepted = self.f.command(
            "recovery_plan",
            recovery,
            "accept_recovery",
            {"decisionRefs": [self.f.ref("Decision", decision["id"])]},
            "SUP",
        )
        self.assertEqual(accepted["status"], "accepted_for_execution")


if __name__ == "__main__":
    unittest.main()
