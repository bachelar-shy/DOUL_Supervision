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


if __name__ == "__main__":
    import unittest
    unittest.main()
