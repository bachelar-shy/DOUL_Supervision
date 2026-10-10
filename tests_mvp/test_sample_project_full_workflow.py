"""Repeatable development-only evidence of realistic synthetic WWT sample."""

from collections import Counter
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from scripts.sample_project_materials import build
from scripts.sample_project_load import load
from scripts.sample_usecases import CASES, run_on_backup
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter


class SyntheticSampleProjectAcceptance(unittest.TestCase):
    def test_project_full_population_real_http_and_case_verification(self):
        with tempfile.TemporaryDirectory(prefix="doul-sample-e2e-") as folder:
            root = Path(folder)
            assets = root / "materials"
            manifest_summary = build(assets)
            self.assertEqual(manifest_summary["drawings"], 24)
            self.assertEqual(manifest_summary["photos"], 60)
            self.assertEqual(manifest_summary["reports"], 10)
            self.assertEqual(manifest_summary["photoProvenance"], "one_generated_contact_sheet_12_panels")
            db = str(root / "sample_wwt.sqlite3")
            result = load(db, assets)
            self.assertEqual(result["uploaded"], {"drawing": 24, "photo": 60, "report": 10})
            self.assertEqual(result["drawingRefs"], 24)
            self.assertEqual(result["records"], {
                "inspections": 40, "observations": 15, "issues": 15,
                "actions": 16, "reports": 10,
            })
            store = SQLiteSnapshotAdapter(db, demo=True)
            project = result["projectId"]
            preserved = store.meta["mockProjectSetup"]["previousMeta"]["projectId"]
            self.assertIn(("Project", preserved), store.engine._records)
            self.assertEqual(len(store.meta["sampleLocations"]), 15)
            self.assertEqual(sum(1 for (kind, _), record in store.engine._records.items()
                                 if kind == "RoleAssignment" and record.get("projectId") == project
                                 and record.get("actorGroup") in ("SUP", "CON", "OWN", "DES", "ADM")), 12)
            snapshots = store.meta["sampleRealisticFixture"]["records"]
            self.assertEqual(len(snapshots["inspections"]), 40)
            self.assertEqual(sum(x["status"] == "failed" for x in snapshots["inspections"].values()), 10)
            self.assertEqual(sum(x["status"] == "passed" for x in snapshots["inspections"].values()), 10)
            with store.transaction():
                before_counts = Counter(kind for (kind, _), record in store.engine._records.items()
                                        if record.get("projectId") == project)
                before_metadata = dict(store.meta["sampleRealisticFixture"]["files"])

            app = create_app(db, demo=True)
            with TestClient(app) as client:
                directory = client.get("/dev/projects").json()
                self.assertEqual(len(directory["items"]), 2)
                self.assertEqual(directory["defaultProjectId"], project)
                sup = client.post("/dev/sessions", json={"actorGroup": "SUP", "projectId": project}).json()
                adm = client.post("/dev/sessions", json={"actorGroup": "ADM", "projectId": project}).json()
                sup_headers = {"Authorization": "Bearer " + sup["accessToken"]}
                adm_headers = {"Authorization": "Bearer " + adm["accessToken"]}
                self.assertEqual(client.get(f"/dev/sample/usecases?projectId={project}",
                                            headers=sup_headers).status_code, 403)
                catalog = client.get(f"/dev/sample/usecases?projectId={project}",
                                     headers=adm_headers)
                self.assertEqual(catalog.status_code, 200)
                self.assertEqual(len(catalog.json()["cases"]), 15)
                self.assertEqual(catalog.json()["sampleStats"]["photos"], 60)
                self.assertEqual(catalog.json()["sampleStats"]["actions"], 16)
                run = client.post("/dev/sample/usecases/UC-09/run", json={"projectId": project},
                                  headers=adm_headers)
                self.assertEqual(run.status_code, 200)
                self.assertEqual(run.json()["status"], "PASS")
                self.assertEqual(client.get(f"/projects/{preserved}/workspace",
                                            headers=sup_headers).status_code, 404)
                self.assertEqual(client.get(f"/projects/{project}/workspace",
                                            headers=sup_headers).status_code, 200)
            app.state.store.close()
            runs = [run_on_backup(store, name) for name, *_ in CASES]
            self.assertEqual([name for name in [run["id"] for run in runs]], [row[0] for row in CASES])
            self.assertEqual(Counter(x["status"] for x in runs), {"PASS": 12, "PARTIAL": 3},
                             [(x["id"], x["message"]) for x in runs if x["status"] == "FAIL"])
            with store.transaction():
                after_counts = Counter(kind for (kind, _), record in store.engine._records.items()
                                       if record.get("projectId") == project)
                self.assertEqual(before_counts, after_counts)
                self.assertEqual(before_metadata, store.meta["sampleRealisticFixture"]["files"])
            store.close()
            again=load(db, assets)
            self.assertEqual(again["uploaded"], result["uploaded"])
            self.assertEqual(again["records"], result["records"])


if __name__ == "__main__":
    unittest.main()
