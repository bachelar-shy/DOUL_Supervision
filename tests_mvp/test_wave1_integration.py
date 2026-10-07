"""Real API composition checks for evidence, authorization, and notifications."""
from hashlib import sha256
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient

from services.api.main import create_app


PNG = b"\x89PNG\r\n\x1a\n" + b"integration-evidence"


class Wave1APIFunctionalIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(str(Path(self.temp.name) / "state.sqlite3"), demo=True)
        self.client = TestClient(self.app)
        self.session = self.login("SUP")
        self.project = self.session["projectId"]
        self.role_id = self.session["actor"]["roleAssignmentId"]
        self.headers = self.auth_headers(self.session)

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()
        self.temp.cleanup()

    def login(self, group):
        response = self.client.post("/dev/sessions", json={"actorGroup": group})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    @staticmethod
    def auth_headers(session):
        return {
            "Authorization": "Bearer " + session["accessToken"],
            "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"],
        }

    def upload_and_register(self):
        digest = sha256(PNG).hexdigest()
        upload_id = "wave1-integration-upload"
        upload_headers = {
            **self.headers,
            "X-Upload-Id": upload_id,
            "X-Upload-Size": str(len(PNG)),
            "X-Upload-SHA256": digest,
            "Content-Type": "image/png",
        }
        uploaded = self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine",
            headers=upload_headers,
            content=PNG,
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        self.assertEqual(uploaded.json()["status"], "quarantined")
        self.assertEqual(uploaded.json()["sha256"], digest)

        scope = self.app.state.store.meta["scope"]
        registration = {
            "roleAssignmentId": self.role_id,
            "quarantineKey": f"evidence/{self.project}/{upload_id}/{digest}",
            "sha256": digest,
            "sourcePartyId": self.session["actor"]["partyId"],
            "fileName": "field-evidence.png",
            "discipline": scope["discipline"],
            "packageId": scope["packageId"],
            "locationId": scope["locationId"],
        }
        response = self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine/register",
            headers={**self.headers, "Idempotency-Key": "wave1-register-once"},
            json=registration,
        )
        self.assertEqual(response.status_code, 201, response.text)
        evidence = response.json()
        self.assertEqual(evidence["fileHash"], digest)
        self.assertEqual(self.app.state.store.blob(evidence["fileId"]), PNG)
        return registration, evidence

    def test_real_evidence_upload_registration_is_persisted_and_idempotent(self):
        body, created = self.upload_and_register()
        replay = self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine/register",
            headers={**self.headers, "Idempotency-Key": "wave1-register-once"},
            json=body,
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["id"], created["id"])
        collision = self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine/register",
            headers={**self.headers, "Idempotency-Key": "wave1-register-once"},
            json={**body, "fileName": "changed-name.png"},
        )
        self.assertEqual(collision.status_code, 409, collision.text)

        contractor = self.login("CON")
        contractor_role_id = contractor["actor"]["roleAssignmentId"]
        contractor_role = self.app.state.store.engine.get("RoleAssignment", contractor_role_id)
        contractor_role["authorityCodes"] = []
        with self.app.state.store.transaction(write=True):
            self.app.state.store.engine._save("RoleAssignment", contractor_role)
        scope_denied = self.client.post(
            f"/projects/{self.project}/parallel/evidence-quarantine",
            headers={
                **self.auth_headers(contractor),
                "X-Upload-Id": "unauthorized-upload",
                "X-Upload-Size": str(len(PNG)),
                "X-Upload-SHA256": sha256(PNG).hexdigest(),
                "Content-Type": "image/png",
            },
            content=PNG,
        )
        self.assertEqual(scope_denied.status_code, 403, scope_denied.text)

        self.client.close()
        self.app.state.store.close()
        self.app = create_app(str(Path(self.temp.name) / "state.sqlite3"), demo=True)
        self.client = TestClient(self.app)
        self.session = self.login("SUP")
        self.project = self.session["projectId"]
        self.role_id = self.session["actor"]["roleAssignmentId"]
        self.headers = self.auth_headers(self.session)
        stored = self.app.state.store.engine.get("Evidence", created["id"])
        self.assertEqual(stored["fileHash"], body["sha256"])
        self.assertEqual(self.app.state.store.blob(stored["fileId"]), PNG)
        foreign_project = self.client.get(
            f"/projects/{uuid4()}/parallel/evidence-quarantine",
            headers=self.headers,
        )
        self.assertEqual(foreign_project.status_code, 404, foreign_project.text)

    def test_audit_notification_read_and_source_revocation(self):
        _, evidence = self.upload_and_register()
        inbox_url = f"/projects/{self.project}/parallel/notifications"
        inbox = self.client.get(inbox_url, headers=self.headers)
        self.assertEqual(inbox.status_code, 200, inbox.text)
        matching = [item for item in inbox.json()["items"]
                    if item["notification"]["sourceRef"]["objectId"] == evidence["id"]]
        self.assertTrue(matching, inbox.text)
        notification = matching[0]["notification"]
        notification_id = notification["id"]
        self.assertEqual(notification["status"], "queued")

        foreign = self.login("CON")
        forbidden_read = self.client.post(
            f"/projects/{self.project}/parallel/notifications/{notification_id}/read",
            headers=self.auth_headers(foreign),
        )
        self.assertEqual(forbidden_read.status_code, 404, forbidden_read.text)

        marked = self.client.post(
            f"/projects/{self.project}/parallel/notifications/{notification_id}/read",
            headers=self.headers,
        )
        self.assertEqual(marked.status_code, 200, marked.text)
        self.assertTrue(marked.json()["isRead"])
        self.assertEqual(marked.json()["notificationId"], notification_id)
        refreshed = self.client.get(inbox_url, headers=self.headers)
        self.assertEqual(refreshed.status_code, 200, refreshed.text)
        projection = next(item for item in refreshed.json()["items"]
                          if item["notification"]["id"] == notification_id)
        self.assertTrue(projection["isRead"])
        self.assertEqual(
            self.app.state.store.engine.get("Notification", notification_id)["status"],
            "queued",
        )

        role = self.app.state.store.engine.get("RoleAssignment", self.role_id)
        role["locationIds"] = []
        with self.app.state.store.transaction(write=True):
            self.app.state.store.engine._save("RoleAssignment", role)
        hidden = self.client.get(inbox_url, headers=self.headers)
        self.assertEqual(hidden.status_code, 200, hidden.text)
        self.assertNotIn(notification_id, [item["notification"]["id"] for item in hidden.json()["items"]])
        revoked_read = self.client.post(
            f"/projects/{self.project}/parallel/notifications/{notification_id}/read",
            headers=self.headers,
        )
        self.assertEqual(revoked_read.status_code, 403, revoked_read.text)


if __name__ == "__main__":
    unittest.main()
