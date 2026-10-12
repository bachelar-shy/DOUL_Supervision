"""A registered original PDF is indexed by reference, never re-uploaded."""
import hashlib
import shutil
import unittest
from app.reference.engine import uid
from tests_mvp.test_synthetic_role_login_http import SyntheticQuickLoginHTTPTest


@unittest.skipUnless(shutil.which("pdfinfo") and shutil.which("pdftoppm")
                     and shutil.which("pdftotext"), "Poppler required")
class RegisteredDrawingImportHTTPTests(SyntheticQuickLoginHTTPTest):
    def test_source_reuse_roles_idempotence_and_image(self):
        adm = self.quick("ADM")
        own = self.quick("OWN")
        with self.store.transaction():
            source = next(record for (kind, _), record in self.store.engine._records.items()
                          if kind == "Evidence" and record["projectId"] == self.project
                          and record.get("mediaType") == "document"
                          and record.get("metadata", {}).get("mimeType") == "application/pdf")
            ref = {"objectType": "Evidence", "objectId": source["id"], "version": source["version"]}
            original_hash = hashlib.sha256(self.store.blob(source["fileId"])).hexdigest()
        url = "/projects/" + self.project + "/drawing-sets/from-evidence"
        body = {"evidenceRef": ref}
        key = uid()
        imported = self.http.post(url, json=body, headers={**adm, "Idempotency-Key": key})
        self.assertEqual(imported.status_code, 202, imported.text)
        result = imported.json()["set"]
        self.assertEqual(result["sourceEvidenceId"], source["id"])
        self.assertEqual(result["sourceBlobId"], source["fileId"])
        self.assertEqual(result["sha256"], original_hash)
        self.assertEqual(self.http.post(url, json=body,
            headers={**adm, "Idempotency-Key": key}).json()["set"]["id"], result["id"])
        self.assertEqual(self.http.post(url, json=body,
            headers={**adm, "Idempotency-Key": uid()}).json()["set"]["id"], result["id"])
        self.assertEqual(self.http.post(url, json=body,
            headers={**own, "Idempotency-Key": uid()}).status_code, 403)
        self.assertEqual(self.http.post("/projects/" + self.primary + "/drawing-sets/from-evidence",
            json=body, headers={**adm, "Idempotency-Key": uid()}).status_code, 404)
        with self.store.transaction():
            sets = self.store.meta["drawingSets"][self.project]
            self.assertEqual(len(sets), 1)
            self.assertEqual(hashlib.sha256(self.store.blob(source["fileId"])).hexdigest(), original_hash)
        catalog = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=own)
        self.assertEqual(catalog.status_code, 200, catalog.text)
        self.assertEqual(catalog.json()["count"], result["pageCount"])
        first = catalog.json()["items"][0]
        picture = self.http.get("/projects/" + self.project +
            "/drawing-sheets/" + first["id"] + "/image?size=preview", headers=own)
        self.assertEqual(picture.status_code, 200)
        self.assertTrue(picture.content.startswith(bytes([0xFF, 0xD8, 0xFF])))


if __name__ == "__main__":
    unittest.main()
