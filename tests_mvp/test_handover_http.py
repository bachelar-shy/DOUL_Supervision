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
        issue.update(id=issue_id, version=1, status="open", subtype="Punch", **self.scope)
        action = deepcopy(next(r for (kind, _), r in self.engine._records.items() if kind == "Action"))
        action.update(id=action_id, version=1, status="verified", relatedIssueId=issue_id, **self.scope)
        with self.store.transaction(True):
            self.engine.bootstrap("Issue", issue)
            self.engine.bootstrap("Action", action)
        return self.ref("Issue", issue_id), self.ref("Action", action_id)

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
        issue_ref, _ = self._new_punch_and_action()
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
        old_action = next(r for (kind, _), r in self.engine._records.items() if kind == "Action")
        action_id = uid()
        action = deepcopy(old_action)
        action.update(id=action_id, version=1, status="in_progress", relatedIssueId=issue_ref["objectId"], **self.scope)
        with self.store.transaction(True):
            self.engine.bootstrap("Action", action)
        action_ref = self.ref("Action", action_id)
        claim = self.expect(
            "warranty-claims", claim, "require_remedy",
            {"actionRefs": [action_ref], "responseDueAt": self.tomorrow}, actor="SUP", evidence=[],
        )
        claim = self.expect("warranty-claims", claim, "start_remedy", actor="CON", evidence=[])
        claim = self.expect("warranty-claims", claim, "submit_remedy", {"remedySummary": "Replaced seal and pressure-tested"}, actor="CON", evidence=[self.evidence_id])
        inspection = next(r for (kind, _), r in self.engine._records.items() if kind == "Inspection" and r.get("status") == "passed")
        reinspection_id = uid()
        reinspection = deepcopy(inspection)
        reinspection.update(id=reinspection_id, version=1, status="passed", resultStatus="pass", nextWorkAllowed=True, holdPoint=False, relatedIssueId=issue_ref["objectId"])
        with self.store.transaction(True):
            self.engine.bootstrap("Inspection", reinspection)
        claim = self.expect(
            "warranty-claims", claim, "accept_remedy",
            {"reinspectionRef": self.ref("Inspection", reinspection_id)}, actor="SUP", evidence=[self.evidence_id],
        )
        closure = self.ref("InformationItem", self.document_ids["closure"])
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
        self.assertEqual(len(closed["record"]["data"]["reinspectionHistoryRefs"]), 1)
        self.assertTrue(closed["record"]["data"]["closureEvidenceRefs"])


if __name__ == "__main__":
    unittest.main()
