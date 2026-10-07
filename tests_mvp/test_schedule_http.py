"""Backend acceptance for Product F-04 Schedule / Delay / Recovery.

Exercises real FastAPI + SQLite snapshot persistence. Product owns lifecycle and
authority semantics; Backend proves HTTP exposure, durable state, idempotency,
version conflicts, atomic baseline/progress replacement, and restart behavior.
"""
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


AT = "2026-10-06T10:00:00Z"


def digest(text):
    return sha256(text.encode()).hexdigest()


class ScheduleHttpPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "state.db")
        self.app = create_app(self.path, demo=True)
        self.client = TestClient(self.app)
        self.sessions = {}
        self.headers = {}
        for group in ["CON", "SUP", "OWN"]:
            session, headers = self.login(group)
            self.sessions[group] = session
            self.headers[group] = headers
        self.project_id = self.sessions["CON"]["projectId"]
        self.scope = self.workspace_scope(self.sessions["CON"], self.headers["CON"])
        self.evidence_id = self.app.state.store.meta["evidenceId"]

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

    def workspace_scope(self, session, headers):
        response = self.client.get(
            f"/projects/{session['projectId']}/workspace", headers=headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["context"]["scope"]

    def reopen(self):
        self.client.close()
        self.app.state.store.close()
        self.app = create_app(self.path, demo=True)
        self.client = TestClient(self.app)
        self.sessions = {}
        self.headers = {}
        for group in ["CON", "SUP", "OWN"]:
            session, headers = self.login(group)
            self.sessions[group] = session
            self.headers[group] = headers

    @staticmethod
    def ref(record, object_type=None):
        return {
            "objectType": object_type or (
                "InformationItem" if record.get("subtype") == "Schedule" else "WorkItem"
            ),
            "objectId": record["id"],
            "version": record["version"],
        }

    def command(self, collection, record, command, actor, payload=None, evidence=None, key=None):
        body = {
            "roleAssignmentId": self.sessions[actor]["actor"]["roleAssignmentId"],
            "expectedVersion": record["version"],
            "payload": payload or {},
            "evidenceIds": evidence or [],
        }
        response = self.client.post(
            f"/projects/{self.project_id}/{collection}/{record['id']}/{command.replace('_','-')}",
            headers={**self.headers[actor], "Idempotency-Key": key or uid()},
            json=body,
        )
        return response

    def bootstrap_activity(self, schedule_id, name="Critical", percent=25):
        oid = uid()
        with self.app.state.store.transaction(True):
            activity = self.app.state.store.engine.bootstrap(
                "WorkItem",
                {
                    "id": oid,
                    "projectId": self.project_id,
                    "subtype": "ScheduleActivity",
                    "status": "snapshot",
                    "title": name,
                    "data": {
                        "activityId": "A-" + oid[:8],
                        "wbsPath": "1.0",
                        "activityName": name,
                        "percentComplete": percent,
                        "critical": True,
                        "sourceScheduleRef": {
                            "objectType": "InformationItem",
                            "objectId": schedule_id,
                            "version": 1,
                        },
                    },
                    **self.scope,
                },
            )
        return self.ref(activity, "WorkItem")

    def baseline_payload(self, schedule_id, revision="B0", basis=None):
        file_id = uid()
        critical = self.bootstrap_activity(schedule_id)
        schedule = {
            "scheduleNo": "BL-" + revision,
            "scheduleKind": "baseline",
            "revision": revision,
            "sourceFileRef": file_id,
            "sourceFormat": "xer",
            "sourceFileHash": digest("baseline-" + revision),
            "sourceFileVersion": revision,
            "dataDate": "2026-01-01T00:00:00Z",
            "projectStartAt": "2026-01-01T00:00:00Z",
            "contractualCompletionAt": "2026-12-31T00:00:00Z",
            "forecastCompletionAt": "2026-12-31T00:00:00Z",
            "calendars": [{
                "calendarId": "STD",
                "name": "Standard",
                "timezone": "Asia/Ho_Chi_Minh",
                "workingDays": [1, 2, 3, 4, 5],
                "hoursPerDay": 8,
            }],
            "wbsVersion": "1",
            "milestoneSet": [{
                "milestoneId": "M1",
                "name": "Completion",
                "plannedAt": "2026-12-31T00:00:00Z",
                "contractualAt": "2026-12-31T00:00:00Z",
            }],
            "criticalPathRef": critical,
            "activityCount": 10,
            "scheduleQualitySummary": {
                key: True for key in [
                    "contractDatesAligned", "wbsComplete", "activityIdsUnique",
                    "calendarsDefined", "logicComplete", "openEndsIdentified",
                    "constraintsReviewed", "durationOutliersReviewed",
                    "criticalPathComputable", "floatOutliersReviewed",
                    "interfacesReviewed", "sourceFilePreserved",
                ]
            },
        }
        if basis:
            schedule["revisionBasisRef"] = basis
        return {
            **self.scope,
            "title": "Contract Baseline " + revision,
            "revision": revision,
            "fileIds": [file_id],
            "evidenceIds": [self.evidence_id],
            "schedule": schedule,
        }

    def create_baseline(self, revision="B0", basis=None):
        oid = uid()
        response = self.client.post(
            f"/projects/{self.project_id}/schedule-baselines",
            headers={**self.headers["CON"], "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.sessions["CON"]["actor"]["roleAssignmentId"],
                "clientObjectId": oid,
                "payload": self.baseline_payload(oid, revision, basis),
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def bootstrap_approval(self, baseline):
        sup = self.sessions["SUP"]["actor"]
        with self.app.state.store.transaction(True):
            approval = self.app.state.store.engine.bootstrap(
                "Approval",
                {
                    "id": uid(),
                    "projectId": self.project_id,
                    "status": "approved",
                    "targetRef": self.ref(baseline),
                    "requestedBy": self.sessions["CON"]["actor"]["partyId"],
                    "approvalKind": "technical",
                    "approvedBy": sup["partyId"],
                    "approvedAt": AT,
                    **self.scope,
                },
            )
        return self.ref(approval, "Approval")

    def activate_baseline(self, baseline):
        for command, actor in [
            ("submit_baseline", "CON"),
            ("receive_baseline", "SUP"),
            ("start_baseline_review", "SUP"),
            ("request_baseline_decision", "SUP"),
        ]:
            response = self.command("schedule-baselines", baseline, command, actor)
            self.assertEqual(response.status_code, 200, response.text)
            baseline = response.json()["record"]
        approval = self.bootstrap_approval(baseline)
        response = self.command(
            "schedule-baselines", baseline, "approve_baseline", "SUP",
            {"approvalRef": approval},
        )
        self.assertEqual(response.status_code, 200, response.text)
        baseline = response.json()["record"]
        response = self.command(
            "schedule-baselines", baseline, "activate_baseline", "SUP"
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["record"]

    def create_effective_baseline(self, revision="B0", basis=None):
        return self.activate_baseline(self.create_baseline(revision, basis))

    def bootstrap_revision_decision(self, target):
        with self.app.state.store.transaction(True):
            decision = self.app.state.store.engine.bootstrap(
                "Decision",
                {
                    "id": uid(),
                    "projectId": self.project_id,
                    "status": "decided",
                    "title": "Approved schedule revision basis",
                    "targetRef": self.ref(target),
                    "options": [{"id": "approve"}],
                    "impact": {"schedule": "approved revision"},
                    "recommendation": "approve",
                    "actionIds": [],
                    "decision": "approved",
                    "decisionReason": "Approved basis",
                    "decisionAt": AT,
                    **self.scope,
                },
            )
        return self.ref(decision, "Decision")

    def progress_payload(self, baseline, schedule_id, previous=None, correction=False):
        file_id = uid()
        critical = self.bootstrap_activity(schedule_id, "Progress critical")
        schedule = {
            "scheduleNo": "UP-2026-06-30",
            "scheduleKind": "progress_update",
            "revision": "U1",
            "sourceFileRef": file_id,
            "sourceFormat": "xer",
            "sourceFileHash": digest(schedule_id),
            "sourceFileVersion": "U1",
            "dataDate": "2026-06-30T00:00:00Z",
            "periodStart": "2026-06-01T00:00:00Z",
            "periodEnd": "2026-06-30T00:00:00Z",
            "forecastCompletionAt": "2027-01-15T00:00:00Z",
            "milestoneSet": [{
                "milestoneId": "M1",
                "name": "Completion",
                "forecastAt": "2027-01-15T00:00:00Z",
            }],
            "criticalPathRef": critical,
            "activityCount": 10,
            "baselineScheduleRef": self.ref(baseline),
        }
        if previous:
            schedule["previousScheduleRef"] = self.ref(previous)
            if correction:
                schedule["correctionOfRef"] = self.ref(previous)
                schedule["correctionReason"] = "현장 실적 정정"
        return {
            **self.scope,
            "title": "Progress Update",
            "revision": "U1",
            "fileIds": [file_id],
            "evidenceIds": [self.evidence_id],
            "schedule": schedule,
        }

    def create_progress(self, baseline, previous=None, correction=False):
        oid = uid()
        response = self.client.post(
            f"/projects/{self.project_id}/schedule-progress-updates",
            headers={**self.headers["CON"], "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.sessions["CON"]["actor"]["roleAssignmentId"],
                "clientObjectId": oid,
                "payload": self.progress_payload(baseline, oid, previous, correction),
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def freeze_progress(self, baseline, previous=None, correction=False, freeze_key=None):
        progress = self.create_progress(baseline, previous, correction)
        for command, payload in [
            ("receive_progress", {}),
            ("start_progress_verification", {}),
            ("accept_progress_for_reporting", {
                "actualsVerified": True,
                "forecastVerified": True,
                "criticalPathReviewed": True,
                "varianceExplained": True,
            }),
        ]:
            response = self.command(
                "schedule-progress-updates", progress, command, "SUP", payload
            )
            self.assertEqual(response.status_code, 200, response.text)
            progress = response.json()["record"]
        body = {
            "roleAssignmentId": self.sessions["SUP"]["actor"]["roleAssignmentId"],
            "expectedVersion": progress["version"],
            "payload": {},
            "evidenceIds": [],
        }
        key = freeze_key or uid()
        response = self.client.post(
            f"/projects/{self.project_id}/schedule-progress-updates/{progress['id']}/freeze-progress",
            headers={**self.headers["SUP"], "Idempotency-Key": key},
            json=body,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["record"], body, key

    def create_delay(self, baseline, current):
        response = self.client.post(
            f"/projects/{self.project_id}/delay-events",
            headers={**self.headers["SUP"], "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.sessions["SUP"]["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": {
                    **self.scope,
                    "title": "Forecast delay",
                    "evidenceIds": [self.evidence_id],
                    "data": {
                        "delayEventNo": "DE-001",
                        "eventType": "forecast_delay",
                        "observedAt": AT,
                        "knownAt": AT,
                        "description": "완료예정일 지연",
                        "baselineScheduleRef": self.ref(baseline),
                        "currentScheduleRef": self.ref(current),
                    },
                },
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def bootstrap_recovery_schedule(self):
        oid, file_id = uid(), uid()
        with self.app.state.store.transaction(True):
            record = self.app.state.store.engine.bootstrap(
                "InformationItem",
                {
                    "id": oid,
                    "projectId": self.project_id,
                    "subtype": "Schedule",
                    "title": "Recovery Schedule",
                    "revision": "R1",
                    "status": "frozen",
                    "fileIds": [file_id],
                    "schedule": {
                        "scheduleNo": "REC-SCH-01",
                        "scheduleKind": "recovery",
                        "revision": "R1",
                        "sourceFileRef": file_id,
                        "sourceFormat": "xer",
                        "sourceFileHash": digest("recovery"),
                        "sourceFileVersion": "R1",
                    },
                    **self.scope,
                },
            )
        return self.ref(record)

    def test_baseline_activation_persists_and_idempotent_replay_survives_restart(self):
        baseline = self.create_baseline()
        for command, actor in [
            ("submit_baseline", "CON"),
            ("receive_baseline", "SUP"),
            ("start_baseline_review", "SUP"),
            ("request_baseline_decision", "SUP"),
        ]:
            response = self.command("schedule-baselines", baseline, command, actor)
            self.assertEqual(response.status_code, 200, response.text)
            baseline = response.json()["record"]
        approval = self.bootstrap_approval(baseline)
        response = self.command(
            "schedule-baselines", baseline, "approve_baseline", "SUP",
            {"approvalRef": approval},
        )
        self.assertEqual(response.status_code, 200, response.text)
        baseline = response.json()["record"]

        body = {
            "roleAssignmentId": self.sessions["SUP"]["actor"]["roleAssignmentId"],
            "expectedVersion": baseline["version"],
            "payload": {},
            "evidenceIds": [],
        }
        key = uid()
        endpoint = f"/projects/{self.project_id}/schedule-baselines/{baseline['id']}/activate-baseline"
        first = self.client.post(
            endpoint, headers={**self.headers["SUP"], "Idempotency-Key": key}, json=body
        )
        self.assertEqual(first.status_code, 200, first.text)
        activated = first.json()["record"]
        self.assertEqual(activated["status"], "effective")

        replay = self.client.post(
            endpoint, headers={**self.headers["SUP"], "Idempotency-Key": key}, json=body
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), first.json())

        self.reopen()
        replay_after_restart = self.client.post(
            endpoint, headers={**self.headers["SUP"], "Idempotency-Key": key}, json=body
        )
        self.assertEqual(replay_after_restart.status_code, 200, replay_after_restart.text)
        self.assertEqual(replay_after_restart.json(), first.json())
        persisted = self.app.state.store.engine.get("InformationItem", baseline["id"])
        self.assertEqual(persisted["status"], "effective")

    def test_baseline_revision_supersedes_prior_atomically_and_rolls_back_on_failure(self):
        first = self.create_effective_baseline("B0")
        basis = self.bootstrap_revision_decision(first)
        second = self.create_baseline("B1", basis)
        for command, actor in [
            ("submit_baseline", "CON"),
            ("receive_baseline", "SUP"),
            ("start_baseline_review", "SUP"),
            ("request_baseline_decision", "SUP"),
        ]:
            response = self.command("schedule-baselines", second, command, actor)
            self.assertEqual(response.status_code, 200, response.text)
            second = response.json()["record"]
        approval = self.bootstrap_approval(second)
        response = self.command(
            "schedule-baselines", second, "approve_baseline", "SUP",
            {"approvalRef": approval, "revisionBasisRef": basis},
        )
        self.assertEqual(response.status_code, 200, response.text)
        second = response.json()["record"]

        first_before = self.app.state.store.engine.get("InformationItem", first["id"])
        second_before = self.app.state.store.engine.get("InformationItem", second["id"])
        original_event = self.app.state.store.engine._event

        def fail_derived(record, command, *args, **kwargs):
            if command == "schedule_baseline:derived_supersede":
                raise RuntimeError("synthetic atomicity failure")
            return original_event(record, command, *args, **kwargs)

        with patch.object(self.app.state.store.engine, "_event", side_effect=fail_derived):
            with self.assertRaises(RuntimeError):
                self.command(
                    "schedule-baselines", second, "activate_baseline", "SUP"
                )

        self.assertEqual(
            self.app.state.store.engine.get("InformationItem", first["id"]), first_before
        )
        self.assertEqual(
            self.app.state.store.engine.get("InformationItem", second["id"]), second_before
        )

        response = self.command(
            "schedule-baselines", second, "activate_baseline", "SUP"
        )
        self.assertEqual(response.status_code, 200, response.text)
        second = response.json()["record"]
        first_now = self.app.state.store.engine.get("InformationItem", first["id"])
        self.assertEqual(first_now["status"], "superseded")
        self.assertEqual(second["status"], "effective")
        self.assertEqual(second["schedule"]["supersedesRef"]["objectId"], first["id"])

    def test_progress_freeze_correction_is_durable_and_stale_version_is_rejected(self):
        baseline = self.create_effective_baseline()
        baseline_before = self.app.state.store.engine.get("InformationItem", baseline["id"])
        first, _, _ = self.freeze_progress(baseline)
        self.assertEqual(first["status"], "frozen")
        self.assertGreater(
            first["schedule"]["variance"]["forecastCompletionVarianceDays"], 0
        )
        self.assertEqual(
            self.app.state.store.engine.get("InformationItem", baseline["id"]),
            baseline_before,
        )

        corrected, freeze_body, freeze_key = self.freeze_progress(
            baseline, first, True
        )
        prior = self.app.state.store.engine.get("InformationItem", first["id"])
        self.assertEqual(prior["status"], "superseded")
        self.assertEqual(corrected["status"], "frozen")
        self.assertEqual(corrected["schedule"]["supersedesRef"]["objectId"], first["id"])

        stale = self.client.post(
            f"/projects/{self.project_id}/schedule-progress-updates/{corrected['id']}/freeze-progress",
            headers={**self.headers["SUP"], "Idempotency-Key": uid()},
            json=freeze_body,
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["code"], "VERSION_CONFLICT")

        self.reopen()
        replay = self.client.post(
            f"/projects/{self.project_id}/schedule-progress-updates/{corrected['id']}/freeze-progress",
            headers={**self.headers["SUP"], "Idempotency-Key": freeze_key},
            json=freeze_body,
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["record"]["id"], corrected["id"])
        persisted = self.app.state.store.engine.get("InformationItem", corrected["id"])
        self.assertEqual(persisted["status"], "frozen")

    def test_delay_mitigation_requires_current_evidence_and_preserves_failed_request(self):
        baseline = self.create_effective_baseline()
        progress, _, _ = self.freeze_progress(baseline)
        delay = self.create_delay(baseline, progress)
        for command, payload in [
            ("notify", {}),
            ("start_assessment", {"assignedPartyId": self.sessions["CON"]["actor"]["partyId"], "causeCategory": "procurement_delay"}),
            ("start_impact_analysis", {"affectedMilestoneIds": ["M1"], "currentForecastImpactDays": 15, "criticalPathAffected": True, "totalFloatImpact": -15}),
        ]:
            response = self.command("delay-events", delay, command, "SUP", payload)
            self.assertEqual(response.status_code, 200, response.text)
            delay = response.json()["record"]
        response = self.client.post(
            f"/projects/{self.project_id}/actions",
            headers={**self.headers["SUP"], "Idempotency-Key": uid()},
            json={"roleAssignmentId": self.sessions["SUP"]["actor"]["roleAssignmentId"],
                  "clientObjectId": uid(), "payload": {**self.scope, "title": "Mitigate procurement delay"}},
        )
        self.assertEqual(response.status_code, 201, response.text)
        action = response.json()["record"]
        payload = {
            "impactAnalysis": {
                "baselineScheduleRef": self.ref(baseline),
                "dataDate": progress["schedule"]["dataDate"],
                "scheduleRef": self.ref(progress),
                "affectedActivityRefs": [], "affectedMilestoneIds": ["M1"],
                "criticalPathAffected": True,
                "beforeForecastAt": "2026-12-31T00:00:00Z",
                "afterForecastAt": "2027-01-15T00:00:00Z",
                "forecastImpactDays": 15, "mitigationIncluded": True,
                "assumptions": ["procurement"],
            },
            "mitigationActionRefs": [self.ref(action, "Action")],
        }
        engine = self.app.state.store.engine
        audit_count = len(engine.audit_events)
        missing = self.command("delay-events", delay, "start_mitigation", "SUP", payload, evidence=[])
        self.assertEqual(missing.status_code, 409, missing.text)
        self.assertEqual(missing.json()["code"], "EVIDENCE_REQUIRED")
        self.assertEqual(engine.get("WorkItem", delay["id"]), delay)
        self.assertEqual(len(engine.audit_events), audit_count)
        with self.app.state.store.transaction(True):
            foreign = self.app.state.store.engine.get("Evidence", self.evidence_id)
            foreign.update(id=uid(), projectId=uid())
            self.app.state.store.engine.bootstrap("Evidence", foreign)
        invalid = self.command("delay-events", delay, "start_mitigation", "SUP", payload, evidence=[foreign["id"]])
        self.assertEqual(invalid.status_code, 409, invalid.text)
        self.assertEqual(invalid.json()["code"], "EVIDENCE_INVALID")
        self.assertEqual(self.app.state.store.engine.get("WorkItem", delay["id"]), delay)
        self.reopen()
        self.assertEqual(self.app.state.store.engine.get("WorkItem", delay["id"]), delay)
        key = uid()
        accepted = self.command("delay-events", delay, "start_mitigation", "SUP", payload, evidence=[self.evidence_id], key=key)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["record"]["status"], "mitigation_active")
        self.reopen()
        replay = self.command("delay-events", delay, "start_mitigation", "SUP", payload, evidence=[self.evidence_id], key=key)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), accepted.json())

    def test_recovery_owner_decision_must_target_exact_current_recovery_version_http(self):
        baseline = self.create_effective_baseline()
        progress, _, _ = self.freeze_progress(baseline)
        delay = self.create_delay(baseline, progress)
        response = self.command("delay-events", delay, "notify", "SUP")
        self.assertEqual(response.status_code, 200, response.text)
        delay = response.json()["record"]

        response = self.client.post(
            f"/projects/{self.project_id}/recovery-plans",
            headers={**self.headers["SUP"], "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.sessions["SUP"]["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": {
                    **self.scope,
                    "title": "Owner decision Recovery",
                    "evidenceIds": [self.evidence_id],
                    "data": {"triggerDelayEventRefs": [self.ref(delay, "WorkItem")]},
                },
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        recovery = response.json()["record"]
        response = self.command("recovery-plans", recovery, "begin_recovery_draft", "CON")
        self.assertEqual(response.status_code, 200, response.text)
        recovery = response.json()["record"]

        payload = {
            "recoveryPlanNo": "RP-DECISION-HTTP",
            "targetMilestoneIds": ["M1"],
            "targetCompletionAt": "2026-12-31T00:00:00Z",
            "currentForecastCompletionAt": "2027-01-15T00:00:00Z",
            "proposedForecastCompletionAt": "2026-12-31T00:00:00Z",
            "strategy": "Owner decision required",
            "qualityImpact": "none",
            "safetyImpact": "none",
            "costImpact": "separate",
            "contractImpact": "Owner decision required",
            "qualityStandardsRelaxed": False,
            "safetyStandardsRelaxed": False,
            "recoveryScheduleRef": self.bootstrap_recovery_schedule(),
            "ownerDecisionRequired": True,
            "monitoringPeriod": "weekly",
            "monitoringKpis": ["completion"],
        }
        for command, actor, command_payload in [
            ("submit_recovery", "CON", payload),
            ("receive_recovery", "SUP", {}),
            ("start_recovery_review", "SUP", {}),
            ("request_recovery_decision", "SUP", {}),
        ]:
            response = self.command("recovery-plans", recovery, command, actor, command_payload)
            self.assertEqual(response.status_code, 200, response.text)
            recovery = response.json()["record"]

        wrong = self.bootstrap_revision_decision(baseline)
        rejected = self.command(
            "recovery-plans",
            recovery,
            "accept_recovery",
            "SUP",
            {"decisionRefs": [wrong]},
        )
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(rejected.json()["code"], "RECOVERY_DECISION_APPROVED")
        self.assertEqual(
            self.app.state.store.engine.get("WorkItem", recovery["id"])["status"],
            "decision_pending",
        )

        exact = self.bootstrap_revision_decision(recovery)
        accepted = self.command(
            "recovery-plans",
            recovery,
            "accept_recovery",
            "SUP",
            {"decisionRefs": [exact]},
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["record"]["status"], "accepted_for_execution")

    def test_delay_and_recovery_persist_without_mutating_entitlement_or_baseline(self):
        baseline = self.create_effective_baseline()
        progress, _, _ = self.freeze_progress(baseline)
        delay = self.create_delay(baseline, progress)

        response = self.command("delay-events", delay, "notify", "SUP")
        self.assertEqual(response.status_code, 200, response.text)
        delay = response.json()["record"]

        response = self.client.post(
            f"/projects/{self.project_id}/recovery-plans",
            headers={**self.headers["SUP"], "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.sessions["SUP"]["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": {
                    **self.scope,
                    "title": "Recovery Plan",
                    "evidenceIds": [self.evidence_id],
                    "data": {"triggerDelayEventRefs": [self.ref(delay, "WorkItem")]},
                },
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        recovery = response.json()["record"]

        response = self.command(
            "recovery-plans", recovery, "begin_recovery_draft", "CON"
        )
        self.assertEqual(response.status_code, 200, response.text)
        recovery = response.json()["record"]

        payload = {
            "recoveryPlanNo": "RP-001",
            "targetMilestoneIds": ["M1"],
            "targetCompletionAt": "2026-12-31T00:00:00Z",
            "currentForecastCompletionAt": "2027-01-15T00:00:00Z",
            "proposedForecastCompletionAt": "2026-12-31T00:00:00Z",
            "strategy": "Resequence critical activities",
            "qualityImpact": "none",
            "safetyImpact": "none",
            "costImpact": "subject to separate review",
            "contractImpact": "none admitted",
            "qualityStandardsRelaxed": False,
            "safetyStandardsRelaxed": False,
            "recoveryScheduleRef": self.bootstrap_recovery_schedule(),
            "ownerDecisionRequired": False,
            "monitoringPeriod": "weekly",
            "monitoringKpis": ["forecast completion", "critical float"],
        }
        for command, actor, command_payload in [
            ("submit_recovery", "CON", payload),
            ("receive_recovery", "SUP", {}),
            ("start_recovery_review", "SUP", {}),
            ("accept_recovery", "SUP", {}),
        ]:
            response = self.command(
                "recovery-plans", recovery, command, actor, command_payload
            )
            self.assertEqual(response.status_code, 200, response.text)
            recovery = response.json()["record"]

        self.assertEqual(recovery["status"], "accepted_for_execution")
        self.assertNotIn("entitlement", delay["data"])
        current_baseline = self.app.state.store.engine.get(
            "InformationItem", baseline["id"]
        )
        self.assertEqual(current_baseline["status"], "effective")

        injected = self.client.post(
            f"/projects/{self.project_id}/recovery-plans/{recovery['id']}/activate-recovery",
            headers={**self.headers["CON"], "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.sessions["CON"]["actor"]["roleAssignmentId"],
                "expectedVersion": recovery["version"],
                "payload": {"effectivenessResult": "effective"},
                "evidenceIds": [],
            },
        )
        self.assertEqual(injected.status_code, 422, injected.text)
        self.assertEqual(injected.json()["code"], "SCHEMA_INVALID")

        response = self.command(
            "recovery-plans", recovery, "activate_recovery", "CON"
        )
        self.assertEqual(response.status_code, 200, response.text)
        recovery = response.json()["record"]
        response = self.command(
            "recovery-plans", recovery, "start_recovery_monitoring", "SUP"
        )
        self.assertEqual(response.status_code, 200, response.text)
        recovery = response.json()["record"]

        missing_evidence = self.command(
            "recovery-plans",
            recovery,
            "mark_recovery_effective",
            "SUP",
            {"effectivenessSummary": "forecast recovered"},
            evidence=[],
        )
        self.assertEqual(missing_evidence.status_code, 409, missing_evidence.text)
        self.assertEqual(missing_evidence.json()["code"], "EVIDENCE_REQUIRED")

        response = self.command(
            "recovery-plans",
            recovery,
            "mark_recovery_effective",
            "SUP",
            {"effectivenessSummary": "forecast recovered"},
            evidence=[self.evidence_id],
        )
        self.assertEqual(response.status_code, 200, response.text)
        recovery = response.json()["record"]
        self.assertEqual(recovery["status"], "effective")

        self.reopen()
        persisted_delay = self.app.state.store.engine.get("WorkItem", delay["id"])
        persisted_recovery = self.app.state.store.engine.get(
            "WorkItem", recovery["id"]
        )
        persisted_baseline = self.app.state.store.engine.get(
            "InformationItem", baseline["id"]
        )
        self.assertEqual(persisted_delay["status"], "notified")
        self.assertEqual(persisted_recovery["status"], "effective")
        self.assertEqual(persisted_baseline["status"], "effective")
        self.assertNotIn("entitlement", persisted_delay["data"])


if __name__ == "__main__":
    unittest.main()
