"""WWT synthetic upload requires the exact demo project and six persisted zone IDs."""
from pathlib import Path
from types import SimpleNamespace
import json
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from services.api.main import create_app
from scripts.wwt_demo_operational import register, CASE_NAMES


class WWTDemoRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temporary.name) / "wwt.sqlite3")
        self.manifest = str(Path(self.temporary.name) / "manifest.json")

    def tearDown(self):
        self.temporary.cleanup()

    def app(self, profile):
        with patch.dict("os.environ", {"DOUL_DEMO_PROFILE": profile}):
            return create_app(self.db, demo=True)

    def options(self, project):
        return SimpleNamespace(expected_project_id=project, out=self.manifest)

    def test_general_demo_and_wrong_project_rejected_without_upload(self):
        app = self.app("standard")
        with TestClient(app) as client:
            project = app.state.store.meta["projectId"]
            start = len([x for (kind, _), x in app.state.store.engine._records.items() if kind == "Evidence"])
            with self.assertRaises(SystemExit):
                register(client, self.options(project))
            self.assertEqual(start, len([x for (kind, _), x in app.state.store.engine._records.items() if kind == "Evidence"]))
        app.state.store.close()
        # A WWT profile must also refuse a mismatched explicit project ID.
        self.db = str(Path(self.temporary.name) / "separate-wwt.sqlite3")
        app = self.app("wwt")
        with TestClient(app) as client:
            with self.assertRaises(SystemExit):
                register(client, self.options("00000000-0000-4000-8000-000000000001"))
            self.assertEqual({}, app.state.store.uploads)
        app.state.store.close()
        self.assertFalse(Path(self.manifest).exists())

    def test_six_zones_case_metadata_rerun_and_restart(self):
        app = self.app("wwt")
        project = app.state.store.meta["projectId"]
        options = self.options(project)
        with TestClient(app) as client:
            register(client, options)
            manifest = json.loads(Path(self.manifest).read_text())
            self.assertEqual(20, len(manifest["items"]))
            self.assertEqual({"ZONE-" + letter for letter in "ABCDEF"}, {x["location"] for x in manifest["items"]})
            self.assertEqual(6, len({x["locationId"] for x in manifest["items"]}))
            actor = client.post("/dev/sessions", json={"actorGroup": "CON"}).json()
            headers = {"Authorization": "Bearer " + actor["accessToken"], "X-RoleAssignment-Id": actor["actor"]["roleAssignmentId"]}
            for item, (case, _, zone, stage) in zip(manifest["items"], CASE_NAMES):
                response = client.get(f"/projects/{project}/evidence/{item['evidenceId']}", headers=headers)
                self.assertEqual(200, response.status_code, response.text)
                evidence = response.json()
                self.assertEqual(item["locationId"], evidence["locationId"])
                self.assertEqual(case, evidence["metadata"]["demoCaseId"])
                self.assertEqual(stage, evidence["metadata"]["demoStage"])
                self.assertEqual(zone, evidence["metadata"]["demoZone"])
                self.assertEqual("SYNTHETIC_NOT_SITE_EVIDENCE", evidence["metadata"]["demoClassification"])
            before = len(app.state.store.uploads)
            register(client, options)
            self.assertEqual(before, len(app.state.store.uploads))
        app.state.store.close()
        restarted = self.app("wwt")
        with TestClient(restarted) as client:
            register(client, options)
            self.assertEqual(20, len(restarted.state.store.uploads))
        restarted.state.store.close()


if __name__ == "__main__":
    unittest.main()
