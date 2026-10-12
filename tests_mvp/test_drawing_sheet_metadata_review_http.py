"""Original drawing label verification is separate from design/field approval."""
import unittest
from hashlib import sha256

from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest


class DrawingMetadataReviewHTTPTests(DrawingSheetHTTPTest):
    def prepare(self):
        first = self.upload()
        self.assertEqual(first.status_code, 202, first.text)
        headers = self.quick("ADM")
        sheets = self.http.get("/projects/" + self.project + "/drawing-sheets",
                               headers=headers).json()["items"]
        return first.json()["set"], sheets[0]

    def submit(self, sheet, *, role="SUP", key=None, **overrides):
        body = dict(expectedVersion=sheet["version"], decision="verified",
                    number="DT-05", title="Verified original titleblock",
                    note="Reviewed first PDF page and original title block")
        body.update(overrides)
        path = ("/projects/" + self.project + "/drawing-sheets/" +
                sheet["id"] + "/metadata-review")
        return self.http.post(path, headers={**self.quick(role),
                              "Idempotency-Key": key or uid()}, json=body)

    def test_verification_audit_immutable_original_and_replay(self):
        source, sheet = self.prepare()
        digest = source["sha256"]
        key = uid()
        verified = self.submit(sheet, key=key)
        self.assertEqual(verified.status_code, 200, verified.text)
        row = verified.json()["sheet"]
        self.assertEqual(row["metadataReview"]["status"], "verified")
        self.assertEqual(row["metadataReview"]["sourcePdfHash"], digest)
        self.assertEqual(row["number"], "DT-05")
        self.assertEqual(row["version"], sheet["version"] + 1)
        self.assertEqual(self.submit(sheet, key=key).json(), verified.json())
        self.assertEqual(self.submit(sheet, key=key, title="different title").status_code, 409)
        self.assertEqual(self.submit(sheet).status_code, 409)
        with self.store.transaction():
            self.assertEqual(sha256(self.store.blob("drawing-original:" +
                             source["id"])).hexdigest(), digest)
            matches = [x for x in self.store.meta["drawingSheetAudit"][self.project]
                       if x["event"] == "sheet_metadata_reviewed"]
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches[0]["before"]["number"], sheet["number"])
        owner = self.http.get("/projects/" + self.project + "/drawing-sheets",
                              headers=self.quick("OWN"))
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(owner.json()["items"][0]["metadataReview"]["status"], "verified")
        changed = self.http.patch(
            "/projects/" + self.project + "/drawing-sheets/" + row["id"],
            headers={**self.quick("ADM"), "Idempotency-Key": uid()},
            json=dict(expectedVersion=row["version"], number="DT-05B",
                      title="Adjusted after check"))
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()["sheet"]["metadataReview"]["status"], "needs_review")

    def test_roles_flags_and_validation(self):
        source, sheet = self.prepare()
        self.assertEqual(self.submit(sheet, role="OWN").status_code, 403)
        self.assertEqual(self.submit(sheet, role="CON").status_code, 403)
        self.assertEqual(self.submit(sheet, number="Sheet-001").status_code, 422)
        self.assertEqual(self.submit(sheet, note=" ").status_code, 422)
        flagged = self.submit(sheet, role="ADM", decision="needs_review",
                              number=sheet["number"], title=sheet["title"],
                              note="Titleblock cannot be read on scanned page")
        self.assertEqual(flagged.status_code, 200, flagged.text)
        row = flagged.json()["sheet"]
        self.assertEqual(row["metadataReview"]["status"], "needs_review")
        self.assertEqual(row["number"], sheet["number"])
        self.assertEqual(row["title"], sheet["title"])
        self.assertEqual(self.submit(row, role="SUP").status_code, 200)
        self.assertEqual(self.http.get(
            "/projects/" + self.primary + "/drawing-sheets/" + sheet["id"],
            headers=self.quick("ADM")).status_code, 404)


if __name__ == "__main__":
    unittest.main()
