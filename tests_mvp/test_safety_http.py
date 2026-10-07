"""Backend acceptance for the Product F-03 Safety execution contract.

These tests exercise the real FastAPI + SQLite snapshot boundary. Product owns the
Safety states, commands, authorities, and derived-field rules; Backend owns durable
transaction, idempotency, HTTP exposure, and restart behavior.
"""
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


AT = "2026-10-06T10:00:00Z"


class SafetyHttpPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "state.db")
        self.app = create_app(self.path, demo=True)
        self.client = TestClient(self.app)

    def tearDown(self):
        if self.client is not None:
            self.client.close()
        if self.app is not None:
            self.app.state.store.close()
        self.temp.cleanup()

    def login(self, actor_group):
        response = self.client.post("/dev/sessions", json={"actorGroup": actor_group})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        headers = {
            "Authorization": "Bearer " + session["accessToken"],
            "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
        }
        return session, headers

    def workspace_scope(self, session, headers):
        response = self.client.get(
            f"/projects/{session['projectId']}/workspace",
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["context"]["scope"]

    def create_permit(self, *, title="Safety Permit"):
        session, headers = self.login("CON")
        scope = self.workspace_scope(session, headers)
        object_id = uid()
        key = uid()
        body = {
            "roleAssignmentId": session["actor"]["roleAssignmentId"],
            "clientObjectId": object_id,
            "payload": {
                **scope,
                "title": title,
                "data": {},
            },
        }
        response = self.client.post(
            f"/projects/{session['projectId']}/safety-permits",
            headers={**headers, "Idempotency-Key": key},
            json=body,
        )
        self.assertEqual(response.status_code, 201, response.text)
        return session["projectId"], scope, response.json()["record"]

    def force_permit_active_for_stop_prerequisite(self, permit_id):
        """Arrange an already-authorized/active permit without testing the Product flow twice."""
        store = self.app.state.store
        with store.transaction(True):
            permit = store.engine.get("WorkItem", permit_id)
            permit["status"] = "active"
            permit["data"]["workAuthorized"] = True
            store.engine._save("WorkItem", permit)
            return store.engine.get("WorkItem", permit_id)

    def stop_body(self, project_id, scope, permit_refs, *, stop_id=None):
        session, headers = self.login("SUP")
        self.assertEqual(session["projectId"], project_id)
        body = {
            "roleAssignmentId": session["actor"]["roleAssignmentId"],
            "clientObjectId": stop_id or uid(),
            "payload": {
                **scope,
                "title": "Immediate Safety Stop",
                "evidenceIds": [self.app.state.store.meta["evidenceId"]],
                "data": {
                    "stopOrderNo": "STOP-BACKEND-001",
                    "stopScopeType": "permit",
                    "stopReason": "immediate hazard",
                    "observedAt": AT,
                    "effectiveAt": AT,
                    "affectedPermitRefs": permit_refs,
                },
            },
        }
        return session, headers, body

    @staticmethod
    def ref(record):
        return {
            "objectType": "WorkItem",
            "objectId": record["id"],
            "version": record["version"],
        }

    def reopen(self):
        self.client.close()
        self.app.state.store.close()
        self.app = create_app(self.path, demo=True)
        self.client = TestClient(self.app)

    def test_safety_records_are_exposed_and_persisted(self):
        project_id, scope, permit = self.create_permit()
        self.assertEqual(permit["subtype"], "SafetyPermit")
        self.assertEqual(permit["status"], "draft")
        self.assertFalse(permit["data"]["workAuthorized"])

        sup, sup_headers = self.login("SUP")
        with self.app.state.store.transaction(True):
            equipment = self.app.state.store.engine.bootstrap(
                "Asset",
                {
                    "id": uid(),
                    "projectId": project_id,
                    "subtype": "Equipment",
                    "name": "Backend acceptance equipment",
                    "certificateRequired": False,
                    "calibrationRequired": False,
                },
            )
        equipment_id = uid()
        response = self.client.post(
            f"/projects/{project_id}/safety-equipment-inspections",
            headers={**sup_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": sup["actor"]["roleAssignmentId"],
                "clientObjectId": equipment_id,
                "payload": {
                    **scope,
                    "title": "Equipment inspection",
                    "data": {
                        "equipmentRef": {
                            "objectType": "Asset",
                            "objectId": equipment["id"],
                            "version": equipment["version"],
                        },
                        "inspectionKind": "pre-use",
                    },
                },
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        created_equipment = response.json()["record"]
        self.assertEqual(created_equipment["subtype"], "SafetyEquipmentInspection")
        self.assertEqual(created_equipment["status"], "due")
        self.assertFalse(created_equipment["data"]["equipmentAvailable"])

        self.reopen()
        _, read_headers = self.login("SUP")
        permit_read = self.client.get(
            f"/projects/{project_id}/safety-permits/{permit['id']}",
            headers=read_headers,
        )
        equipment_read = self.client.get(
            f"/projects/{project_id}/safety-equipment-inspections/{equipment_id}",
            headers=read_headers,
        )
        self.assertEqual(permit_read.status_code, 200, permit_read.text)
        self.assertEqual(equipment_read.status_code, 200, equipment_read.text)
        self.assertEqual(permit_read.json()["subtype"], "SafetyPermit")
        self.assertEqual(
            equipment_read.json()["subtype"],
            "SafetyEquipmentInspection",
        )

    def test_activate_blocks_when_latest_equipment_inspection_failed(self):
        project_id, scope, permit = self.create_permit(title="Latest equipment inspection gate")
        supervisor, headers = self.login("SUP")
        readiness = {
            "methodStatementCurrent": True,
            "riskAssessmentCurrent": True,
            "personnelQualified": True,
            "equipmentReady": True,
            "controlMeasuresReady": True,
            "emergencyReady": True,
            "environmentalConditionsReady": True,
            "noBlockingSafetyIssue": True,
        }
        with self.app.state.store.transaction(True):
            engine = self.app.state.store.engine
            equipment = engine.bootstrap(
                "Asset",
                {
                    "id": uid(),
                    "projectId": project_id,
                    "subtype": "Equipment",
                    "name": "HTTP latest-inspection equipment",
                    "certificateRequired": False,
                    "calibrationRequired": False,
                },
            )
            equipment_ref = {
                "objectType": "Asset",
                "objectId": equipment["id"],
                "version": equipment["version"],
            }
            current = engine.get("WorkItem", permit["id"])
            current["status"] = "authorized"
            current["data"].update(
                {
                    "workAuthorized": False,
                    "readiness": readiness,
                    "blockedReasons": [],
                    "validFrom": "2026-01-01T00:00:00Z",
                    "validTo": "2028-01-01T00:00:00Z",
                    "equipmentRefs": [equipment_ref],
                }
            )
            engine._save("WorkItem", current)
            for created_at, status, available in [
                ("2026-10-06T09:00:00Z", "passed", True),
                ("2026-10-06T11:00:00Z", "failed", False),
            ]:
                engine.bootstrap(
                    "WorkItem",
                    {
                        "id": uid(),
                        "projectId": project_id,
                        "createdAt": created_at,
                        "updatedAt": created_at,
                        "createdBy": uid(),
                        "subtype": "SafetyEquipmentInspection",
                        "status": status,
                        "title": status,
                        "data": {
                            "equipmentRef": equipment_ref,
                            "inspectionKind": "pre_use",
                            "equipmentAvailable": available,
                            "validTo": "2028-01-01T00:00:00Z",
                        },
                        **scope,
                    },
                )
            permit = engine.get("WorkItem", permit["id"])

        response = self.client.post(
            f"/projects/{project_id}/safety-permits/{permit['id']}/activate",
            headers={**headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": supervisor["actor"]["roleAssignmentId"],
                "expectedVersion": permit["version"],
                "payload": {"readiness": readiness, "blockedReasons": []},
                "evidenceIds": [],
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "SAFETY_WORK_AUTHORIZED")
        self.assertEqual(
            self.app.state.store.engine.get("WorkItem", permit["id"])["status"],
            "authorized",
        )

    def test_issue_stop_is_atomic_idempotent_and_survives_restart(self):
        project_id, scope, permit = self.create_permit()
        permit = self.force_permit_active_for_stop_prerequisite(permit["id"])
        session, headers, body = self.stop_body(
            project_id,
            scope,
            [self.ref(permit)],
        )
        key = uid()
        endpoint = f"/projects/{project_id}/safety-stop-orders"

        first = self.client.post(
            endpoint,
            headers={**headers, "Idempotency-Key": key},
            json=body,
        )
        self.assertEqual(first.status_code, 201, first.text)
        stop = first.json()["record"]
        affected = self.app.state.store.engine.get("WorkItem", permit["id"])
        self.assertEqual(stop["status"], "issued")
        self.assertEqual(affected["status"], "suspended")
        self.assertEqual(affected["version"], permit["version"] + 1)
        self.assertFalse(affected["data"]["workAuthorized"])
        self.assertEqual(affected["data"]["stopOrderRefs"], [self.ref(stop)])

        again = self.client.post(
            endpoint,
            headers={**headers, "Idempotency-Key": key},
            json=body,
        )
        self.assertEqual(again.status_code, 201, again.text)
        self.assertEqual(again.json(), first.json())
        replayed_affected = self.app.state.store.engine.get("WorkItem", permit["id"])
        self.assertEqual(replayed_affected["version"], affected["version"])
        self.assertEqual(replayed_affected["data"]["stopOrderRefs"], [self.ref(stop)])

        self.reopen()
        replay_session, replay_headers = self.login("SUP")
        self.assertEqual(replay_session["actor"]["partyId"], session["actor"]["partyId"])
        replay = self.client.post(
            endpoint,
            headers={**replay_headers, "Idempotency-Key": key},
            json=body,
        )
        self.assertEqual(replay.status_code, 201, replay.text)
        self.assertEqual(replay.json(), first.json())

        persisted_stop = self.app.state.store.engine.get("WorkItem", stop["id"])
        persisted_permit = self.app.state.store.engine.get("WorkItem", permit["id"])
        self.assertEqual(persisted_stop["status"], "issued")
        self.assertEqual(persisted_permit["status"], "suspended")
        self.assertEqual(persisted_permit["version"], affected["version"])
        self.assertEqual(
            persisted_permit["data"]["stopOrderRefs"],
            [self.ref(stop)],
        )

    def test_safety_command_rejects_stale_expected_version(self):
        project_id, scope, permit = self.create_permit()
        permit = self.force_permit_active_for_stop_prerequisite(permit["id"])
        _, sup_headers, stop_body = self.stop_body(
            project_id,
            scope,
            [self.ref(permit)],
        )
        created = self.client.post(
            f"/projects/{project_id}/safety-stop-orders",
            headers={**sup_headers, "Idempotency-Key": uid()},
            json=stop_body,
        )
        self.assertEqual(created.status_code, 201, created.text)
        stop = created.json()["record"]

        contractor, contractor_headers = self.login("CON")
        command_body = {
            "roleAssignmentId": contractor["actor"]["roleAssignmentId"],
            "expectedVersion": stop["version"],
            "payload": {},
            "evidenceIds": [],
        }
        first = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/acknowledge-stop",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json=command_body,
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["record"]["status"], "acknowledged")

        stale = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/acknowledge-stop",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json=command_body,
        )
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()["code"], "VERSION_CONFLICT")
        self.assertEqual(
            stale.json()["currentVersion"],
            stop["version"] + 1,
        )

    def test_stop_lift_and_permit_resume_are_separate_authorized_steps(self):
        project_id, scope, permit = self.create_permit()
        store = self.app.state.store
        readiness = {
            "methodStatementCurrent": True,
            "riskAssessmentCurrent": True,
            "personnelQualified": True,
            "equipmentReady": True,
            "controlMeasuresReady": True,
            "emergencyReady": True,
            "environmentalConditionsReady": True,
            "noBlockingSafetyIssue": True,
        }
        with store.transaction(True):
            current = store.engine.get("WorkItem", permit["id"])
            current["status"] = "active"
            current["data"].update(
                {
                    "workAuthorized": True,
                    "readiness": readiness,
                    "blockedReasons": [],
                    "validFrom": "2026-01-01T00:00:00Z",
                    "validTo": "2027-01-01T00:00:00Z",
                    "equipmentRefs": [],
                }
            )
            store.engine._save("WorkItem", current)
            permit = store.engine.get("WorkItem", permit["id"])

            action = next(
                record
                for (kind, _), record in store.engine._records.items()
                if kind == "Action"
            )
            action = store.engine.get("Action", action["id"])
            action["status"] = "closed"
            action["rootCause"] = "fall-protection gap identified"
            action["updatedAt"] = store.engine.at()
            store.engine._save("Action", action)
            action = store.engine.get("Action", action["id"])

            inspection = next(
                record
                for (kind, _), record in store.engine._records.items()
                if kind == "Inspection"
                and record.get("status") in ["passed", "completed"]
                and record.get("resultStatus") == "pass"
            )
            inspection = store.engine.get("Inspection", inspection["id"])

        _, sup_headers, stop_body = self.stop_body(
            project_id,
            scope,
            [self.ref(permit)],
        )
        created = self.client.post(
            f"/projects/{project_id}/safety-stop-orders",
            headers={**sup_headers, "Idempotency-Key": uid()},
            json=stop_body,
        )
        self.assertEqual(created.status_code, 201, created.text)
        stop = created.json()["record"]
        evidence_id = store.meta["evidenceId"]

        contractor, contractor_headers = self.login("CON")
        start_correction = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/start-correction",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": contractor["actor"]["roleAssignmentId"],
                "expectedVersion": stop["version"],
                "payload": {
                    "correctiveActionRefs": [{
                        "objectType": "Action",
                        "objectId": action["id"],
                        "version": action["version"],
                    }],
                },
                "evidenceIds": [],
            },
        )
        self.assertEqual(start_correction.status_code, 200, start_correction.text)
        stop = start_correction.json()["record"]

        missing_resume_evidence = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/request-resume",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": contractor["actor"]["roleAssignmentId"],
                "expectedVersion": stop["version"],
                "payload": {},
                "evidenceIds": [],
            },
        )
        self.assertEqual(
            missing_resume_evidence.status_code, 409, missing_resume_evidence.text
        )
        self.assertEqual(missing_resume_evidence.json()["code"], "EVIDENCE_REQUIRED")

        request_resume = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/request-resume",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": contractor["actor"]["roleAssignmentId"],
                "expectedVersion": stop["version"],
                "payload": {},
                "evidenceIds": [evidence_id],
            },
        )
        self.assertEqual(request_resume.status_code, 200, request_resume.text)
        stop = request_resume.json()["record"]

        supervisor, supervisor_headers = self.login("SUP")
        verify_resume = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/start-resume-verification",
            headers={**supervisor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": supervisor["actor"]["roleAssignmentId"],
                "expectedVersion": stop["version"],
                "payload": {
                    "resumeVerificationRefs": [{
                        "objectType": "Inspection",
                        "objectId": inspection["id"],
                        "version": inspection["version"],
                    }],
                },
                "evidenceIds": [],
            },
        )
        self.assertEqual(verify_resume.status_code, 200, verify_resume.text)
        stop = verify_resume.json()["record"]

        lift = self.client.post(
            f"/projects/{project_id}/safety-stop-orders/{stop['id']}/lift-stop",
            headers={**supervisor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": supervisor["actor"]["roleAssignmentId"],
                "expectedVersion": stop["version"],
                "payload": {},
                "evidenceIds": [evidence_id],
            },
        )
        self.assertEqual(lift.status_code, 200, lift.text)
        stop = lift.json()["record"]
        self.assertEqual(stop["status"], "lifted")
        self.assertTrue(all(stop["data"]["resumeGate"].values()))

        permit_after_lift = store.engine.get("WorkItem", permit["id"])
        self.assertEqual(permit_after_lift["status"], "suspended")
        self.assertFalse(permit_after_lift["data"]["workAuthorized"])

        permit_resume_request = self.client.post(
            f"/projects/{project_id}/safety-permits/{permit['id']}/request-resume",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": contractor["actor"]["roleAssignmentId"],
                "expectedVersion": permit_after_lift["version"],
                "payload": {"readiness": readiness, "blockedReasons": []},
                "evidenceIds": [evidence_id],
            },
        )
        self.assertEqual(
            permit_resume_request.status_code,
            200,
            permit_resume_request.text,
        )
        permit_resume_review = permit_resume_request.json()["record"]
        self.assertEqual(permit_resume_review["status"], "resume_review")
        self.assertFalse(permit_resume_review["data"]["workAuthorized"])

        contractor_self_resume = self.client.post(
            f"/projects/{project_id}/safety-permits/{permit['id']}/approve-resume",
            headers={**contractor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": contractor["actor"]["roleAssignmentId"],
                "expectedVersion": permit_resume_review["version"],
                "payload": {"readiness": readiness},
                "evidenceIds": [evidence_id],
            },
        )
        self.assertEqual(contractor_self_resume.status_code, 403, contractor_self_resume.text)
        self.assertEqual(contractor_self_resume.json()["code"], "NOT_AUTHORIZED")

        approved = self.client.post(
            f"/projects/{project_id}/safety-permits/{permit['id']}/approve-resume",
            headers={**supervisor_headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": supervisor["actor"]["roleAssignmentId"],
                "expectedVersion": permit_resume_review["version"],
                "payload": {"readiness": readiness},
                "evidenceIds": [evidence_id],
            },
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        resumed = approved.json()["record"]
        self.assertEqual(resumed["status"], "active")
        self.assertTrue(resumed["data"]["workAuthorized"])

        self.reopen()
        persisted_stop = self.app.state.store.engine.get("WorkItem", stop["id"])
        persisted_permit = self.app.state.store.engine.get("WorkItem", permit["id"])
        self.assertEqual(persisted_stop["status"], "lifted")
        self.assertEqual(persisted_permit["status"], "active")
        self.assertTrue(persisted_permit["data"]["workAuthorized"])

    def test_stale_affected_permit_rolls_back_entire_stop_package(self):
        project_id, scope, first = self.create_permit(title="Permit A")
        _, _, second = self.create_permit(title="Permit B")
        first = self.force_permit_active_for_stop_prerequisite(first["id"])
        second = self.force_permit_active_for_stop_prerequisite(second["id"])
        stale_second_ref = self.ref(second)

        store = self.app.state.store
        with store.transaction(True):
            current = store.engine.get("WorkItem", second["id"])
            current["version"] += 1
            current["updatedAt"] = store.engine.at()
            store.engine._save("WorkItem", current)

        first_before = store.engine.get("WorkItem", first["id"])
        stop_id = uid()
        _, headers, body = self.stop_body(
            project_id,
            scope,
            [self.ref(first), stale_second_ref],
            stop_id=stop_id,
        )
        response = self.client.post(
            f"/projects/{project_id}/safety-stop-orders",
            headers={**headers, "Idempotency-Key": uid()},
            json=body,
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "REFERENCE_STALE")
        self.assertEqual(store.engine.get("WorkItem", first["id"]), first_before)
        self.assertNotIn(("WorkItem", stop_id), store.engine._records)

        self.reopen()
        persisted_first = self.app.state.store.engine.get("WorkItem", first["id"])
        self.assertEqual(persisted_first, first_before)
        self.assertNotIn(("WorkItem", stop_id), self.app.state.store.engine._records)

    def test_server_derived_safety_fields_are_not_client_writable(self):
        session, headers = self.login("CON")
        scope = self.workspace_scope(session, headers)
        response = self.client.post(
            f"/projects/{session['projectId']}/safety-permits",
            headers={**headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": session["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": {
                    **scope,
                    "title": "Injected permit",
                    "data": {"workAuthorized": True},
                },
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["code"], "IMMUTABLE_FIELD")


if __name__ == "__main__":
    unittest.main()
