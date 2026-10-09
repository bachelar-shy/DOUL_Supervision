"""HTTP acceptance for the Quality issue / corrective action closed loop.

Every official Quality record and transition in this test uses the FastAPI
routes. Trusted demo project baselines and an explicitly test-only signature
verifier provide configuration/input fixtures; this is development validation,
not field or legal-provider acceptance.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


class MockTrustedVerifier:
    """TEST ONLY: deterministic boundary double; not legal signature proof."""

    def __init__(self):
        self.calls = []

    def verify(self, request):
        self.calls.append(request)
        return {
            "verified": True,
            "partyId": request.party_id,
            "documentHash": request.document_hash,
            "method": request.method,
            "signerRole": request.signer_role,
            "mockAdapter": True,
        }


class QualityClosedLoopHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.verifier = MockTrustedVerifier()
        self.app = create_app(
            str(Path(self.temp.name) / "quality.db"),
            demo=True,
            signature_verifier=self.verifier,
        )
        self.client = TestClient(self.app)
        self.store = self.app.state.store
        self.project = self.store.meta["projectId"]
        self.scope = deepcopy(self.store.meta["scope"])
        self.requirement_ref = deepcopy(self.store.meta["requirementRef"])
        self.drawing_ref = deepcopy(self.store.meta["drawingRef"])
        self.initial_evidence_id = self.store.meta["evidenceId"]
        self.con = self.login("CON")
        self.sup = self.login("SUP")
        self.owner = self.login("OWN")
        workspace = self.get(self.sup, f"/projects/{self.project}/workspace").json()
        self.owner_party_id = next(
            item["partyId"]
            for item in workspace["participants"]
            if item["actorGroup"] == "OWN"
        )
        self.now = datetime.now(timezone.utc)
        self.due_at = (self.now + timedelta(days=2)).isoformat().replace("+00:00", "Z")

    def tearDown(self):
        self.client.close()
        self.store.close()
        self.temp.cleanup()

    def login(self, actor_group):
        response = self.client.post("/dev/sessions", json={"actorGroup": actor_group})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        return {
            "session": session,
            "headers": {
                "Authorization": "Bearer " + session["accessToken"],
                "X-Role-Assignment-Id": session["actor"]["roleAssignmentId"],
            },
        }

    def headers(self, actor, key=None):
        value = dict(actor["headers"])
        if key:
            value["Idempotency-Key"] = key
        return value

    def get(self, actor, path):
        return self.client.get(path, headers=self.headers(actor))

    def create(self, actor, collection, payload):
        response = self.client.post(
            f"/projects/{self.project}/{collection}",
            headers=self.headers(actor, uid()),
            json={
                "roleAssignmentId": actor["session"]["actor"]["roleAssignmentId"],
                "clientObjectId": uid(),
                "payload": payload,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["record"]

    def command(
        self,
        actor,
        collection,
        record,
        command,
        payload=None,
        evidence_ids=None,
        *,
        expected=200,
        version=None,
    ):
        response = self.client.post(
            f"/projects/{self.project}/{collection}/{record['id']}/{command.replace('_', '-')}",
            headers=self.headers(actor, uid()),
            json={
                "roleAssignmentId": actor["session"]["actor"]["roleAssignmentId"],
                "expectedVersion": record["version"] if version is None else version,
                "payload": payload or {},
                "evidenceIds": [] if evidence_ids is None else evidence_ids,
            },
        )
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def transition(self, actor, collection, record, command, payload=None, evidence_ids=None):
        return self.command(actor, collection, record, command, payload, evidence_ids)["record"]

    def upload_evidence(self, actor, label, scope=None):
        """Exercise the real resumable upload path for synthetic test evidence."""
        evidence_scope = self.scope if scope is None else scope
        content = f"%PDF-1.4\nSynthetic quality acceptance evidence: {label}\n".encode()
        digest = sha256(content).hexdigest()
        upload = self.client.post(
            f"/projects/{self.project}/uploads",
            headers=self.headers(actor, uid()),
            json={
                "roleAssignmentId": actor["session"]["actor"]["roleAssignmentId"],
                "captureId": uid(),
                "fileName": f"quality-{label}.pdf",
                "mimeType": "application/pdf",
                "byteCount": len(content),
                "expectedHash": digest,
                "sourcePartyId": actor["session"]["actor"]["partyId"],
                "mediaType": "document",
                "discipline": evidence_scope["discipline"],
                "packageId": evidence_scope["packageId"],
                "locationId": evidence_scope["locationId"],
            },
        )
        self.assertEqual(upload.status_code, 201, upload.text)
        upload_id = upload.json()["id"]
        chunk = self.client.put(
            f"/projects/{self.project}/uploads/{upload_id}/chunks",
            headers={**self.headers(actor, uid()), "Upload-Offset": "0"},
            content=content,
        )
        self.assertEqual(chunk.status_code, 200, chunk.text)
        completed = self.client.post(
            f"/projects/{self.project}/uploads/{upload_id}/complete",
            headers=self.headers(actor, uid()),
            json={"roleAssignmentId": actor["session"]["actor"]["roleAssignmentId"], "expectedHash": digest},
        )
        self.assertEqual(completed.status_code, 201, completed.text)
        return completed.json()

    def create_and_fail_inspection(self):
        suffix = uid()[:8]
        inspection = self.create(self.con, "inspections", {
            **self.scope,
            "workName": f"Quality closed loop {suffix}",
            "selfInspectionComplete": True,
            "precheck": {name: True for name in ("drawing", "material", "test", "previous", "change")},
            "holdPoint": False,
            "nextWorkAllowed": False,
            "minimumQualificationRank": 1,
            "requirementRefs": [self.requirement_ref],
            "drawingRef": self.drawing_ref,
            "evidenceIds": [self.initial_evidence_id],
        })
        inspection = self.transition(self.con, "inspections", inspection, "request", {
            "requestedAt": self.now.isoformat(),
            "requestedInspectionAt": (self.now + timedelta(minutes=20)).isoformat(),
            "selfInspectionComplete": True,
            "precheck": {name: True for name in ("drawing", "material", "test", "previous", "change")},
            "requirementRefs": [self.requirement_ref],
            "drawingRef": self.drawing_ref,
        }, [self.initial_evidence_id])
        inspection = self.transition(self.sup, "inspections", inspection, "receive", {
            "receivedAt": self.now.isoformat(),
        })
        inspection = self.transition(self.sup, "inspections", inspection, "schedule", {
            "scheduledAt": self.now.isoformat(),
        })
        inspection = self.transition(self.sup, "inspections", inspection, "start")
        inspection = self.transition(self.sup, "inspections", inspection, "submit_results", {
            "checkResults": [{
                "itemId": "dimension",
                "requirementRef": self.requirement_ref,
                "result": "fail",
                "evidenceIds": [self.initial_evidence_id],
                "measuredValue": 90,
                "unit": "mm",
            }],
        }, [self.initial_evidence_id])
        inspection = self.transition(self.sup, "inspections", inspection, "fail", {
            "failureReason": "Initial dimension outside the accepted tolerance.",
        }, [self.initial_evidence_id])
        self.assertEqual(inspection["resultStatus"], "fail")
        return inspection

    def create_confirmed_observation(self, suffix):
        observation = self.create(self.sup, "observations", {
            **self.scope,
            "source": "supervisor",
            "description": f"Observed dimension nonconformance {suffix}",
            "grounding": [{
                "evidenceId": self.initial_evidence_id,
                "channel": "visual",
                "claimSupport": "observed",
            }],
            "evidenceIds": [self.initial_evidence_id],
        })
        observation = self.transition(self.sup, "observations", observation, "begin_review")
        observation = self.transition(self.sup, "observations", observation, "confirm", {
            "verificationNote": "Supervisor verified the observation against the source evidence.",
        }, [self.initial_evidence_id])
        self.assertEqual(observation["status"], "confirmed")
        return observation

    def create_issue_package(self, inspection, observation, suffix):
        response = self.client.post(
            f"/projects/{self.project}/inspection-cases/{inspection['id']}/issues",
            headers=self.headers(self.sup, uid()),
            json={
                "roleAssignmentId": self.sup["session"]["actor"]["roleAssignmentId"],
                "issueObjectId": uid(),
                "actionObjectId": uid(),
                "observationIds": [observation["id"]],
                "subtype": "NCR",
                "title": f"Quality NCR {suffix}",
                "actionTitle": f"Initial correction {suffix}",
                "responsiblePartyId": self.con["session"]["actor"]["partyId"],
                "dueAt": self.due_at,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        self.assertEqual(result["issue"]["status"], "assigned")
        self.assertEqual(result["correctiveAction"]["relatedIssueId"], result["issue"]["id"])
        return result["issue"], result["correctiveAction"]

    def complete_action(self, issue, action, evidence_id, description):
        action = self.transition(self.con, "actions", action, "start")
        action = self.transition(self.con, "actions", action, "submit", {
            "correction": description,
            "rootCause": "Initial setting was not checked against the approved drawing.",
            "preventiveAction": "Add a second-person measurement check to the pre-pour checklist.",
        }, [evidence_id])
        action = self.transition(self.sup, "actions", action, "verify", {}, [evidence_id])
        self.assertEqual(action["status"], "verified")
        return action

    def request_reinspection(self, issue, root_inspection, evidence_id, label):
        response = self.client.post(
            f"/projects/{self.project}/inspection-cases/{root_inspection['id']}/issues/{issue['id']}/reinspections",
            headers=self.headers(self.con, uid()),
            json={
                "roleAssignmentId": self.con["session"]["actor"]["roleAssignmentId"],
                "reinspectionObjectId": uid(),
                "workName": f"{label} {uid()[:8]}",
                "requestedInspectionAt": (self.now + timedelta(hours=2)).isoformat(),
                "selfInspectionComplete": True,
                "precheck": {name: True for name in ("drawing", "material", "test", "previous", "change")},
                "evidenceIds": [evidence_id],
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["issue"], response.json()["reinspection"]

    def judge_reinspection(self, inspection, evidence_id, result):
        inspection = self.transition(self.sup, "inspections", inspection, "receive", {
            "receivedAt": self.now.isoformat(),
        })
        inspection = self.transition(self.sup, "inspections", inspection, "schedule", {
            "scheduledAt": self.now.isoformat(),
        })
        inspection = self.transition(self.sup, "inspections", inspection, "start")
        inspection = self.transition(self.sup, "inspections", inspection, "submit_results", {
            "checkResults": [{
                "itemId": "dimension",
                "requirementRef": self.requirement_ref,
                "result": result,
                "evidenceIds": [evidence_id],
                "measuredValue": 120 if result == "pass" else 90,
                "unit": "mm",
            }],
        }, [evidence_id])
        command = "pass" if result == "pass" else "fail"
        payload = {} if result == "pass" else {"failureReason": "Retest remains outside the accepted tolerance."}
        inspection = self.transition(self.sup, "inspections", inspection, command, payload, [evidence_id])
        return inspection

    def sign_fm09(self, inspection):
        data = {}
        values = {
            "inspection.no": inspection["id"],
            "inspection.work_name": inspection["workName"],
            "work.discipline": inspection["discipline"],
            "work.location": inspection["locationId"],
            "inspection.datetime": self.now.isoformat(),
            "inspection.place": inspection["locationId"],
            "basis.drawings": inspection["drawingRef"]["objectId"],
            "basis.criteria": inspection["requirementRefs"][0]["objectId"],
            "basis.tests": "dimension",
            "result.status": "pass",
            "result.next_work_allowed": False,
        }
        for path, value in values.items():
            node = data
            segments = path.split(".")
            for segment in segments[:-1]:
                node = node.setdefault(segment, {})
            node[segments[-1]] = value
        evidence = self.client.post(
            f"/projects/{self.project}/forms/FM-09/render",
            headers=self.headers(self.sup, uid()),
            json={
                "roleAssignmentId": self.sup["session"]["actor"]["roleAssignmentId"],
                "sourceDomainRefs": [{
                    "objectType": "Inspection",
                    "objectId": inspection["id"],
                    "version": inspection["version"],
                }],
                "data": data,
                "language": "vi",
                "output": "html_a4",
            },
        )
        self.assertEqual(evidence.status_code, 200, evidence.text)
        document = evidence.json()
        self.assertIn("renderHash", document, sorted(document))
        self.assertEqual(document["status"], "final")
        self.assertEqual(document["sourceDomainRefs"][0]["version"], inspection["version"])
        render_hash = document["renderHash"]
        signers = [
            (self.sup, "owner_side_supervisor"),
            (self.con, "contractor_technical_lead"),
        ]
        for actor, role_code in signers:
            signed = self.client.post(
                f"/projects/{self.project}/documents/{document['id']}/sign",
                headers=self.headers(actor, uid()),
                json={
                    "roleAssignmentId": actor["session"]["actor"]["roleAssignmentId"],
                    "documentHash": render_hash,
                    "roleCode": role_code,
                    "method": "approved_e_signature",
                },
            )
            self.assertEqual(signed.status_code, 200, signed.text)
        self.assertEqual(document["status"], "final")
        self.assertEqual(len(self.verifier.calls), 2)
        self.assertTrue(all(call.document_hash == render_hash for call in self.verifier.calls))
        return document

    def report_body(self, inspection, issue, suffix):
        return {
            "roleAssignmentId": self.sup["session"]["actor"]["roleAssignmentId"],
            "reportObjectId": uid(),
            "title": f"Quality closeout report {suffix}",
            "revision": "1",
            "type": "regular",
            "priority": "P2",
            "recipientIds": [self.owner_party_id],
            "facts": "Failed inspection corrected and current-cycle reinspection passed.",
            "cause": "Initial measurement did not follow the current drawing control.",
            "impact": {"quality": "resolved", "schedule": "rechecked"},
            "immediateActions": "The affected work remained on hold through retest.",
            "recommendation": "Owner receipt and closeout acknowledgment are requested.",
            "dueAt": self.due_at,
            "receiptDueAt": self.due_at,
        }

    def test_http_quality_failed_cycle_retry_signed_reinspection_and_separate_owner_report(self):
        suffix = uid()[:8]
        original = self.create_and_fail_inspection()
        observation = self.create_confirmed_observation(suffix)
        issue, first_action = self.create_issue_package(original, observation, suffix)
        issue = self.transition(self.con, "issues", issue, "start_correction")

        first_remedy = self.upload_evidence(self.con, "cycle-zero-remedy")
        first_action = self.complete_action(issue, first_action, first_remedy["id"], "First-cycle correction completed.")
        issue, first_failed_reinspection = self.request_reinspection(issue, original, first_remedy["id"], "First failed reinspection")
        issue = self.transition(self.sup, "issues", issue, "start_reinspection")
        first_failed_reinspection = self.judge_reinspection(first_failed_reinspection, first_remedy["id"], "fail")
        denied_close = self.command(
            self.sup, "issues", issue, "close",
            {"closureEvidenceIds": [self.initial_evidence_id]},
            [self.initial_evidence_id], expected=409,
        )
        self.assertEqual(denied_close["code"], "REINSPECTION_PASSED")
        issue = self.transition(
            self.sup, "issues", issue, "reject_reinspection", {}, [first_remedy["id"]]
        )
        self.assertEqual(issue["correctionCycle"], 1)
        issue = self.transition(
            self.con, "issues", issue, "restart_correction", {}, [first_remedy["id"]]
        )

        second_action = self.create(self.con, "actions", {
            **self.scope,
            "title": f"Cycle-one corrective action {suffix}",
            "relatedIssueId": issue["id"],
            "responsiblePartyId": self.con["session"]["actor"]["partyId"],
            "dueAt": self.due_at,
        })
        issue = self.transition(self.sup, "issues", issue, "link_actions", {
            "actionIds": issue["actionIds"] + [second_action["id"]],
        })
        second_action = self.transition(self.sup, "actions", second_action, "assign", {
            "responsiblePartyId": self.con["session"]["actor"]["partyId"],
            "dueAt": self.due_at,
        })
        second_remedy = self.upload_evidence(self.con, "cycle-one-remedy")
        action_only_evidence = self.upload_evidence(self.con, "cycle-one-action-only")
        second_action = self.transition(self.con, "actions", second_action, "start")
        second_action = self.transition(self.con, "actions", second_action, "submit", {
            "correction": "Second-cycle correction completed.",
            "rootCause": "Initial setting was not checked against the approved drawing.",
            "preventiveAction": "Add a second-person measurement check to the pre-pour checklist.",
        }, [second_remedy["id"], action_only_evidence["id"]])
        second_action = self.transition(
            self.sup, "actions", second_action, "verify", {},
            [second_remedy["id"], action_only_evidence["id"]],
        )
        issue, passed_reinspection = self.request_reinspection(issue, original, second_remedy["id"], "Passed reinspection")
        issue = self.transition(self.sup, "issues", issue, "start_reinspection")
        passed_reinspection = self.judge_reinspection(passed_reinspection, second_remedy["id"], "pass")
        self.assertEqual(passed_reinspection["status"], "passed")
        self.assertFalse(passed_reinspection["nextWorkAllowed"])

        # Release attempts below use the actual Vietnamese FM-09 output signed
        # by two HTTP actors; signatures are accepted only by this named test double.
        unsigned = self.command(
            self.sup, "inspections", passed_reinspection, "release_next_work", {},
            [second_remedy["id"]], expected=409,
        )
        self.assertEqual(unsigned["code"], "ACCEPTANCE_SIGNED")
        document = self.sign_fm09(passed_reinspection)
        released_reinspection = self.transition(
            self.sup, "inspections", passed_reinspection, "release_next_work", {}, [second_remedy["id"]]
        )
        self.assertEqual(released_reinspection["status"], "completed")
        self.assertTrue(released_reinspection["nextWorkAllowed"])
        self.assertEqual(document["sourceDomainRefs"][0]["version"], passed_reinspection["version"])

        close_body = {
            "closureEvidenceIds": [first_remedy["id"], second_remedy["id"]],
        }
        stale_cycle = self.command(
            self.sup, "issues", issue, "close", close_body,
            [first_remedy["id"], second_remedy["id"]], expected=409,
        )
        self.assertEqual(stale_cycle["code"], "CLOSURE_EVIDENCE_SCOPE_INVALID")
        initial_only = self.command(
            self.sup, "issues", issue, "close",
            {"closureEvidenceIds": [self.initial_evidence_id]}, [self.initial_evidence_id], expected=409,
        )
        self.assertEqual(initial_only["code"], "CLOSURE_ACTION_EVIDENCE_REQUIRED")
        mixed_old_and_current = self.command(
            self.sup, "issues", issue, "close",
            {"closureEvidenceIds": [self.initial_evidence_id, second_remedy["id"]]},
            [self.initial_evidence_id, second_remedy["id"]], expected=409,
        )
        self.assertEqual(mixed_old_and_current["code"], "CLOSURE_EVIDENCE_SCOPE_INVALID")
        missing_reinspection_evidence = self.command(
            self.sup, "issues", issue, "close",
            {"closureEvidenceIds": [action_only_evidence["id"]]},
            [action_only_evidence["id"]], expected=409,
        )
        self.assertEqual(missing_reinspection_evidence["code"], "CLOSURE_REINSPECTION_EVIDENCE_REQUIRED")

        report_attempt = self.client.post(
            f"/projects/{self.project}/inspection-cases/{original['id']}/issues/{issue['id']}/owner-reports",
            headers=self.headers(self.sup, uid()),
            json=self.report_body(original, issue, suffix),
        )
        self.assertEqual(report_attempt.status_code, 409, report_attempt.text)
        self.assertEqual(report_attempt.json()["code"], "ISSUE_NOT_CLOSED")

        # One current-cycle evidence file was attached to both the corrective
        # action and independent passed/released reinspection through their
        # HTTP commands, so it is valid for both required closure intersections.
        # Try a valid-but-out-of-scope source record as an additional selection.
        other_scope = dict(self.scope)
        other_scope["locationId"] = uid()
        cross_scope_content = b"%PDF-1.4\nSynthetic out-of-scope evidence attempt\n"
        cross_scope_upload = self.client.post(
            f"/projects/{self.project}/uploads",
            headers=self.headers(self.sup, uid()),
            json={
                "roleAssignmentId": self.sup["session"]["actor"]["roleAssignmentId"],
                "captureId": uid(),
                "fileName": "out-of-scope.pdf",
                "mimeType": "application/pdf",
                "byteCount": len(cross_scope_content),
                "expectedHash": sha256(cross_scope_content).hexdigest(),
                "sourcePartyId": self.sup["session"]["actor"]["partyId"],
                "mediaType": "document",
                "discipline": other_scope["discipline"],
                "packageId": other_scope["packageId"],
                "locationId": other_scope["locationId"],
            },
        )
        self.assertEqual(cross_scope_upload.status_code, 403, cross_scope_upload.text)
        self.assertEqual(cross_scope_upload.json()["code"], "SCOPE_MISMATCH")

        stale_version = self.command(
            self.sup,
            "issues",
            issue,
            "close",
            {"closureEvidenceIds": [second_remedy["id"]]},
            [second_remedy["id"]],
            expected=409,
            version=issue["version"] - 1,
        )
        self.assertEqual(stale_version["code"], "VERSION_CONFLICT")

        issue = self.transition(
            self.sup,
            "issues",
            issue,
            "close",
            {"closureEvidenceIds": [second_remedy["id"]]},
            [second_remedy["id"]],
        )
        self.assertEqual(issue["status"], "closed")
        self.assertEqual(issue["closureEvidenceIds"], [second_remedy["id"]])
        self.assertEqual(issue["correctionCycle"], 1)
        self.assertEqual(first_failed_reinspection["resultStatus"], "fail")
        self.assertEqual(released_reinspection["resultStatus"], "pass")

        report_response = self.client.post(
            f"/projects/{self.project}/inspection-cases/{original['id']}/issues/{issue['id']}/owner-reports",
            headers=self.headers(self.sup, uid()),
            json=self.report_body(original, issue, suffix),
        )
        self.assertEqual(report_response.status_code, 201, report_response.text)
        report = report_response.json()["report"]
        self.assertEqual(report["status"], "draft")
        report = self.transition(self.sup, "owner-reports", report, "submit")
        report = self.transition(self.sup, "owner-reports", report, "issue")
        self.assertEqual(report["status"], "issued")

        case = self.get(self.sup, f"/projects/{self.project}/inspection-cases/{original['id']}").json()
        group = next(item for item in case["issues"] if item["issue"]["record"]["id"] == issue["id"])
        self.assertFalse(group["readiness"]["ownerReportingComplete"])
        self.assertTrue(group["readiness"]["ownerReceiptPending"])
        self.assertEqual(group["ownerReports"][0]["record"]["status"], "issued")

        report = self.transition(self.owner, "owner-reports", report, "acknowledge", {}, [self.initial_evidence_id])
        self.assertEqual(report["status"], "acknowledged")
        report = self.transition(self.sup, "owner-reports", report, "dispatch")
        report = self.transition(
            self.sup, "owner-reports", report, "verify", {}, [self.initial_evidence_id]
        )
        report = self.transition(
            self.sup, "owner-reports", report, "close", {}, [self.initial_evidence_id]
        )
        self.assertEqual(report["status"], "closed")
        self.assertEqual(report["report"]["acknowledgedBy"], self.owner_party_id)

        final_case = self.get(self.sup, f"/projects/{self.project}/inspection-cases/{original['id']}").json()
        final_group = next(item for item in final_case["issues"] if item["issue"]["record"]["id"] == issue["id"])
        self.assertTrue(final_group["readiness"]["ownerReceiptConfirmed"])
        self.assertTrue(final_group["readiness"]["ownerReportingComplete"])
        self.assertEqual(final_group["ownerReports"][0]["record"]["status"], "closed")
        self.assertEqual(self.verifier.calls[0].signer_role, "owner_side_supervisor")
        self.assertTrue(all(call.signer_role in {"owner_side_supervisor", "contractor_technical_lead"} for call in self.verifier.calls))


if __name__ == "__main__":
    unittest.main()
