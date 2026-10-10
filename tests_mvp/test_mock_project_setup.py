from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from app.reference.validation import ContractError
from scripts.mock_project_setup import cleanup, setup
from scripts.validate_product_configuration import validate_project_config
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter


class MockProjectSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "mock-usability.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_setup_reuse_and_primary_role_http_access_to_seeded_workflows(self):
        app = create_app(self.db_path, demo=True)
        store = app.state.store
        original_project_id = store.meta["projectId"]
        first = setup(store)
        second = setup(store)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["projectId"], second["projectId"])
        self.assertEqual(store.meta["serviceActors"].keys(), {"SYSTEM", "AI"})
        self.assertEqual(store.meta["serviceActors"]["SYSTEM"]["partyId"],
                         store.engine.get("RoleAssignment", store.meta["serviceActors"]["SYSTEM"]["roleAssignmentId"])["partyId"])
        config = store.meta["projectConfiguration"]
        self.assertEqual(config["baselineVersion"], "1.1")
        validate_project_config(config)

        project_id = first["projectId"]
        fixture_by_kind = {}
        for (kind, _), record in store.engine._records.items():
            if record.get("projectId") == project_id:
                fixture_by_kind.setdefault(kind, []).append(record)
        for kind in ("Requirement", "InformationItem", "Evidence", "Inspection", "Observation",
                     "Issue", "Action", "Decision", "WorkItem"):
            self.assertTrue(fixture_by_kind.get(kind), kind)
        self.assertTrue(any(record.get("subtype") == "Drawing" for record in fixture_by_kind["InformationItem"]))
        self.assertTrue(any(record.get("status") == "requested" for record in fixture_by_kind["Inspection"]))
        self.assertTrue(any(record.get("subtype") == "Report"
                            and record.get("report", {}).get("type") == "urgent"
                            for record in fixture_by_kind["InformationItem"]))

        client = TestClient(app)
        sessions = {}
        for group in ("CON", "SUP", "OWN", "ADM"):
            response = client.post("/dev/sessions", json={"actorGroup": group})
            self.assertEqual(response.status_code, 200, response.text)
            session = response.json()
            self.assertIn("SYNTHETIC", session["actor"]["name"])
            self.assertEqual(session["projectId"], project_id)
            headers = {"Authorization": "Bearer " + session["accessToken"],
                       "X-RoleAssignment-Id": session["actor"]["roleAssignmentId"]}
            self.assertEqual(client.get(f"/projects/{project_id}/workspace", headers=headers).status_code, 200)
            sessions[group] = headers

        foreign = client.get(f"/projects/{original_project_id}/workspace", headers=sessions["CON"])
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(foreign.json()["code"], "PROJECT_MISMATCH")
        client.close()
        store.close()

    def test_negative_schema_assignments_deny_rank_and_write_authority(self):
        store = SQLiteSnapshotAdapter(self.db_path, demo=True)
        info = setup(store)
        project_id = info["projectId"]
        issue = next(record for (kind, _), record in store.engine._records.items()
                     if kind == "Issue" and record.get("projectId") == project_id)
        negative = info["negativeActors"]
        insufficient = negative["insufficientQualification"]
        role = store.engine.get("RoleAssignment", insufficient["roleAssignmentId"])
        qualification = store.engine.get("Qualification", insufficient["qualificationId"])
        self.assertEqual(role["qualificationIds"], [qualification["id"]])
        self.assertEqual(qualification["rank"], 3)
        with self.assertRaises(ContractError) as denied_rank:
            store.engine.authorize(issue, "close_issue", insufficient["partyId"], role["id"])
        self.assertEqual(denied_rank.exception.code, "QUALIFICATION_INVALID")

        readonly = negative["readOnly"]
        readonly_role = store.engine.get("RoleAssignment", readonly["roleAssignmentId"])
        self.assertEqual(readonly_role["authorityCodes"], ["render_document"])
        evidence = store.engine.get("Evidence", store.meta["evidenceId"])
        store.engine.authorize_read(evidence, readonly["partyId"], readonly_role["id"])
        with self.assertRaises(ContractError) as denied_write:
            store.engine.authorize(issue, "close_issue", readonly["partyId"], readonly_role["id"])
        self.assertEqual(denied_write.exception.code, "NOT_AUTHORIZED")
        store.close()

    def test_cleanup_refuses_later_unowned_evidence_and_then_removes_owned_fixture(self):
        store = SQLiteSnapshotAdapter(self.db_path, demo=True)
        original_meta = deepcopy(store.meta)
        info = setup(store)
        project_id = info["projectId"]
        actor = info["actors"]["CON"]
        evidence_id, file_id = uid(), uid()
        content = b"synthetic unowned cleanup guard"
        payload = {
            "sourceType": "original", "mediaType": "measurement", "fileId": file_id,
            "fileHash": hashlib.sha256(content).hexdigest(), "sourcePartyId": actor["partyId"],
            "metadata": {"demo": True, "mimeType": "text/plain", "name": "Synthetic extra evidence"},
            **{key: store.meta["scope"][key] for key in
               ("packageId", "locationId", "discipline", "responsibleOrganizationId")},
        }
        with store.transaction(True):
            store.put_blob(file_id, content)
            store.engine.add_evidence(evidence_id, project_id, payload, content,
                actor["partyId"], actor["roleAssignmentId"], uid())

        with self.assertRaisesRegex(RuntimeError, "unowned records"):
            cleanup(store)
        self.assertIn("mockProjectSetup", store.meta)
        self.assertIn(("Evidence", evidence_id), store.engine._records)

        with store.transaction(True):
            store.engine._records.pop(("Evidence", evidence_id))
            for key in [key for key in store.engine._history if key[:2] == ("Evidence", evidence_id)]:
                store.engine._history.pop(key, None)
            store.db.execute("DELETE FROM blobs WHERE id=?", (file_id,))
        removed = cleanup(store)
        self.assertGreater(removed["removedRecords"], 30)
        self.assertEqual(store.meta, original_meta)
        self.assertIn(("Project", original_meta["projectId"]), store.engine._records)
        store.close()


if __name__ == "__main__":
    unittest.main()
