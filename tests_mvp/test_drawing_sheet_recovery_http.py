"""Interrupted raster conversion is recovered from durable state."""
import time
from hashlib import sha256
from services.api.modules.drawing_sheets import _render_set
from services.api.modules.drawing_sheet_recovery import recoverable_sets
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest, test_pdf


class DrawingRasterRecoveryTests(DrawingSheetHTTPTest):
    def test_abandoned_processing_set_preserves_finished_images(self):
        result = self.upload(data=test_pdf(3), name="crash-recovery.pdf")
        self.assertEqual(result.status_code, 202, result.text)
        project = self.project
        set_id = result.json()["set"]["id"]
        with self.store.transaction(write=True):
            root = self.store.meta["drawingSets"][project][set_id]
            rows = [self.store.meta["drawingSheets"][project][sid] for sid in root["sheetIds"]]
            original = sha256(self.store.blob(root["sourceBlobId"])).hexdigest()
            completed = sha256(self.store.blob(rows[0]["previewBlobId"])).hexdigest()
            rows[1]["status"] = "processing"
            root["status"] = "processing"
            root["completedPages"] = 2
            root["renderOwner"] = "terminated-server"
            root["renderHeartbeat"] = time.time() - 300
        self.assertIn((project, set_id), recoverable_sets(self.store))
        _render_set(self.store, project, set_id)
        with self.store.transaction():
            root = self.store.meta["drawingSets"][project][set_id]
            rows = [self.store.meta["drawingSheets"][project][sid] for sid in root["sheetIds"]]
            self.assertEqual(root["status"], "ready")
            self.assertEqual(root["completedPages"], 3)
            self.assertEqual(sha256(self.store.blob(root["sourceBlobId"])).hexdigest(), original)
            self.assertEqual(sha256(self.store.blob(rows[0]["previewBlobId"])).hexdigest(), completed)
            self.assertTrue(all(row["status"] == "ready" for row in rows))
            self.assertNotIn("renderOwner", root)
        self.assertNotIn((project, set_id), recoverable_sets(self.store))

    def test_active_claim_cannot_be_stolen(self):
        result = self.upload(data=test_pdf(2), name="active-claim.pdf")
        self.assertEqual(result.status_code, 202, result.text)
        set_id = result.json()["set"]["id"]
        with self.store.transaction(write=True):
            root = self.store.meta["drawingSets"][self.project][set_id]
            root["status"] = "processing"
            root["renderOwner"] = "active-worker"
            root["renderHeartbeat"] = time.time()
        self.assertNotIn((self.project, set_id), recoverable_sets(self.store))
        _render_set(self.store, self.project, set_id)
        with self.store.transaction():
            self.assertEqual(self.store.meta["drawingSets"][self.project][set_id]["renderOwner"], "active-worker")


import unittest

class DrawingRecoveryRestartIntegration(unittest.TestCase):
    def test_new_api_process_reclaims_stale_set_without_manual_retry(self):
        import os
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from app.reference.engine import uid
        from services.api.main import create_app
        from services.api.persistence import create_local_persistence

        with TemporaryDirectory() as tmp, patch.dict(os.environ, {
                "DOUL_ENVIRONMENT": "development", "DOUL_QUEUE_ENABLED": "false"}):
            path = str(Path(tmp) / "restart.sqlite3")
            first = create_local_persistence(path, demo=True)
            project = first.meta["projectId"]
            set_id = uid()
            sheet_ids = [uid(), uid()]
            blob_id = "drawing-original:" + set_id
            now = first.engine.at()
            original = test_pdf(2)
            digest = sha256(original).hexdigest()
            with first.transaction(write=True):
                first.put_blob(blob_id, original)
                first.meta.setdefault("drawingSets", {}).setdefault(project, {})[set_id] = {
                    "id": set_id, "projectId": project, "version": 1,
                    "fileName": "crash-restart.pdf", "folder": "crash-restart",
                    "sha256": digest, "size": len(original),
                    "sourceBlobId": blob_id, "sheetIds": sheet_ids,
                    "pageCount": 2, "completedPages": 0, "status": "processing",
                    "createdAt": now, "updatedAt": now,
                    "renderOwner": "terminated-api", "renderHeartbeat": 0,
                }
                for page, sid in enumerate(sheet_ids, 1):
                    first.meta.setdefault("drawingSheets", {}).setdefault(project, {})[sid] = {
                        "id": sid, "projectId": project, "setId": set_id,
                        "version": 1, "pageNo": page, "number": f"Sheet-{page:03d}",
                        "title": f"Sheet {page} (verify)", "folder": "crash-restart",
                        "status": "processing", "revision": "unverified",
                        "drawingRef": None, "bindingId": None,
                        "thumbBlobId": None, "previewBlobId": None,
                        "createdAt": now, "updatedAt": now,
                    }
            first.close()
            # A genuinely new store and FastAPI lifespan reconstructs the job
            # from the persisted drawing set. No test invokes _render_set.
            second = create_local_persistence(path, demo=True)
            try:
                with TestClient(create_app(demo=True, persistence=second)) as client:
                    self.assertEqual(client.get("/health").status_code, 200)
                    deadline = time.monotonic() + 25
                    while True:
                        with second.transaction():
                            root = second.meta["drawingSets"][project][set_id]
                            status = root["status"]
                            completed = root["completedPages"]
                        if status == "ready":
                            break
                        if time.monotonic() >= deadline:
                            self.fail(f"Restart did not reclaim processing set: {status} {completed}/2")
                        time.sleep(.15)
                    with second.transaction():
                        root = second.meta["drawingSets"][project][set_id]
                        self.assertEqual(root["completedPages"], 2)
                        self.assertNotIn("renderOwner", root)
                        self.assertEqual(sha256(second.blob(blob_id)).hexdigest(), digest)
            finally:
                second.close()


if __name__ == "__main__":
    import unittest
    unittest.main()
