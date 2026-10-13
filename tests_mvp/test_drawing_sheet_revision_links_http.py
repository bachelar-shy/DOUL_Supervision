"""Version chains must be explicit, authorized, and independent of original PDFs."""
import unittest
from hashlib import sha256
from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest, test_pdf


class SheetRevisionLinksHTTPTests(DrawingSheetHTTPTest):
    def prepare(self, name, variant):
        adm = self.quick("ADM")
        registered = self.upload(data=test_pdf(1, variant=variant), name=name)
        self.assertEqual(registered.status_code, 202, registered.text)
        set_row = registered.json()["set"]
        sheets = self.http.get("/projects/" + self.project + "/drawing-sheets",
                               headers=adm).json()["items"]
        sheet = next(x for x in sheets if x["setId"] == set_row["id"])
        edited = self.http.patch("/projects/" + self.project + "/drawing-sheets/" + sheet["id"],
              headers={**adm, "Idempotency-Key": uid()},
              json={"expectedVersion": sheet["version"], "number": "DT-05", "title": "Section Detail"})
        self.assertEqual(edited.status_code, 200, edited.text)
        return edited.json()["sheet"], set_row

    def request_revision(self, first, second, prev="01", current="02", key=None, role="ADM", **change):
        body = {
            "fromSheetId": first["id"], "toSheetId": second["id"],
            "previousRevision": prev, "newRevision": current,
            "expectedFromVersion": first["version"], "expectedToVersion": second["version"],
            "note": "Architectural detail revision, requires review",
        }
        body.update(change)
        return self.http.post("/projects/" + self.project + "/drawing-sheet-revisions",
              headers={**self.quick(role), "Idempotency-Key": key or uid()}, json=body)

    def test_chain_version_data_unmodified_replay_and_read_only_user(self):
        first, old_set = self.prepare("first.pdf", "DT")
        second, new_set = self.prepare("second.pdf", "DR")
        original_hashes = [old_set["sha256"], new_set["sha256"]]
        idem = uid()
        result = self.request_revision(first, second, key=idem)
        self.assertEqual(result.status_code, 201, result.text)
        edge = result.json()["link"]
        self.assertEqual(edge["classification"], "DRAFT_REVISION_LINK_NOT_APPROVED")
        self.assertEqual(edge["previousRevision"], "01")
        self.assertEqual(edge["newRevision"], "02")
        self.assertEqual([edge["fromPdfHash"], edge["toPdfHash"]], original_hashes)
        again = self.request_revision(first, second, key=idem)
        self.assertEqual(again.json(), result.json())
        role_owned = self.http.get("/projects/" + self.project + "/drawing-sheet-revisions",
                                  headers=self.quick("OWN"), params={"sheetId": second["id"]})
        self.assertEqual(role_owned.status_code, 200)
        projected = role_owned.json()["items"][0]
        self.assertTrue(projected.pop("metadataConsistent"))
        self.assertTrue(projected.pop("sourceHashesConsistent"))
        self.assertEqual(projected, edge)
        self.assertEqual(self.request_revision(first, second, role="OWN").status_code, 403)
        self.assertEqual(self.request_revision(first, second, role="CON").status_code, 403)
        different = self.request_revision(first, second, key=idem, current="04")
        self.assertEqual(different.status_code, 409)
        with self.store.transaction():
            stores = self.store.meta["drawingSets"][self.project]
            for stored_set, original_digest in zip((old_set, new_set), original_hashes):
                blob = self.store.blob(stores[stored_set["id"]]["sourceBlobId"])
                self.assertEqual(sha256(blob).hexdigest(), original_digest)
            self.assertEqual(self.store.meta["drawingSheets"][self.project][first["id"]]["version"], first["version"])
            self.assertEqual(self.store.meta["drawingSheets"][self.project][second["id"]]["version"], second["version"])
            self.assertEqual(len(self.store.meta["drawingSheetRevisionLinks"][self.project]), 1)

    def test_only_matching_confirmed_numbers_and_distinct_sources(self):
        first, _ = self.prepare("first.pdf", "DT")
        second, _ = self.prepare("second.pdf", "DX")
        bad = self.request_revision(first, second, prev="01", current="01")
        self.assertEqual(bad.status_code, 422)
        bad = self.request_revision(first, first)
        self.assertEqual(bad.status_code, 422)
        bad = self.request_revision(first, second, expectedFromVersion=1)
        self.assertEqual(bad.status_code, 409)
        mismatch = self.http.patch("/projects/" + self.project + "/drawing-sheets/" + second["id"],
              headers={**self.quick("ADM"), "Idempotency-Key": uid()},
              json={"expectedVersion": second["version"], "number": "DT-06", "title": "Changed sheet"})
        self.assertEqual(mismatch.status_code, 200)
        new_second = mismatch.json()["sheet"]
        self.assertEqual(self.request_revision(first, new_second).status_code, 422)
        self.assertEqual(self.http.get("/projects/" + self.primary + "/drawing-sheet-revisions",
            headers=self.quick("ADM")).status_code, 404)

    def test_chain_cannot_cycle_or_branch_and_previous_labels_must_agree(self):
        first, _ = self.prepare("first.pdf", "DA")
        second, _ = self.prepare("second.pdf", "DB")
        third, _ = self.prepare("third.pdf", "DC")
        self.assertEqual(self.request_revision(first, second).status_code, 201)
        self.assertEqual(self.request_revision(second, third, prev="01", current="03").status_code, 409)
        self.assertEqual(self.request_revision(second, third, prev="02", current="03").status_code, 201)
        self.assertEqual(self.request_revision(third, first, prev="03", current="04").status_code, 409)
        self.assertEqual(self.request_revision(first, third, prev="01", current="03").status_code, 409)
        data = self.http.get("/projects/" + self.project + "/drawing-sheet-revisions",
              headers=self.quick("SUP"), params={"sheetId": first["id"]}).json()
        self.assertEqual(data["count"], 2)
        self.assertEqual([link["newRevision"] for link in data["items"]], ["02", "03"])


if __name__ == "__main__":
    unittest.main()
