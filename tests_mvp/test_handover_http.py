"""HTTP acceptance for F-07 commissioning, Owner handover and warranty.

Only the trusted Requirement profiles and already accepted upstream fixtures are
seeded through the store. Every F-07 WorkItem create/transition is sent through
the production HTTP command route. Retest evidence is uploaded through the HTTP
evidence endpoint.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


BEFORE = "2026-01-01T00:00:00Z"


class HandoverHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(str(Path(self.temp.name) / "handover.db"), demo=True)
        self.client = TestClient(self.app)
        self.store = self.app.state.store
        self._set_up_handover_fixture()

    def _set_up_handover_fixture(self):
        self.engine = self.store.engine
        self.project = self.store.meta["projectId"]
        self.scope = deepcopy(self.store.meta["scope"])
        self.now = self.engine.at()
        moment = datetime.fromisoformat(self.now.replace("Z", "+00:00"))
        self.tomorrow = (moment + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        self.requirement_id = self.store.meta["requirementRef"]["objectId"]
        self.drawing_id = self.store.meta["drawingRef"]["objectId"]
        self.evidence_id = self.store.meta["evidenceId"]
        self._seed_trusted_completion_configuration()

    def tearDown(self):
        self.client.close()
        self.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        self.session = response.json()
        self.role = self.session["actor"]["roleAssignmentId"]
        self.headers = {
            "Authorization": "Bearer " + self.session["accessToken"],
            "X-Role-Assignment-Id": self.role,
        }

    def ref(self, object_type, object_id):
        record = self.engine.get(object_type, object_id)
        return {"objectType": object_type, "objectId": object_id, "version": record["version"]}

    def create(self, collection, payload, actor):
        self.login(actor)
        response = self.client.post(
            f"/projects/{self.project}/{collection}",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={"roleAssignmentId": self.role, "clientObjectId": uid(), "payload": payload},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def command(self, collection, record, command, payload=None, *, actor, evidence=None, key=None, version=None):
        self.login(actor)
        response = self.client.post(
            f"/projects/{self.project}/{collection}/{record['id']}/{command.replace('_', '-')}",
            headers={**self.headers, "Idempotency-Key": key or uid()},
            json={
                "roleAssignmentId": self.role,
                "expectedVersion": record["version"] if version is None else version,
                "payload": payload or {},
                "evidenceIds": [self.evidence_id] if evidence is None else evidence,
            },
        )
        return response

    def expect(self, collection, record, command, payload=None, *, actor, evidence=None):
        response = self.command(collection, record, command, payload, actor=actor, evidence=evidence)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["record"]

    def _seed_trusted_completion_configuration(self):
        self.login("SUP")
        self.commissioning_profile_id = uid()
        self.handover_profile_id = uid()
        self.warranty_period_id = uid()
        now = self.now
        common = {
            "effectiveFrom": BEFORE,
            "status": "active",
            **self.scope,
        }
        with self.store.transaction(True):
            self.engine.bootstrap("Requirement", {
                "id": self.commissioning_profile_id,
                "projectId": self.project,
                "kind": "contract",
                "title": "F-07 commissioning profile fixture",
                "applicability": {"commissioningProfile": {
                    "requiredPrecommissioningItemIds": ["P-01"],
                    "requiredTestProcedureRefs": [],
                    "requiredIntegratedTestRefs": [],
                    "requiresMaterialReadiness": False,
                    "requiresEquipmentReadiness": False,
                    "requiresCalibration": False,
                    "requiresUtilities": False,
                    "requiresSafetyPermit": False,
                    "requiresTestWitness": False,
                }},
                **common,
            })
            self.engine.bootstrap("Requirement", {
                "id": self.handover_profile_id,
                "projectId": self.project,
                "kind": "contract",
                "title": "F-07 handover profile fixture",
                "applicability": {"handoverProfile": {
                    "requiredDocumentSets": ["asBuilt", "omManual", "training", "spareParts", "certificates", "statutoryAcceptance"],
                    "requiredCommissioningPackageRefs": [],
                    "warrantyTriggerOnPartialHandover": True,
                    "warrantyTriggerOnFinalHandover": True,
                    "warrantyPeriodStartAt": now,
                }},
                **common,
            })
            self.engine.bootstrap("Requirement", {
                "id": self.warranty_period_id,
                "projectId": self.project,
                "kind": "contract",
                "title": "F-07 warranty period fixture",
                "applicability": {"warrantyPeriod": {
                    "startsAt": now,
                    "endsAt": "2027-10-04T12:00:00Z",
                    "responseDueHours": 48,
                    "closeAuthorityActorGroup": "SUP",
                }},
                **common,
            })
            drawing = self.engine.get("InformationItem", self.drawing_id)
            self.procedure_id = uid()
            procedure = deepcopy(drawing)
            procedure.update(id=self.procedure_id, version=1, subtype="MethodStatement", title="Approved system test procedure", status="approved")
            self.engine.bootstrap("InformationItem", procedure)
            self.document_ids = {}
            for key, subtype in {
                "asBuilt": "GeneralDocument",
                "omManual": "Manual",
                "training": "MeetingRecord",
                "spareParts": "GeneralDocument",
                "certificates": "Certificate",
                "statutoryAcceptance": "Certificate",
                "closure": "GeneralDocument",
            }.items():
                item_id = uid()
                item = deepcopy(drawing)
                item.update(id=item_id, version=1, subtype=subtype, title=f"Accepted {key} fixture", status="approved")
                self.engine.bootstrap("InformationItem", item)
                self.document_ids[key] = item_id
            self.asset_ids = []
            for index in range(2):
                asset_id = uid()
                self.engine.bootstrap("Asset", {
                    "id": asset_id,
                    "projectId": self.project,
                    "version": 1,
                    "createdAt": now,
                    "updatedAt": now,
                    "createdBy": self.session["actor"]["partyId"],
                    "subtype": "System",
                    "name": f"System asset {index + 1}",
                    **self.scope,
                })
                self.asset_ids.append(asset_id)
            inspection = next(
                r for (kind, _), r in self.engine._records.items()
                if kind == "Inspection" and r.get("status") == "passed"
            )
            self.inspection_id = uid()
            prerequisite = deepcopy(inspection)
            prerequisite.update(id=self.inspection_id, version=1, status="passed", resultStatus="pass", nextWorkAllowed=True, holdPoint=False)
            self.engine.bootstrap("Inspection", prerequisite)

    def _commissioning_payload(self, *, punch_refs=None):
        return {
            **self.scope,
            "subtype": "CommissioningPackage",
            "title": "System commissioning package",
            "requirementRefs": [self.ref("Requirement", self.requirement_id)],
            "drawingRef": self.ref("InformationItem", self.drawing_id),
            "data": {
                "commissioningNo": "CP-HTTP-001",
                "system": "SYS-A",
                "commissioningProfileRef": self.ref("Requirement", self.commissioning_profile_id),
                "prerequisiteInspectionRefs": [self.ref("Inspection", self.inspection_id)],
                "precommissioningChecklist": [],
                "testProcedureRefs": [self.ref("InformationItem", self.procedure_id)],
                "integratedTestRefs": [],
                "materialReadinessRefs": [],
                "equipmentReadinessRefs": [],
                "calibrationRefs": [],
                "utilityReadinessRefs": [],
                "safetyPermitRefs": [],
                "testWitnessPartyIds": [],
                "punchIssueRefs": punch_refs or [],
                "correctionActionRefs": [],
            },
        }

    def _new_punch_and_action(self):
        old_issue = next(r for (kind, _), r in self.engine._records.items() if kind == "Issue")
        issue_id, action_id = uid(), uid()
        issue = deepcopy(old_issue)
        issue.update(id=issue_id, version=1, status="open", subtype="Punch", actionIds=[action_id], **self.scope)
        action = deepcopy(next(r for (kind, _), r in self.engine._records.items() if kind == "Action"))
        action.update(id=action_id, version=1, status="verified", relatedIssueId=issue_id, **self.scope)
        with self.store.transaction(True):
            self.engine.bootstrap("Issue", issue)
            self.engine.bootstrap("Action", action)
        return self.ref("Issue", issue_id), self.ref("Action", action_id)

    def _close_issue_via_http(self, issue_ref, action_ref):
        issue = self.engine.get("Issue", issue_ref["objectId"])
        action = self.engine.get("Action", action_ref["objectId"])
        with self.store.transaction(True):
            self.engine._record_machines[("Issue", issue["id"])] = "issue"
        if issue["status"] == "open":
            issue = self.expect("issues", issue, "assign", {
                "responsiblePartyId": issue["responsiblePartyId"],
                "responsibleOrganizationId": issue["responsibleOrganizationId"],
                "dueAt": self.tomorrow,
                "actionIds": issue["actionIds"],
            }, actor="SUP", evidence=[])
        self.assertEqual(issue["status"], "assigned")
        issue = self.expect("issues", issue, "start_correction", actor="CON", evidence=[])
        previous = self.engine.get("Inspection", issue["inspectionIds"][-1])
        inspection_id = uid()
        inspection = deepcopy(previous)
        inspection.update(
            id=inspection_id, version=1, previousInspectionId=previous["id"],
            relatedIssueId=issue["id"], correctionCycle=issue["correctionCycle"],
            status="completed", resultStatus="pass", nextWorkAllowed=True,
            correctiveActionRefs=[action_ref], evidenceIds=list(action.get("evidenceIds", [])),
        )
        with self.store.transaction(True):
            self.engine.bootstrap("Inspection", inspection)
        issue = self.expect("issues", issue, "request_reinspection", {
            "inspectionIds": issue["inspectionIds"] + [inspection_id],
        }, actor="CON", evidence=action.get("evidenceIds", []))
        issue = self.expect("issues", issue, "start_reinspection", actor="SUP", evidence=[])
        closure_evidence = list(dict.fromkeys(action.get("evidenceIds", []) + inspection.get("evidenceIds", [])))
        return self.expect("issues", issue, "close", {
            "closureEvidenceIds": closure_evidence,
        }, actor="SUP", evidence=closure_evidence)

    def upload_test_evidence(self, label):
        self.login("CON")
        content = f"%PDF-1.4\nDOUL immutable test result {label}\n".encode()
        capture_id = uid()
        digest = sha256(content).hexdigest()
        upload = self.client.post(
            f"/projects/{self.project}/uploads",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.role,
                "captureId": capture_id,
                "fileName": f"test-result-{label}.pdf",
                "mimeType": "application/pdf",
                "byteCount": len(content),
                "expectedHash": digest,
                "sourcePartyId": self.session["actor"]["partyId"],
                "mediaType": "document",
                "discipline": self.scope["discipline"],
                "packageId": self.scope["packageId"],
                "locationId": self.scope["locationId"],
            },
        )
        self.assertEqual(upload.status_code, 201, upload.text)
        upload_id = upload.json()["id"]
        chunk = self.client.put(
            f"/projects/{self.project}/uploads/{upload_id}/chunks",
            headers={**self.headers, "Idempotency-Key": uid(), "Upload-Offset": "0"},
            content=content,
        )
        self.assertEqual(chunk.status_code, 200, chunk.text)
        complete = self.client.post(
            f"/projects/{self.project}/uploads/{upload_id}/complete",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={"roleAssignmentId": self.role, "expectedHash": digest},
        )
        self.assertEqual(complete.status_code, 201, complete.text)
        return complete.json()

    def _pass_commissioning(self):
        package = self.create("commissioning-packages", self._commissioning_payload(), "CON")
        package = self.expect("commissioning-packages", package, "start_prerequisite_review", actor="SUP", evidence=[])
        package = self.expect("commissioning-packages", package, "start_precommissioning", actor="SUP", evidence=[])
        package = self.expect(
            "commissioning-packages", package, "declare_test_ready",
            {"precommissioningChecklist": [{"itemId": "P-01", "completed": True, "evidenceIds": [self.evidence_id]}]},
            actor="SUP", evidence=[],
        )
        package = self.expect("commissioning-packages", package, "start_test", actor="SUP", evidence=[self.evidence_id])
        package = self.expect(
            "commissioning-packages", package, "submit_test_result",
            {"testResultRef": self.ref("Evidence", self.evidence_id), "outcome": "pass", "acceptanceCriteriaMet": True},
            actor="CON", evidence=[self.evidence_id],
        )
        denied = self.command("commissioning-packages", package, "accept_test", actor="CON", evidence=[self.evidence_id])
        self.assertEqual(denied.status_code, 403, denied.text)
        package = self.expect("commissioning-packages", package, "accept_test", actor="SUP", evidence=[self.evidence_id])
        package = self.expect("commissioning-packages", package, "mark_ready_for_handover", actor="SUP", evidence=[self.evidence_id])
        package = self.expect("commissioning-packages", package, "close_commissioning", actor="SUP", evidence=[])
        return package

    def test_expired_witness_assignment_cannot_authorize_commissioning_test(self):
        profile = deepcopy(self.engine.get("Requirement", self.commissioning_profile_id))
        profile_id = uid()
        profile["id"] = profile_id
        profile["version"] = 1
        profile["applicability"]["commissioningProfile"]["requiresTestWitness"] = True
        with self.store.transaction(True):
            self.engine.bootstrap("Requirement", profile)

        supervisor = self.store.meta["actors"]["SUP"]["partyId"]
        source_assignment = next(
            value for (kind, _), value in self.engine._records.items()
            if kind == "RoleAssignment" and value.get("partyId") == supervisor and value.get("active")
        )
        witness_id = uid()
        witness = deepcopy(self.engine.get("Party", supervisor))
        witness["id"] = witness_id
        expired_assignment = deepcopy(source_assignment)
        expired_assignment.update(id=uid(), partyId=witness_id, validFrom=BEFORE, validTo=BEFORE)
        with self.store.transaction(True):
            self.engine.bootstrap("Party", witness)
            self.engine.bootstrap("RoleAssignment", expired_assignment)

        payload = self._commissioning_payload()
        payload["data"]["commissioningProfileRef"] = self.ref("Requirement", profile_id)
        payload["data"]["testWitnessPartyIds"] = [witness_id]
        payload["minimumQualificationRank"] = 1
        package = self.create("commissioning-packages", payload, "CON")
        package = self.expect("commissioning-packages", package, "start_prerequisite_review", actor="SUP", evidence=[])
        package = self.expect("commissioning-packages", package, "start_precommissioning", actor="SUP", evidence=[])
        package = self.expect(
            "commissioning-packages", package, "declare_test_ready",
            {"precommissioningChecklist": [{"itemId": "P-01", "completed": True, "evidenceIds": [self.evidence_id]}]},
            actor="SUP", evidence=[],
        )
        rejected = self.command("commissioning-packages", package, "start_test", actor="SUP", evidence=[self.evidence_id])
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(rejected.json()["code"], "COMMISSIONING_WITNESS_REQUIRED")
        self.assertEqual(self.engine.get("WorkItem", package["id"])["version"], package["version"])

        qualification = deepcopy(next(value for (kind, _), value in self.engine._records.items() if kind == "Qualification"))
        qualification_id = uid()
        qualification.update(id=qualification_id, partyId=witness_id, rank=3, verified=True, revoked=False)
        assignment = self.engine.get("RoleAssignment", expired_assignment["id"])
        assignment.update(version=assignment["version"] + 1, validTo=self.tomorrow, qualificationIds=[qualification_id])
        with self.store.transaction(True):
            self.engine.bootstrap("Qualification", qualification)
            self.engine._save("RoleAssignment", assignment)
        insufficient = self.command("commissioning-packages", package, "start_test", actor="SUP", evidence=[self.evidence_id])
        self.assertEqual(insufficient.status_code, 403, insufficient.text)
        self.assertEqual(insufficient.json()["code"], "QUALIFICATION_INVALID")

        qualification = self.engine.get("Qualification", qualification_id)
        qualification.update(version=qualification["version"] + 1, rank=1, revoked=True)
        with self.store.transaction(True):
            self.engine._save("Qualification", qualification)
        revoked = self.command("commissioning-packages", package, "start_test", actor="SUP", evidence=[self.evidence_id])
        self.assertEqual(revoked.status_code, 403, revoked.text)
        self.assertEqual(revoked.json()["code"], "QUALIFICATION_INVALID")
        self.assertEqual(self.engine.get("WorkItem", package["id"])["version"], package["version"])

    def test_expired_equipment_certificate_blocks_commissioning_prerequisites(self):
        profile = deepcopy(self.engine.get("Requirement", self.commissioning_profile_id))
        profile_id = uid()
        profile.update(id=profile_id, version=1)
        profile["applicability"]["commissioningProfile"]["requiresEquipmentReadiness"] = True
        with self.store.transaction(True):
            self.engine.bootstrap("Requirement", profile)

        equipment_id = uid()
        equipment = deepcopy(self.engine.get("Asset", self.asset_ids[0]))
        equipment.update(id=equipment_id, version=1, subtype="Equipment", certificateRequired=True, calibrationRequired=False)
        expired_certificate_id = uid()
        certificate = deepcopy(self.engine.get("InformationItem", self.document_ids["certificates"]))
        certificate.update(id=expired_certificate_id, version=1, subtype="Certificate", status="approved", certificateKind="safety", validFrom=BEFORE, validTo=BEFORE)
        inspection_id = uid()
        inspection = {
            "id": inspection_id, "projectId": self.project, "version": 1,
            "createdAt": self.now, "updatedAt": self.now,
            "createdBy": self.store.meta["actors"]["CON"]["partyId"],
            "subtype": "SafetyEquipmentInspection", "status": "passed",
            "title": "Expired equipment certificate fixture", **self.scope,
            "data": {
            "validFrom": BEFORE, "validTo": self.tomorrow,
            "inspectionKind": "current_certificate_review",
            "equipmentRef": {"objectType": "Asset", "objectId": equipment_id, "version": 1},
            "certificateRefs": [{"objectType": "InformationItem", "objectId": expired_certificate_id, "version": 1}],
            "calibrationRefs": [], "equipmentAvailable": True,
            },
        }
        with self.store.transaction(True):
            self.engine.bootstrap("Asset", equipment)
            self.engine.bootstrap("InformationItem", certificate)
            self.engine.bootstrap("WorkItem", inspection)

        payload = self._commissioning_payload()
        payload["data"]["commissioningProfileRef"] = self.ref("Requirement", profile_id)
        payload["data"]["equipmentReadinessRefs"] = [self.ref("WorkItem", inspection_id)]
        package = self.create("commissioning-packages", payload, "CON")
        package = self.expect("commissioning-packages", package, "start_prerequisite_review", actor="SUP", evidence=[])
        rejected = self.command("commissioning-packages", package, "start_precommissioning", actor="SUP", evidence=[])
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(rejected.json()["code"], "COMMISSIONING_EQUIPMENT_NOT_READY")
        self.assertEqual(self.engine.get("WorkItem", package["id"])["version"], package["version"])

    def test_failed_test_is_preserved_and_retest_uses_new_uploaded_evidence(self):
        issue_ref, action_ref = self._new_punch_and_action()
        package = self.create("commissioning-packages", self._commissioning_payload(punch_refs=[issue_ref]), "CON")
        package = self.expect("commissioning-packages", package, "start_prerequisite_review", actor="SUP", evidence=[])
        package = self.expect("commissioning-packages", package, "start_precommissioning", actor="SUP", evidence=[])
        package = self.expect(
            "commissioning-packages", package, "declare_test_ready",
            {"precommissioningChecklist": [{"itemId": "P-01", "completed": True, "evidenceIds": [self.evidence_id]}]},
            actor="SUP", evidence=[],
        )
        package = self.expect("commissioning-packages", package, "start_test", actor="SUP", evidence=[self.evidence_id])
        first_ref = self.ref("Evidence", self.evidence_id)
        package = self.expect(
            "commissioning-packages", package, "submit_test_result",
            {"testResultRef": first_ref, "outcome": "fail", "acceptanceCriteriaMet": False, "failureReason": "Initial result outside tolerance"},
            actor="CON", evidence=[self.evidence_id],
        )
        history_before = deepcopy(package["data"]["testResultHistory"])
        forged_history = self.command(
            "commissioning-packages", package, "reject_test",
            {"failureReason": "Supervisor confirmed test failure", "testResultHistory": []},
            actor="SUP", evidence=[self.evidence_id],
        )
        self.assertEqual(forged_history.status_code, 422, forged_history.text)
        self.assertEqual(self.engine.get("WorkItem", package["id"])["data"]["testResultHistory"], history_before)
        package = self.expect(
            "commissioning-packages", package, "reject_test",
            {"failureReason": "Supervisor confirmed test failure"}, actor="SUP", evidence=[self.evidence_id],
        )
        self.assertEqual(package["data"]["testResultHistory"][0]["outcome"], "fail")
        package = self.expect(
            "commissioning-packages", package, "require_punch_resolution",
            {"punchIssueRefs": [issue_ref], "correctionActionRefs": [action_ref]}, actor="SUP", evidence=[],
        )
        retest = self.upload_test_evidence("retest")
        package = self.expect(
            "commissioning-packages", package, "request_retest", {"retestBasisRefs": [action_ref]},
            actor="CON", evidence=[retest["id"]],
        )
        second_ref = self.ref("Evidence", retest["id"])
        package = self.expect(
            "commissioning-packages", package, "start_test", actor="SUP", evidence=[retest["id"]],
        )
        package = self.expect(
            "commissioning-packages", package, "submit_test_result",
            {"testResultRef": second_ref, "outcome": "pass", "acceptanceCriteriaMet": True},
            actor="CON", evidence=[retest["id"]],
        )
        history = package["data"]["testResultHistory"]
        self.assertEqual([entry["outcome"] for entry in history], ["fail", "pass"])
        self.assertEqual([entry["testCycle"] for entry in history], [1, 2])
        self.assertEqual(history[0]["testResultRef"], first_ref)
        self.assertEqual(history[1]["testResultRef"], second_ref)
        self.assertEqual(package["data"]["testResultRefs"], [first_ref, second_ref])
        package = self.expect("commissioning-packages", package, "accept_test", actor="SUP", evidence=[retest["id"]])
        self.assertEqual(package["status"], "passed")

    def test_readiness_refuses_a_stale_punch_snapshot_without_refresh_input(self):
        punch_ref, action_ref = self._new_punch_and_action()
        package = self.create("commissioning-packages", self._commissioning_payload(punch_refs=[punch_ref]), "CON")
        package = self.expect("commissioning-packages", package, "start_prerequisite_review", actor="SUP", evidence=[])
        package = self.expect("commissioning-packages", package, "start_precommissioning", actor="SUP", evidence=[])
        package = self.expect(
            "commissioning-packages", package, "declare_test_ready",
            {"precommissioningChecklist": [{"itemId": "P-01", "completed": True, "evidenceIds": [self.evidence_id]}]},
            actor="SUP", evidence=[],
        )
        package = self.expect("commissioning-packages", package, "start_test", actor="SUP", evidence=[self.evidence_id])
        package = self.expect(
            "commissioning-packages", package, "submit_test_result",
            {"testResultRef": self.ref("Evidence", self.evidence_id), "outcome": "pass", "acceptanceCriteriaMet": True},
            actor="CON", evidence=[self.evidence_id],
        )
        package = self.expect("commissioning-packages", package, "accept_test", actor="SUP", evidence=[self.evidence_id])

        # Advance the Issue through its authorized HTTP assignment command;
        # this baseline command has no Punch-ref refresh input.
        punch = self.engine.get("Issue", punch_ref["objectId"])
        with self.store.transaction(True):
            self.engine._record_machines[("Issue", punch["id"])] = "issue"
        punch = self.expect("issues", punch, "assign", {
            "responsiblePartyId": punch["responsiblePartyId"],
            "responsibleOrganizationId": punch["responsibleOrganizationId"],
            "dueAt": self.tomorrow,
            "actionIds": punch["actionIds"],
        }, actor="SUP", evidence=[])

        audit_before = len(self.engine._audit)
        rejected = self.command(
            "commissioning-packages", package, "mark_ready_for_handover",
            actor="SUP", evidence=[self.evidence_id],
        )
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(rejected.json()["code"], "REFERENCE_STALE")
        current = self.engine.get("WorkItem", package["id"])
        self.assertEqual(current["version"], package["version"])
        self.assertEqual(current["data"]["punchIssueRefs"], [punch_ref])
        self.assertEqual(len(self.engine._audit), audit_before)

        # Resolve the Issue through its HTTP correction/reinspection/close
        # lifecycle, then explicitly refresh the same identity set.
        closed_issue = self._close_issue_via_http(punch_ref, action_ref)
        current_issue_ref = self.ref("Issue", closed_issue["id"])
        before_audit = len(self.engine._audit)
        package = self.expect("commissioning-packages", package, "mark_ready_for_handover", {
            "punchIssueRefs": [current_issue_ref],
            "correctionActionRefs": [action_ref],
        }, actor="SUP", evidence=[self.evidence_id])
        self.assertEqual(package["status"], "ready_for_handover")
        self.assertEqual(package["data"]["punchIssueRefs"], [punch_ref])
        self.assertEqual(package["data"]["currentPunchIssueRefs"], [current_issue_ref])
        self.assertEqual(package["data"]["currentCorrectionActionRefs"], [action_ref])
        self.assertEqual(len(package["data"]["punchReferenceRefreshHistory"]), 1)
        self.assertEqual(len(self.engine._audit), before_audit + 1)

    def test_handover_refresh_preserves_owner_reservation_through_final_handover(self):
        commissioning = self._pass_commissioning()
        issue_ref, action_ref = self._new_punch_and_action()
        assets = [self.ref("Asset", asset_id) for asset_id in self.asset_ids]
        scope = {"scopeId": "SYS-A-REFRESH", "system": "SYS-A",
                 "locationIds": [self.scope["locationId"]], "assetRefs": assets}
        handover_data = {
            "handoverNo": "HP-REFRESH-001", "handoverScope": scope,
            "handoverProfileRef": self.ref("Requirement", self.handover_profile_id),
            "commissioningPackageRefs": [self.ref("WorkItem", commissioning["id"])],
            "asBuiltRefs": [self.ref("InformationItem", self.document_ids["asBuilt"])],
            "omManualRefs": [self.ref("InformationItem", self.document_ids["omManual"])],
            "trainingRefs": [self.ref("InformationItem", self.document_ids["training"])],
            "sparePartsRefs": [self.ref("InformationItem", self.document_ids["spareParts"])],
            "certificateRefs": [self.ref("InformationItem", self.document_ids["certificates"])],
            "statutoryAcceptanceRefs": [self.ref("InformationItem", self.document_ids["statutoryAcceptance"])],
            "openIssueRefs": [issue_ref],
            "reservationProposals": [{
                "issueRef": issue_ref,
                "ownerPartyId": self.store.meta["actors"]["OWN"]["partyId"],
                "dueAt": self.tomorrow,
                "closureRequirement": "Close and verify the Punch Issue before final handover",
            }],
        }
        handover = self.create("handover-packages", {
            **self.scope, "subtype": "HandoverPackage",
            "title": "Handover with a tracked Punch reservation",
            "requirementRefs": [self.ref("Requirement", self.requirement_id)],
            "drawingRef": self.ref("InformationItem", self.drawing_id),
            "data": handover_data,
        }, "CON")
        handover = self.expect("handover-packages", handover, "submit_handover_package", actor="CON", evidence=[])
        handover = self.expect("handover-packages", handover, "start_readiness_review", actor="SUP", evidence=[])
        handover = self.expect("handover-packages", handover, "submit_owner_review", actor="SUP", evidence=[self.evidence_id])
        decision = self._owner_decision(handover, "Conditional acceptance with tracked Punch reservation")
        handover = self.expect("handover-packages", handover, "accept_with_reservations", {
            "ownerDecisionRef": decision,
            "ownerReservationInputs": handover_data["reservationProposals"],
        }, actor="OWN", evidence=[self.evidence_id])
        reservation_snapshot = deepcopy(handover["data"]["reservations"])
        owner_acceptance_snapshot = deepcopy(handover["data"]["ownerAcceptanceRef"])

        closed_issue = self._close_issue_via_http(issue_ref, action_ref)
        latest_issue_ref = self.ref("Issue", closed_issue["id"])
        stale_final = self.command("handover-packages", handover, "record_final_handover", {
            "effectiveAt": self.now, "warrantyTrigger": True,
        }, actor="OWN", evidence=[self.evidence_id])
        self.assertEqual(stale_final.status_code, 409, stale_final.text)
        self.assertEqual(stale_final.json()["code"], "REFERENCE_STALE")
        self.assertEqual(self.engine.get("WorkItem", handover["id"])["version"], handover["version"])

        malformed = self.command("handover-packages", handover, "refresh_issue_references", {
            "currentIssueRefs": [{"objectType": "Issue", "objectId": [], "version": True}],
        }, actor="SUP", evidence=[])
        self.assertNotEqual(malformed.status_code, 500, malformed.text)
        self.assertEqual(self.engine.get("WorkItem", handover["id"])["version"], handover["version"])

        denied = self.command("handover-packages", handover, "refresh_issue_references", {
            "currentIssueRefs": [latest_issue_ref],
        }, actor="CON", evidence=[])
        self.assertEqual(denied.status_code, 403, denied.text)
        handover = self.expect("handover-packages", handover, "refresh_issue_references", {
            "currentIssueRefs": [latest_issue_ref],
        }, actor="SUP", evidence=[])
        self.assertEqual(handover["data"]["openIssueRefs"], [issue_ref])
        self.assertEqual(handover["data"]["currentIssueRefs"], [latest_issue_ref])
        self.assertEqual(handover["data"]["currentOpenIssueRefs"], [])
        self.assertEqual(handover["data"]["reservations"], reservation_snapshot)
        self.assertEqual(handover["data"]["ownerAcceptanceRef"], owner_acceptance_snapshot)
        self.assertEqual(len(handover["data"]["issueReferenceRefreshHistory"]), 1)

        handover = self.expect("handover-packages", handover, "record_final_handover", {
            "effectiveAt": self.now, "warrantyTrigger": True,
        }, actor="OWN", evidence=[self.evidence_id])
        self.assertEqual(handover["status"], "final_handover")
        self.assertEqual(handover["data"]["reservations"], reservation_snapshot)
        handover = self.expect("handover-packages", handover, "close_handover_package", actor="SUP", evidence=[])
        self.assertEqual(handover["status"], "closed")

    def _owner_decision(self, target, title):
        decision_id = uid()
        with self.store.transaction(True):
            self.engine.bootstrap("Decision", {
                "id": decision_id,
                "projectId": self.project,
                "status": "decided",
                "title": title,
                "targetRef": {"objectType": "WorkItem", "objectId": target["id"], "version": target["version"]},
                "options": [{"id": "A"}],
                "impact": {"scope": "handover"},
                "recommendation": "approved",
                "actionIds": [],
                "decision": "approved",
                "decisionReason": title,
                "decisionAt": self.now,
                **self.scope,
            })
        return self.ref("Decision", decision_id)

    def test_owner_partial_handover_reservation_and_warranty_close_http(self):
        commissioning = self._pass_commissioning()
        issue_ref, action_ref = self._new_punch_and_action()
        reservation_action_id = action_ref["objectId"]
        reservation_action = self.engine.get("Action", reservation_action_id)
        reservation_action.update(version=reservation_action["version"] + 1, updatedAt=self.engine.at())
        with self.store.transaction(True):
            self.engine._save("Action", reservation_action)
        # Add the Warranty remedy Action before the claim captures its defect
        # Issue reference; the next Issue version remains a current snapshot.
        action_id = uid()
        action = deepcopy(reservation_action)
        action.update(id=action_id, version=1, status="assigned", updatedAt=self.engine.at(), **self.scope)
        defect_issue = self.engine.get("Issue", issue_ref["objectId"])
        with self.store.transaction(True):
            self.engine.bootstrap("Action", action)
            self.engine._record_machines[("Issue", defect_issue["id"])] = "issue"
        defect_issue = self.expect("issues", defect_issue, "assign", {
            "responsiblePartyId": defect_issue["responsiblePartyId"],
            "responsibleOrganizationId": defect_issue["responsibleOrganizationId"],
            "dueAt": self.tomorrow,
            "actionIds": defect_issue["actionIds"] + [action_id],
        }, actor="SUP", evidence=[])
        issue_ref = self.ref("Issue", defect_issue["id"])
        action_ref = self.ref("Action", action_id)
        assets = [self.ref("Asset", asset_id) for asset_id in self.asset_ids]
        scope = {
            "scopeId": "SYS-A-GRID-1",
            "system": "SYS-A",
            "locationIds": [self.scope["locationId"]],
            "assetRefs": assets,
        }
        handover_data = {
            "handoverNo": "HP-HTTP-001",
            "handoverScope": scope,
            "handoverProfileRef": self.ref("Requirement", self.handover_profile_id),
            "commissioningPackageRefs": [self.ref("WorkItem", commissioning["id"])],
            "asBuiltRefs": [self.ref("InformationItem", self.document_ids["asBuilt"])],
            "omManualRefs": [self.ref("InformationItem", self.document_ids["omManual"])],
            "trainingRefs": [self.ref("InformationItem", self.document_ids["training"])],
            "sparePartsRefs": [self.ref("InformationItem", self.document_ids["spareParts"])],
            "certificateRefs": [self.ref("InformationItem", self.document_ids["certificates"])],
            "statutoryAcceptanceRefs": [self.ref("InformationItem", self.document_ids["statutoryAcceptance"])],
            "openIssueRefs": [issue_ref],
            "reservationProposals": [{
                "issueRef": issue_ref,
                "ownerPartyId": self.store.meta["actors"]["OWN"]["partyId"],
                "dueAt": self.tomorrow,
                "closureRequirement": "Close and verify the remaining Punch item",
            }],
        }
        handover = self.create("handover-packages", {
            **self.scope,
            "subtype": "HandoverPackage",
            "title": "System A exact-scope handover",
            "requirementRefs": [self.ref("Requirement", self.requirement_id)],
            "drawingRef": self.ref("InformationItem", self.drawing_id),
            "data": handover_data,
        }, "CON")
        handover = self.expect("handover-packages", handover, "submit_handover_package", actor="CON", evidence=[])
        handover = self.expect("handover-packages", handover, "start_readiness_review", actor="SUP", evidence=[])
        handover = self.expect("handover-packages", handover, "submit_owner_review", actor="SUP", evidence=[self.evidence_id])
        decision = self._owner_decision(handover, "Conditional acceptance with one tracked reservation")
        handover = self.expect(
            "handover-packages", handover, "accept_with_reservations",
            {"ownerDecisionRef": decision, "ownerReservationInputs": handover_data["reservationProposals"]},
            actor="OWN", evidence=[self.evidence_id],
        )
        self.assertEqual(len(handover["data"]["reservations"]), 1)
        self.assertEqual(handover["data"]["reservations"][0]["issueRef"], issue_ref)
        accepted_scope = {**scope, "assetRefs": [assets[0]]}
        handover = self.expect(
            "handover-packages", handover, "record_partial_handover",
            {"acceptedScope": accepted_scope, "effectiveAt": self.now, "warrantyTrigger": True},
            actor="OWN", evidence=[self.evidence_id],
        )
        self.assertEqual(handover["status"], "partial_handover")
        self.assertEqual(handover["data"]["acceptedScope"], accepted_scope)
        self.assertEqual(handover["data"]["warrantyStartAt"], self.now)
        self.assertEqual(len(handover["data"]["reservations"]), 1)
        accepted_handover_ref = self.ref("WorkItem", handover["id"])

        unrelated_issue_id = uid()
        unrelated_issue = deepcopy(self.engine.get("Issue", issue_ref["objectId"]))
        unrelated_issue.update(id=unrelated_issue_id, version=1, locationId=uid())
        with self.store.transaction(True):
            self.engine.bootstrap("Issue", unrelated_issue)
        invalid_claim_payload = {
            **self.scope,
            "subtype": "WarrantyClaim",
            "title": "Defect report with an out-of-scope Issue",
            "requirementRefs": [self.ref("Requirement", self.requirement_id)],
            "data": {
                "claimNo": "WC-HTTP-INVALID",
                "handoverRef": accepted_handover_ref,
                "warrantyPeriodRef": self.ref("Requirement", self.warranty_period_id),
                "defectObservedAt": self.now,
                "defectScope": accepted_scope,
                "defectDescription": "Observed leakage",
                "causeDescription": "Seal failed",
                "operationalImpact": "System isolated",
                "issueRef": self.ref("Issue", unrelated_issue_id),
            },
            "evidenceIds": [self.evidence_id],
        }
        self.login("OWN")
        invalid_create = self.client.post(
            f"/projects/{self.project}/warranty-claims",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={"roleAssignmentId": self.role, "clientObjectId": uid(), "payload": invalid_claim_payload},
        )
        self.assertEqual(invalid_create.status_code, 409, invalid_create.text)
        self.assertEqual(invalid_create.json()["code"], "WARRANTY_ISSUE_REQUIRED")
        self.assertFalse(any(kind == "WorkItem" and value.get("subtype") == "WarrantyClaim" for (kind, _), value in self.engine._records.items()))

        claim = self.create("warranty-claims", {
            **self.scope,
            "subtype": "WarrantyClaim",
            "title": "Defect within partially accepted scope",
            "requirementRefs": [self.ref("Requirement", self.requirement_id)],
            "data": {
                "claimNo": "WC-HTTP-001",
                "handoverRef": accepted_handover_ref,
                "warrantyPeriodRef": self.ref("Requirement", self.warranty_period_id),
                "defectObservedAt": self.now,
                "defectScope": accepted_scope,
                "defectDescription": "Observed leakage at accepted flange",
                "causeDescription": "Seal failed during operation",
                "operationalImpact": "System isolated pending repair",
                "issueRef": issue_ref,
            },
            "evidenceIds": [self.evidence_id],
        }, "OWN")
        handover = self.expect("handover-packages", handover, "close_handover_package", actor="SUP", evidence=[])
        self.assertEqual(handover["status"], "closed")
        self.assertEqual(len(handover["data"]["reservations"]), 1)
        claim = self.expect("warranty-claims", claim, "report_warranty_defect", actor="OWN", evidence=[self.evidence_id])
        claim = self.expect("warranty-claims", claim, "acknowledge_claim", actor="CON", evidence=[])
        claim = self.expect("warranty-claims", claim, "assess_warranty", actor="SUP", evidence=[])
        defect_issue = self.engine.get("Issue", issue_ref["objectId"])
        # The reserved Issue already has a verified Action in cycle zero. Add
        # the distinct Warranty remedy Action in the same official cycle so
        # failed reinspection must retain both identities, even though the
        # claim's remedy projection contains only the new Warranty Action.
        self.assertEqual(defect_issue["actionIds"], [reservation_action_id, action_id])
        claim = self.expect(
            "warranty-claims", claim, "require_remedy",
            {"actionRefs": [action_ref], "responseDueAt": self.tomorrow}, actor="SUP", evidence=[],
        )
        claim = self.expect("warranty-claims", claim, "start_remedy", actor="CON", evidence=[])
        claim = self.expect("warranty-claims", claim, "submit_remedy", {"remedySummary": "Replaced seal and pressure-tested"}, actor="CON", evidence=[self.evidence_id])
        # The immutable Inspection snapshot includes every current-cycle
        # Issue Action, including the previously verified reservation Action.
        inspection_action_snapshots = [self.ref("Action", reservation_action_id), self.ref("Action", action_id)]
        # The Warranty Action advances after the Inspection request snapshot.
        action = self.engine.get("Action", action_id)
        action.update(version=action["version"] + 1, status="verified", updatedAt=self.engine.at())
        with self.store.transaction(True):
            self.engine._save("Action", action)
        inspection = next(r for (kind, _), r in self.engine._records.items() if kind == "Inspection" and r.get("status") == "passed")
        failed_reinspection_id = uid()
        failed_reinspection = deepcopy(inspection)
        failed_reinspection.update(
            id=failed_reinspection_id, version=1, updatedAt=self.engine.at(),
            status="completed", resultStatus="fail", nextWorkAllowed=False, holdPoint=False,
            relatedIssueId=issue_ref["objectId"], correctionCycle=defect_issue.get("correctionCycle", 0),
            previousInspectionId=defect_issue["inspectionIds"][-1], correctiveActionRefs=inspection_action_snapshots,
            evidenceIds=[self.evidence_id], **self.scope,
        )
        with self.store.transaction(True):
            self.engine.bootstrap("Inspection", failed_reinspection)
            self.engine._record_machines[("Issue", defect_issue["id"])] = "issue"
        defect_issue = self.expect("issues", defect_issue, "start_correction", actor="CON", evidence=[])
        defect_issue = self.expect("issues", defect_issue, "request_reinspection", {
            "inspectionIds": defect_issue["inspectionIds"] + [failed_reinspection_id],
        }, actor="CON", evidence=[self.evidence_id])
        defect_issue = self.expect("issues", defect_issue, "start_reinspection", actor="SUP", evidence=[])
        failed_reinspection_ref = self.ref("Inspection", failed_reinspection_id)
        original_issue_ref = deepcopy(claim["data"]["issueRef"])
        original_action_refs = deepcopy(claim["data"]["actionRefs"])

        inspection_before = deepcopy(self.engine.get("Inspection", failed_reinspection_id))
        unlinked_action_id = uid()
        unlinked_action = deepcopy(action)
        unlinked_action.update(
            id=unlinked_action_id, version=1, relatedIssueId=issue_ref["objectId"],
            correctionCycle=defect_issue["correctionCycle"], status="verified",
            updatedAt=self.engine.at(),
        )
        with self.store.transaction(True):
            self.engine.bootstrap("Action", unlinked_action)

        missing_action_snapshot = [self.ref("Action", action_id)]
        unlinked_action_snapshot = inspection_action_snapshots + [self.ref("Action", unlinked_action_id)]
        for label, snapshot, code in (
            ("missing-current-cycle-action", missing_action_snapshot, "REFERENCE_IDENTITY_MISMATCH"),
            ("unlinked-action", unlinked_action_snapshot, "REFERENCE_IDENTITY_MISMATCH"),
        ):
            with self.subTest(rework_snapshot=label):
                changed_inspection = deepcopy(inspection_before)
                changed_inspection["correctiveActionRefs"] = snapshot
                with self.store.transaction(True):
                    self.engine._save("Inspection", changed_inspection)
                claim_before = deepcopy(self.engine.get("WorkItem", claim["id"]))
                audit_before = deepcopy(self.engine._audit)
                refused_rework = self.command(
                    "warranty-claims", claim, "require_rework",
                    {"reinspectionRef": failed_reinspection_ref,
                     "reworkReason": "Inspection Action set is incomplete or unlinked"},
                    actor="SUP", evidence=[self.evidence_id],
                )
                self.assertEqual(refused_rework.status_code, 409, refused_rework.text)
                self.assertEqual(refused_rework.json()["code"], code)
                self.assertEqual(self.engine.get("WorkItem", claim["id"]), claim_before)
                self.assertEqual(self.engine._audit, audit_before)
                with self.store.transaction(True):
                    self.engine._save("Inspection", inspection_before)

        for label, action_patch, code in (
            ("action-wrong-cycle", {"correctionCycle": defect_issue["correctionCycle"] + 1}, "REFERENCE_IDENTITY_MISMATCH"),
            ("action-cancelled", {"status": "cancelled"}, "REFERENCE_CYCLE_INCOMPLETE"),
        ):
            with self.subTest(rework_action=label):
                latest_reservation = deepcopy(self.engine.get("Action", reservation_action_id))
                changed_reservation = {**latest_reservation, **action_patch,
                                       "version": latest_reservation["version"] + 1,
                                       "updatedAt": self.engine.at()}
                with self.store.transaction(True):
                    self.engine._save("Action", changed_reservation)
                claim_before = deepcopy(self.engine.get("WorkItem", claim["id"]))
                audit_before = deepcopy(self.engine._audit)
                refused_rework = self.command(
                    "warranty-claims", claim, "require_rework",
                    {"reinspectionRef": failed_reinspection_ref,
                     "reworkReason": "Current cycle Action cannot be accepted"},
                    actor="SUP", evidence=[self.evidence_id],
                )
                self.assertEqual(refused_rework.status_code, 409, refused_rework.text)
                self.assertEqual(refused_rework.json()["code"], code)
                self.assertEqual(self.engine.get("WorkItem", claim["id"]), claim_before)
                self.assertEqual(self.engine._audit, audit_before)
                with self.store.transaction(True):
                    self.engine._save("Action", latest_reservation)

        # Rework must not revive an Issue that has already left the actionable
        # lifecycle, even when its identity still matches the claim snapshot.
        for terminal_status in ("cancelled", "closed"):
            with self.subTest(terminal_status=terminal_status):
                latest_issue = self.engine.get("Issue", defect_issue["id"])
                original_status = latest_issue["status"]
                latest_issue["status"] = terminal_status
                latest_issue["version"] += 1
                latest_issue["updatedAt"] = self.engine.at()
                with self.store.transaction(True):
                    self.engine._save("Issue", latest_issue)
                claim_before = deepcopy(self.engine.get("WorkItem", claim["id"]))
                audit_before = deepcopy(self.engine._audit)
                refused_rework = self.command(
                    "warranty-claims", claim, "require_rework",
                    {"reinspectionRef": failed_reinspection_ref,
                     "reworkReason": "Issue is no longer actionable"},
                    actor="SUP", evidence=[self.evidence_id],
                )
                self.assertEqual(refused_rework.status_code, 409, refused_rework.text)
                self.assertEqual(refused_rework.json()["code"], "WARRANTY_ISSUE_REQUIRED")
                self.assertEqual(self.engine.get("WorkItem", claim["id"]), claim_before)
                self.assertEqual(self.engine._audit, audit_before)
                latest_issue = self.engine.get("Issue", defect_issue["id"])
                latest_issue["status"] = original_status
                latest_issue["version"] += 1
                latest_issue["updatedAt"] = self.engine.at()
                with self.store.transaction(True):
                    self.engine._save("Issue", latest_issue)
        claim = self.expect("warranty-claims", claim, "require_rework", {
            "reinspectionRef": failed_reinspection_ref,
            "reworkReason": "Inspection found leakage remains at the flange",
        }, actor="SUP", evidence=[self.evidence_id])
        self.assertEqual(claim["data"]["issueRef"], original_issue_ref)
        self.assertEqual(claim["data"]["actionRefs"], original_action_refs)
        self.assertNotIn("currentActionRefs", claim["data"])
        self.assertNotIn("remedyReferenceRefreshHistory", claim["data"])
        defect_issue = self.engine.get("Issue", defect_issue["id"])
        defect_issue = self.expect("issues", defect_issue, "reject_reinspection", actor="SUP", evidence=[self.evidence_id])
        defect_issue = self.expect("issues", defect_issue, "restart_correction", actor="CON", evidence=[])
        self.assertEqual(defect_issue["correctionCycle"], 1)
        replacement_action_id = uid()
        replacement_action = deepcopy(action)
        replacement_action.update(
            id=replacement_action_id, version=1, status="in_progress", correctionCycle=1,
            updatedAt=self.engine.at(), **self.scope,
        )
        second_replacement_action_id = uid()
        second_replacement_action = deepcopy(replacement_action)
        second_replacement_action.update(id=second_replacement_action_id, version=1)
        with self.store.transaction(True):
            self.engine.bootstrap("Action", replacement_action)
            self.engine.bootstrap("Action", second_replacement_action)
        replacement_action_snapshot_refs = [
            self.ref("Action", replacement_action_id),
            self.ref("Action", second_replacement_action_id),
        ]
        defect_issue = self.expect("issues", defect_issue, "link_actions", {
            "actionIds": defect_issue["actionIds"] + [replacement_action_id, second_replacement_action_id],
        }, actor="CON", evidence=[])
        current_issue_ref = self.ref("Issue", defect_issue["id"])
        replacement_action_ref = self.ref("Action", replacement_action_id)
        second_replacement_action_ref = self.ref("Action", second_replacement_action_id)
        incomplete_refresh = self.command("warranty-claims", claim, "refresh_remedy_references", {
            "issueRef": current_issue_ref, "actionRefs": [replacement_action_ref],
        }, actor="SUP", evidence=[])
        self.assertEqual(incomplete_refresh.status_code, 409, incomplete_refresh.text)
        self.assertEqual(incomplete_refresh.json()["code"], "REFERENCE_IDENTITY_MISMATCH")
        self.assertEqual(self.engine.get("WorkItem", claim["id"])["version"], claim["version"])
        unauthorized_refresh = self.command("warranty-claims", claim, "refresh_remedy_references", {
            "issueRef": current_issue_ref, "actionRefs": [replacement_action_ref, second_replacement_action_ref],
        }, actor="CON", evidence=[])
        self.assertEqual(unauthorized_refresh.status_code, 403, unauthorized_refresh.text)
        self.assertEqual(self.engine.get("WorkItem", claim["id"])["version"], claim["version"])
        claim = self.expect("warranty-claims", claim, "refresh_remedy_references", {
            "issueRef": current_issue_ref,
            "actionRefs": [replacement_action_ref, second_replacement_action_ref],
        }, actor="SUP", evidence=[])
        self.assertEqual(claim["data"]["issueRef"], issue_ref)
        self.assertEqual(claim["data"]["actionRefs"], [action_ref])
        self.assertEqual(claim["data"]["currentIssueRef"], current_issue_ref)
        self.assertEqual(claim["data"]["currentActionRefs"], [replacement_action_ref, second_replacement_action_ref])
        self.assertEqual(len(claim["data"]["remedyReferenceRefreshHistory"]), 1)
        claim = self.expect("warranty-claims", claim, "start_remedy", actor="CON", evidence=[])
        claim = self.expect("warranty-claims", claim, "submit_remedy", {"remedySummary": "Replaced seal in correction cycle 1"}, actor="CON", evidence=[self.evidence_id])
        replacement_action = self.engine.get("Action", replacement_action_id)
        replacement_action.update(version=replacement_action["version"] + 1, status="verified", updatedAt=self.engine.at())
        second_replacement_action = self.engine.get("Action", second_replacement_action_id)
        second_replacement_action.update(version=second_replacement_action["version"] + 1, status="verified", updatedAt=self.engine.at())
        with self.store.transaction(True):
            self.engine._save("Action", replacement_action)
            self.engine._save("Action", second_replacement_action)
        replacement_action_ref = self.ref("Action", replacement_action_id)
        second_replacement_action_ref = self.ref("Action", second_replacement_action_id)
        reinspection_id = uid()
        reinspection = deepcopy(inspection)
        reinspection.update(
            id=reinspection_id, version=1, updatedAt=self.engine.at(),
            status="passed", resultStatus="pass", nextWorkAllowed=True, holdPoint=False,
            relatedIssueId=issue_ref["objectId"], correctionCycle=1, previousInspectionId=failed_reinspection_id,
            correctiveActionRefs=replacement_action_snapshot_refs, **self.scope,
        )
        with self.store.transaction(True):
            self.engine.bootstrap("Inspection", reinspection)
        unrelated_reinspection_id = uid()
        unrelated_reinspection = deepcopy(reinspection)
        unrelated_reinspection.update(id=unrelated_reinspection_id, version=1, relatedIssueId=unrelated_issue_id)
        with self.store.transaction(True):
            self.engine.bootstrap("Inspection", unrelated_reinspection)
        unrelated = self.command(
            "warranty-claims", claim, "accept_remedy",
            {"reinspectionRef": self.ref("Inspection", unrelated_reinspection_id)}, actor="SUP", evidence=[self.evidence_id],
        )
        self.assertEqual(unrelated.status_code, 409, unrelated.text)
        self.assertEqual(unrelated.json()["code"], "WARRANTY_REINSPECTION_SCOPE_MISMATCH")
        self.assertEqual(self.engine.get("WorkItem", claim["id"])["version"], claim["version"])
        for label, supplied_actions in (("stale", replacement_action_snapshot_refs), ("incomplete", [replacement_action_ref])):
            with self.subTest(acceptance_refs=label):
                claim_before = deepcopy(self.engine.get("WorkItem", claim["id"]))
                audit_before = deepcopy(self.engine._audit)
                refused = self.command(
                    "warranty-claims", claim, "accept_remedy",
                    {"reinspectionRef": self.ref("Inspection", reinspection_id),
                     "issueRef": current_issue_ref, "actionRefs": supplied_actions},
                    actor="SUP", evidence=[self.evidence_id],
                )
                self.assertEqual(refused.status_code, 409, refused.text)
                self.assertEqual(refused.json()["code"], "REFERENCE_STALE" if label == "stale" else "REFERENCE_IDENTITY_MISMATCH")
                self.assertEqual(self.engine.get("WorkItem", claim["id"]), claim_before)
                self.assertEqual(self.engine._audit, audit_before)
        claim = self.expect(
            "warranty-claims", claim, "accept_remedy",
            {"reinspectionRef": self.ref("Inspection", reinspection_id),
             "issueRef": current_issue_ref, "actionRefs": [replacement_action_ref, second_replacement_action_ref]},
            actor="SUP", evidence=[self.evidence_id],
        )
        self.assertEqual(claim["data"]["issueRef"], issue_ref)
        self.assertEqual(claim["data"]["currentIssueRef"], current_issue_ref)
        self.assertEqual(len(claim["data"]["remedyReferenceRefreshHistory"]), 2)
        unrelated_closure = self.ref("InformationItem", self.document_ids["closure"])
        denied = self.command("warranty-claims", claim, "close_warranty_claim", {"closureRef": unrelated_closure}, actor="SUP", evidence=[self.evidence_id])
        self.assertEqual(denied.status_code, 422, denied.text)
        self.assertEqual(denied.json()["code"], "SCHEMA_INVALID")
        closure = self._owner_decision(claim, "Warranty remedy closure approved")
        denied = self.command("warranty-claims", claim, "close_warranty_claim", {"closureRef": closure}, actor="CON", evidence=[self.evidence_id])
        self.assertEqual(denied.status_code, 403, denied.text)
        before = self.engine.get("WorkItem", claim["id"])
        stale = self.command("warranty-claims", claim, "close_warranty_claim", {"closureRef": closure}, actor="SUP", evidence=[self.evidence_id], version=claim["version"] - 1)
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(self.engine.get("WorkItem", claim["id"])["version"], before["version"])
        idem_key = uid()
        closed_response = self.command("warranty-claims", claim, "close_warranty_claim", {"closureRef": closure}, actor="SUP", evidence=[self.evidence_id], key=idem_key)
        self.assertEqual(closed_response.status_code, 200, closed_response.text)
        closed = closed_response.json()
        replay = self.command("warranty-claims", claim, "close_warranty_claim", {"closureRef": closure}, actor="SUP", evidence=[self.evidence_id], key=idem_key)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["auditEvent"]["id"], closed["auditEvent"]["id"])
        self.assertEqual(closed["record"]["status"], "closed")
        self.assertEqual(len(closed["record"]["data"]["reinspectionHistoryRefs"]), 2)
        self.assertTrue(closed["record"]["data"]["closureEvidenceRefs"])


if __name__ == "__main__":
    unittest.main()
