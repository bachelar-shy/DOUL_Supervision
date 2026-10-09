"""AC-STORE authenticated quarantine promotion rollback and recovery proof.

This is development acceptance against the demo SQLite snapshot adapter and
its explicitly local quarantine route. The injected failure writes the blob
inside the transaction, then raises to model a storage adapter that fails after
an ambiguous/partial write. No production storage provider is implied.
"""
import base64
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
)


class StorageFailureAtomicityHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "state.sqlite3")
        self.app = create_app(self.db_path, demo=True)
        self.client = TestClient(self.app)
        self.login("SUP")

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()
        self.temp.cleanup()

    def login(self, actor_group):
        response = self.client.post("/dev/sessions", json={"actorGroup": actor_group})
        self.assertEqual(response.status_code, 200, response.text)
        self.session = response.json()
        self.project = self.session["projectId"]
        self.role_id = self.session["actor"]["roleAssignmentId"]
        self.headers = {
            "Authorization": "Bearer " + self.session["accessToken"],
            "X-RoleAssignment-Id": self.role_id,
        }

    def workspace(self):
        response = self.client.get(f"/projects/{self.project}/workspace", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def upload_quarantine(self):
        content = PNG
        digest = sha256(content).hexdigest()
        upload_id = "store-" + uid().replace("-", "")[:20]
        response = self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine",
            headers={
                **self.headers,
                "X-Upload-Id": upload_id,
                "X-Upload-Size": str(len(content)),
                "X-Upload-SHA256": digest,
                "Content-Type": "image/png",
            },
            content=content,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "quarantined")
        self.assertEqual(response.json()["sha256"], digest)
        return response.json(), digest

    def register_body(self, upload, digest):
        scope = self.workspace()["context"]["scope"]
        return {
            "roleAssignmentId": self.role_id,
            "quarantineKey": upload["quarantineKey"],
            "sha256": digest,
            "sourcePartyId": self.session["actor"]["partyId"],
            "fileName": "atomicity-proof.png",
            "discipline": scope["discipline"],
            "packageId": scope["packageId"],
            "locationId": scope["locationId"],
        }

    def register(self, body, key):
        return self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine/register",
            headers={**self.headers, "Idempotency-Key": key},
            json=body,
        )

    def command(self, collection, record, command, *, payload=None, evidence_ids=None):
        return self.client.post(
            f"/projects/{self.project}/{collection}/{record['id']}/{command}",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.role_id,
                "expectedVersion": record["version"],
                "payload": payload or {},
                "evidenceIds": evidence_ids if evidence_ids is not None else record.get("evidenceIds", []),
            },
        )

    def start_media_run(self, evidence, inspection):
        response = self.client.post(
            f"/projects/{self.project}/media-analysis-runs",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={
                "roleAssignmentId": self.role_id,
                "clientObjectId": uid(),
                "sourceEvidenceIds": [evidence["id"]],
                "inspectionId": inspection["id"],
                "mode": "photo",
                "languages": ["ko", "vi"],
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_blob_failure_rolls_back_evidence_and_retry_completes_required_evidence_workflow(self):
        upload, digest = self.upload_quarantine()
        registration_body = self.register_body(upload, digest)
        registration_key = "ac-store-retry-" + uid()
        store = self.app.state.store

        baseline = store.export_state()
        baseline_blob_count = store.db.execute("SELECT count(*) FROM blobs").fetchone()[0]
        original_put_blob = store.put_blob

        def persist_then_fail(file_id, content):
            original_put_blob(file_id, content)
            raise OSError("injected durable blob storage failure after write")

        # The official HTTP handler must roll back even when the storage port
        # reports failure after it has written into the same transaction.
        store.put_blob = persist_then_fail
        try:
            failed = self.register(registration_body, registration_key)
        finally:
            store.put_blob = original_put_blob

        self.assertEqual(failed.status_code, 422, failed.text)
        self.assertEqual(failed.json()["code"], "INVALID_REQUEST")
        self.assertEqual(store.export_state(), baseline)
        self.assertEqual(store.db.execute("SELECT count(*) FROM blobs").fetchone()[0], baseline_blob_count)
        self.assertFalse(any(key.startswith("evidence-register:") for key in store.requests))
        self.assertFalse(any(event.get("eventType") == "evidence:create" and event.get("request", {}).get("payload", {}).get("fileHash") == digest for event in store.engine.audit_events))
        self.assertFalse(any(record.get("fileHash") == digest for (kind, _), record in store.engine._records.items() if kind == "Evidence"))

        # The quarantine original remains available; retry with the same
        # registration key and exact body now commits one canonical Evidence.
        registered = self.register(registration_body, registration_key)
        self.assertEqual(registered.status_code, 201, registered.text)
        evidence = registered.json()
        self.assertEqual(evidence["sourceType"], "original")
        self.assertEqual(evidence["fileHash"], digest)
        self.assertEqual(store.blob(evidence["fileId"]), PNG)
        matches = [
            record for (kind, _), record in store.engine._records.items()
            if kind == "Evidence" and record.get("fileHash") == digest
        ]
        self.assertEqual(len(matches), 1)
        replay = self.register(registration_body, registration_key)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), evidence)

        # Use this exact registered original through official HTTP workflow
        # commands. A required-evidence transition first refuses empty evidence,
        # then confirms a worker candidate and links it to a real Issue package.
        inspection = next(
            item["record"] for item in self.workspace()["items"]
            if item["machine"] == "inspection" and item["record"]["status"] == "scheduled"
        )
        run = self.start_media_run(evidence, inspection)
        self.login("ADM")
        started = self.client.post(
            f"/dev/media-worker/projects/{self.project}/runs/{run['id']}/start",
            headers={**self.headers, "Idempotency-Key": uid()}, json={},
        )
        self.assertEqual(started.status_code, 200, started.text)
        candidate_body = {
            "kind": "candidate",
            "sourceEvidenceId": evidence["id"],
            "analysisRunId": run["id"],
            "description": "AC-STORE injected storage recovery observation",
            "confidence": 0.82,
            "reviewFlags": ["human_confirmation_required"],
            "grounding": [{"evidenceId": evidence["id"], "channel": "visual", "claimSupport": "observed"}],
        }
        coverage = {"sources": [{
            "sourceEvidenceId": evidence["id"], "analyzedRanges": [],
            "missingRanges": [], "audioProcessedRanges": [], "complete": True,
        }]}
        completed = self.client.post(
            f"/dev/media-worker/projects/{self.project}/runs/{run['id']}/complete",
            headers={**self.headers, "Idempotency-Key": uid()},
            json={"outputs": [candidate_body], "coverage": coverage, "completedAt": "2026-10-09T09:00:00Z"},
        )
        self.assertEqual(completed.status_code, 200, completed.text)
        candidate = completed.json()["candidates"][0]
        self.assertIn(evidence["id"], candidate["evidenceIds"])

        self.login("SUP")
        begun = self.command("observations", candidate, "begin-review")
        self.assertEqual(begun.status_code, 200, begun.text)
        observation = begun.json()["record"]
        before_missing_evidence = store.db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0]
        before_missing_evidence_audit = store.engine.audit_events
        refused = self.command(
            "observations", observation, "confirm",
            payload={"verificationNote": "Supervisor checked the recovered original evidence"},
            evidence_ids=[],
        )
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertEqual(refused.json()["code"], "EVIDENCE_REQUIRED")
        unchanged = self.client.get(
            f"/projects/{self.project}/observations/{observation['id']}", headers=self.headers,
        )
        self.assertEqual(unchanged.status_code, 200, unchanged.text)
        self.assertEqual(unchanged.json()["version"], observation["version"])
        self.assertEqual(
            store.db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0],
            before_missing_evidence,
        )
        self.assertEqual(store.engine.audit_events, before_missing_evidence_audit)
        confirmed = self.command(
            "observations", observation, "confirm",
            payload={"verificationNote": "Supervisor checked the recovered original evidence"},
            evidence_ids=[evidence["id"]],
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        observation = confirmed.json()["record"]
        self.assertIn(evidence["id"], observation["evidenceIds"])

        # The prelinked inspection must fail through its published HTTP
        # workflow before the confirmed, evidence-backed observation is
        # eligible to create an official Issue and Corrective Action.
        inspection = next(
            item["record"] for item in self.workspace()["items"]
            if item["machine"] == "inspection" and item["record"]["id"] == inspection["id"]
        )
        started_inspection = self.command("inspections", inspection, "start")
        self.assertEqual(started_inspection.status_code, 200, started_inspection.text)
        inspection = started_inspection.json()["record"]
        result = {
            "itemId": "dimension",
            "requirementRef": inspection["requirementRefs"][0],
            "result": "fail",
            "evidenceIds": inspection["evidenceIds"],
            "measuredValue": 95,
            "unit": "mm",
        }
        submitted = self.command(
            "inspections", inspection, "submit-results", payload={"checkResults": [result]},
        )
        self.assertEqual(submitted.status_code, 200, submitted.text)
        failed_inspection = self.command(
            "inspections", submitted.json()["record"], "fail",
            payload={"failureReason": "AC-STORE recovery flow records a confirmed field observation"},
        )
        self.assertEqual(failed_inspection.status_code, 200, failed_inspection.text)

        con = next(x for x in self.workspace()["participants"] if x["actorGroup"] == "CON")
        issue_body = {
            "roleAssignmentId": self.role_id,
            "issueObjectId": uid(),
            "actionObjectId": uid(),
            "observationIds": [observation["id"]],
            "subtype": "NCR",
            "title": "AC-STORE recovered-evidence Issue",
            "actionTitle": "Corrective action backed by recovered evidence",
            "responsiblePartyId": con["partyId"],
            "dueAt": "2026-10-20T09:00:00Z",
        }
        issued = self.client.post(
            f"/projects/{self.project}/media-analysis-runs/{run['id']}/issues",
            headers={**self.headers, "Idempotency-Key": "ac-store-issue-" + uid()},
            json=issue_body,
        )
        self.assertEqual(issued.status_code, 201, issued.text)
        package = issued.json()
        self.assertEqual(package["issue"]["observationIds"], [observation["id"]])
        self.assertIn(evidence["id"], observation["evidenceIds"])
        self.assertEqual(package["issue"]["status"], "assigned")
        issue_record = self.client.get(
            f"/projects/{self.project}/issues/{package['issue']['id']}", headers=self.headers,
        )
        self.assertEqual(issue_record.status_code, 200, issue_record.text)
        self.assertEqual(issue_record.json()["observationIds"], [observation["id"]])
        self.assertEqual(store.blob(evidence["fileId"]), PNG)
        self.assertEqual(len([
            record for (kind, _), record in store.engine._records.items()
            if kind == "Evidence" and record.get("fileHash") == digest
        ]), 1)

        # Confirm the official evidence, observation and linked Issue survive
        # reopening the test-owned SQLite database, not just the live objects.
        self.client.close()
        store.close()
        self.app = create_app(self.db_path, demo=True)
        self.client = TestClient(self.app)
        self.login("SUP")
        store = self.app.state.store
        durable_evidence = self.client.get(
            f"/projects/{self.project}/evidence/{evidence['id']}", headers=self.headers,
        )
        self.assertEqual(durable_evidence.status_code, 200, durable_evidence.text)
        self.assertEqual(durable_evidence.json()["fileHash"], digest)
        self.assertEqual(store.blob(evidence["fileId"]), PNG)
        durable_observation = self.client.get(
            f"/projects/{self.project}/observations/{observation['id']}", headers=self.headers,
        )
        self.assertEqual(durable_observation.status_code, 200, durable_observation.text)
        self.assertIn(evidence["id"], durable_observation.json()["evidenceIds"])
        durable_issue = self.client.get(
            f"/projects/{self.project}/issues/{package['issue']['id']}", headers=self.headers,
        )
        self.assertEqual(durable_issue.status_code, 200, durable_issue.text)
        self.assertEqual(durable_issue.json()["observationIds"], [observation["id"]])
        self.assertEqual(len([
            record for (kind, _), record in store.engine._records.items()
            if kind == "Evidence" and record.get("fileHash") == digest
        ]), 1)


if __name__ == "__main__":
    unittest.main()
