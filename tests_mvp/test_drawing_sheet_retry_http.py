"""Failed pages resume without rewriting completed original-derived images."""
from hashlib import sha256
from unittest.mock import patch

from app.reference.engine import uid
from services.api.modules.drawing_raster import PdfSheetError
from services.api.modules import drawing_sheets
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest, test_pdf


class DrawingSheetRetryHTTPTests(DrawingSheetHTTPTest):
    def test_partial_failure_resume_preserves_ready_pages_original_and_audit(self):
        adm = self.quick("ADM")
        owner = self.quick("OWN")
        real_image = drawing_sheets.page_image
        original = test_pdf(3)
        source_hash = sha256(original).hexdigest()

        def one_page_fails(pdf, page, *, thumb=False):
            if page == 2:
                raise PdfSheetError("simulated page 2 raster error")
            return real_image(pdf, page, thumb=thumb)

        with patch.object(drawing_sheets, "page_image", side_effect=one_page_fails):
            created = self.upload(data=original, name="retryable-3-pages.pdf")
        self.assertEqual(created.status_code, 202, created.text)
        root = created.json()["set"]
        set_id = root["id"]
        prefix = "/projects/" + self.project
        with self.store.transaction():
            current = self.store.meta["drawingSets"][self.project][set_id]
            rows = [self.store.meta["drawingSheets"][self.project][sid]
                    for sid in current["sheetIds"]]
            self.assertEqual(current["status"], "failed")
            self.assertEqual(current["completedPages"], 2)
            self.assertEqual([s["status"] for s in rows], ["ready", "failed", "ready"])
            self.assertEqual(sha256(self.store.blob(current["sourceBlobId"])).hexdigest(), source_hash)
            before = {sheet["id"]: (
                sha256(self.store.blob(sheet["previewBlobId"])).hexdigest(),
                sha256(self.store.blob(sheet["thumbBlobId"])).hexdigest())
                for sheet in (rows[0], rows[2])}

        endpoint = prefix + "/drawing-sets/" + set_id + "/retry"
        self.assertEqual(self.http.post(endpoint, headers={**owner, "Idempotency-Key": uid()},
            json={"expectedVersion": 1}).status_code, 403)
        self.assertEqual(self.http.post(endpoint, headers={**adm, "Idempotency-Key": uid()},
            json={"expectedVersion": 99}).status_code, 409)
        key = uid()
        retry = self.http.post(endpoint, headers={**adm, "Idempotency-Key": key},
                               json={"expectedVersion": 1})
        self.assertEqual(retry.status_code, 202, retry.text)
        self.assertEqual(retry.json()["set"]["version"], 2)
        replay = self.http.post(endpoint, headers={**adm, "Idempotency-Key": key},
                                json={"expectedVersion": 1})
        self.assertEqual(replay.status_code, 202, replay.text)
        self.assertEqual(replay.json()["set"]["id"], set_id)
        self.assertEqual(self.http.post(endpoint, headers={**adm, "Idempotency-Key": key},
            json={"expectedVersion": 2}).status_code, 409)
        self.assertEqual(self.http.post(endpoint, headers={**adm, "Idempotency-Key": uid()},
            json={"expectedVersion": 2}).status_code, 422)

        with self.store.transaction():
            current = self.store.meta["drawingSets"][self.project][set_id]
            rows = [self.store.meta["drawingSheets"][self.project][sid]
                    for sid in current["sheetIds"]]
            self.assertEqual(current["status"], "ready")
            self.assertEqual(current["completedPages"], 3)
            self.assertTrue(all(s["status"] == "ready" for s in rows))
            self.assertNotIn("error", current)
            self.assertEqual(sha256(self.store.blob(current["sourceBlobId"])).hexdigest(), source_hash)
            for sheet in (rows[0], rows[2]):
                self.assertEqual((
                    sha256(self.store.blob(sheet["previewBlobId"])).hexdigest(),
                    sha256(self.store.blob(sheet["thumbBlobId"])).hexdigest()), before[sheet["id"]])
            events = [x["event"] for x in self.store.meta["drawingSheetAudit"][self.project]]
            self.assertIn("sheet_raster_retry_requested", events)


if __name__ == "__main__":
    import unittest
    unittest.main()
