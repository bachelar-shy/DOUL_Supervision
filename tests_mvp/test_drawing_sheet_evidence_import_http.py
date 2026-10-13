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


    def test_source_permission_revocation_blocks_derived_assets_and_catalog(self):
        adm = self.quick("ADM")
        reader = adm
        with self.store.transaction():
            source = next(record for (kind, _), record in self.store.engine._records.items()
                          if kind == "Evidence" and record["projectId"] == self.project
                          and record.get("mediaType") == "document"
                          and record.get("metadata", {}).get("mimeType") == "application/pdf")
            source_id = source["id"]
            source_version = source["version"]
        endpoint = "/projects/" + self.project
        created = self.http.post(endpoint + "/drawing-sets/from-evidence",
            headers={**adm, "Idempotency-Key": uid()},
            json={"evidenceRef": {"objectType": "Evidence",
                                  "objectId": source_id, "version": source_version}})
        self.assertEqual(created.status_code, 202, created.text)
        set_id = created.json()["set"]["id"]
        sheet_id = created.json()["set"]["sheetIds"][0]
        # Assert this exact role was genuinely permitted before revocation.
        self.assertEqual(self.http.get(endpoint + "/evidence/" + source_id +
                         "/content", headers=reader).status_code, 200)
        self.assertEqual(self.http.get(endpoint + "/drawing-sheets/" + sheet_id +
                         "/image?size=preview", headers=reader).status_code, 200)
        workspace = self.http.get(endpoint + "/workspace", headers=reader)
        self.assertEqual(workspace.status_code, 200, workspace.text)
        role_id = workspace.json()["role"]["id"]
        # Simulate removal from the source discipline while retaining project
        # membership; an existing signed-in session must not bypass the gate.
        with self.store.transaction(write=True):
            role = self.store.engine._records[("RoleAssignment", role_id)]
            role["disciplines"] = ["not-the-source-discipline"]
        original = self.http.get(endpoint + "/evidence/" + source_id + "/content",
                                 headers=reader)
        self.assertEqual(original.status_code, 403, original.text[:250])
        for size in ("preview", "thumb"):
            image = self.http.get(endpoint + "/drawing-sheets/" + sheet_id +
                                  "/image?size=" + size, headers=reader)
            self.assertEqual(image.status_code, 403, image.text[:250])
        self.assertEqual(self.http.get(endpoint + "/drawing-sheets/" + sheet_id,
                         headers=reader).status_code, 403)
        self.assertEqual(self.http.get(endpoint + "/drawing-sheets/" + sheet_id +
                         "/markups", headers=reader).status_code, 403)
        self.assertEqual(self.http.get(endpoint + "/drawing-sheets/" + sheet_id +
                         "/pins", headers=reader).status_code, 403)
        catalog = self.http.get(endpoint + "/drawing-sheets", headers=reader)
        self.assertEqual(catalog.status_code, 200, catalog.text)
        self.assertNotIn(sheet_id, [item["id"] for item in catalog.json()["items"]])
        directory = self.http.get(endpoint + "/drawing-sets", headers=reader)
        self.assertEqual(directory.status_code, 200, directory.text)
        self.assertNotIn(set_id, [item["id"] for item in directory.json()["items"]])


if __name__ == "__main__":
    unittest.main()
