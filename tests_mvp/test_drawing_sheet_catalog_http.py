"""Synthetic PDF source -> per-page raster drafts -> authenticated sheet/issue views.

Create tiny vector test PDFs only as INPUT fixtures; browser output is JPEG.
No official Evidence, release, approval, or Issue record is fabricated.
"""
import unittest
import subprocess
import shutil
from pathlib import Path
from app.reference.engine import uid

from tests_mvp.test_synthetic_role_login_http import SyntheticQuickLoginHTTPTest


def test_pdf(count=3, variant="DT"):
    """Write a standards-compliant PDF 1.4 with individual page labels."""
    items = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
    }
    kids = []
    for index in range(count):
        pid = 3 + index * 2
        contents = pid + 1
        kids.append(f"{pid} 0 R")
        label = f"{variant}-{index + 1:02d}".encode("ascii")
        stream = b"BT /F1 24 Tf 64 500 Td (" + label + b") Tj ET"
        items[pid] = (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] "
                      b"/Resources << /Font << /F1 " + str(3 + count * 2).encode() + b" 0 R >> >> "
                      b"/Contents " + str(contents).encode() + b" 0 R >>")
        items[contents] = (b"<< /Length " + str(len(stream)).encode()
                           + b" >>\nstream\n" + stream + b"\nendstream")
    items[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {count} >>".encode()
    items[3 + count * 2] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    result = bytearray(b"%PDF-1.4\n")
    offsets = {0: 0}
    for index in sorted(items):
        offsets[index] = len(result)
        result.extend(f"{index} 0 obj\n".encode() + items[index] + b"\nendobj\n")
    start = len(result)
    result.extend(f"xref\n0 {len(items)+1}\n0000000000 65535 f \n".encode())
    for index in range(1, len(items) + 1):
        result.extend(f"{offsets[index]:010d} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Size {len(items)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(result)


@unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftoppm"), "poppler required")
class DrawingSheetHTTPTest(unittest.TestCase):
    def setUp(self):
        SyntheticQuickLoginHTTPTest.setUp(self)

    def quick(self, role):
        return SyntheticQuickLoginHTTPTest.quick(self, role)

    def upload(self, role="ADM", data=None, name="설계도면집.pdf", key=None):
        path = "/projects/" + self.project + "/drawing-sets?filename=" + __import__("urllib.parse", fromlist=["quote"]).quote(name)
        return self.http.post(path, headers={**self.quick(role), "Content-Type": "application/pdf",
                                             "Idempotency-Key": key or uid()},
                              content=data if data is not None else test_pdf())

    def test_three_sheet_import_images_metadata_relogin_and_source_once(self):
        adm = self.quick("ADM")
        with self.store.transaction():
            previous_drawings = sum(1 for (kind, _), record in self.store.engine._records.items()
                                    if kind == "InformationItem" and record.get("subtype") == "Drawing")
        request_key = uid()
        first = self.upload(key=request_key)
        self.assertEqual(first.status_code, 202, first.text)
        set_id = first.json()["set"]["id"]
        assert set_id
        rows = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=adm)
        self.assertEqual(rows.status_code, 200, rows.text)
        self.assertEqual(rows.json()["count"], 3)
        sheets = rows.json()["items"]
        self.assertEqual([row["pageNo"] for row in sheets], [1, 2, 3])
        self.assertEqual(len({row["id"] for row in sheets}), 3)
        self.assertEqual(len({row["setId"] for row in sheets}), 1)
        self.assertTrue(all(row["hasPreview"] and row["hasThumb"] and row["status"] == "ready" for row in sheets))
        details = self.http.get("/projects/" + self.project + "/drawing-sets/" + set_id, headers=adm)
        self.assertEqual(details.json()["set"]["completedPages"], 3)
        self.assertEqual(details.json()["set"]["status"], "ready")
        for row in sheets:
            for size in ("preview", "thumb"):
                image = self.http.get("/projects/" + self.project + "/drawing-sheets/" +
                                      row["id"] + "/image?size=" + size, headers=adm)
                self.assertEqual(image.status_code, 200, image.text[:200] if image.status_code != 200 else "")
                self.assertTrue(image.content.startswith(b"\xff\xd8\xff"))
                self.assertTrue(image.headers["content-type"].startswith("image/jpeg"))
        again = self.upload(key=request_key)
        self.assertEqual(again.status_code, 202)
        self.assertEqual(again.json()["set"]["id"], set_id)
        different = self.upload(data=test_pdf(2), key=request_key)
        self.assertEqual(different.status_code, 409)
        with self.store.transaction():
            self.assertEqual(len(self.store.meta["drawingSets"][self.project]), 1)
            self.assertEqual(len(self.store.meta["drawingSheets"][self.project]), 3)
            self.assertTrue(self.store.blob("drawing-original:" + set_id).startswith(b"%PDF-"))
            self.assertTrue(self.store.meta.get("drawingSheetAudit", {}).get(self.project))
            self.assertEqual(sum(1 for (kind, _), record in self.store.engine._records.items()
                                 if kind == "InformationItem" and record.get("subtype") == "Drawing"), previous_drawings)
        edited = self.http.patch("/projects/" + self.project + "/drawing-sheets/" + sheets[0]["id"],
              headers={**adm, "Idempotency-Key": uid()},
              json=dict(expectedVersion=1, number="DT-05", title="계단 상세도"))
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(edited.json()["sheet"]["version"], 2)
        stale = self.http.patch("/projects/" + self.project + "/drawing-sheets/" + sheets[0]["id"],
              headers={**adm, "Idempotency-Key": uid()},
              json=dict(expectedVersion=1, number="DT-05A", title="구버전"))
        self.assertEqual(stale.status_code, 409)

    def test_role_isolation_and_exact_sheet_marker_list(self):
        imported = self.upload()
        self.assertEqual(imported.status_code, 202, imported.text)
        sheets = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=self.quick("OWN")).json()["items"]
        self.assertEqual(len(sheets), 3)
        first, second = sheets[0]["id"], sheets[1]["id"]
        self.assertEqual(self.upload(role="OWN").status_code, 403)
        own = self.quick("OWN")
        con = self.quick("CON")
        adm = self.quick("ADM")
        base = "/projects/" + self.project + "/drawing-sheets/"
        draft = {"kind": "issue", "comment": "합성 도면 이슈 1", "x": 0.61, "y": 0.47, "recordRef": None}
        key = uid()
        saved = self.http.post(base + first + "/pins", headers={**con, "Idempotency-Key": key}, json=draft)
        self.assertEqual(saved.status_code, 200, saved.text)
        pin = saved.json()["pin"]
        self.assertEqual(pin["status"], "draft")
        self.assertEqual(pin["kind"], "issue")
        self.assertEqual(self.http.post(base + first + "/pins",
              headers={**con, "Idempotency-Key": key}, json=draft).json(), saved.json())
        self.assertEqual(self.http.get(base + first + "/pins", headers=own).json()["count"], 1)
        detail = self.http.get(base + first, headers=own)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["pins"], self.http.get(base + first + "/pins", headers=own).json()["items"])
        self.assertEqual(self.http.get(base + second + "/pins", headers=own).json()["count"], 0)
        self.assertEqual(self.http.post(base + first + "/pins",
              headers={**own, "Idempotency-Key": uid()}, json=draft).status_code, 403)
        self.assertEqual(self.http.get("/projects/" + self.primary + "/drawing-sheets", headers=adm).status_code, 404)
        self.assertEqual(self.http.get(base + first + "/pins").status_code, 401)
        for bad in ({"x": -0.1}, {"y": 1.1}, {"comment": ""}, {"kind": "delete"},
                    {"recordRef": {"objectType": "Issue", "objectId": uid(), "version": 1}}):
            response = self.http.post(base + first + "/pins",
                 headers={**con, "Idempotency-Key": uid()}, json={**draft, **bad})
            self.assertNotEqual(response.status_code, 200, response.text)

    def test_non_pdf_and_corrupt_pdf_rejected_before_any_write(self):
        result = self.upload(data=b"%PDF-corrupted content")
        self.assertEqual(result.status_code, 422)
        missing = self.http.post("/projects/" + self.project + "/drawing-sets?filename=bad.pdf",
            headers={**self.quick("ADM"), "Content-Type":"image/png", "Idempotency-Key":uid()},
            content=test_pdf())
        self.assertEqual(missing.status_code, 415)
        for bad in ["../bad.pdf", "broken.jpg"]:
            result = self.upload(name=bad)
            self.assertEqual(result.status_code, 422)
        with self.store.transaction():
            self.assertFalse(self.store.meta.get("drawingSets", {}).get(self.project))


if __name__ == "__main__":
    unittest.main()
