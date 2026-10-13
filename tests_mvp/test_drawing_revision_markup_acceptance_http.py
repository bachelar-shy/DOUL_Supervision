"""Revision + pins + markup must preserve original provenance and role boundaries."""
from hashlib import sha256
import unittest

from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest, test_pdf


class SheetMarkupRevisionAcceptance(DrawingSheetHTTPTest):
    def _prepare(self, name, variant, number="DT-05"):
        adm = self.quick("ADM")
        uploaded = self.upload(data=test_pdf(1, variant=variant), name=name)
        self.assertEqual(uploaded.status_code, 202, uploaded.text)
        root = uploaded.json()["set"]
        sheets = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=adm).json()["items"]
        initial = next(sheet for sheet in sheets if sheet["setId"] == root["id"])
        url = "/projects/" + self.project + "/drawing-sheets/" + initial["id"]
        updated = self.http.patch(url, headers={**adm, "Idempotency-Key": uid()},
            json={"expectedVersion": initial["version"], "number": number, "title": "Roof detail"})
        self.assertEqual(updated.status_code, 200, updated.text)
        return updated.json()["sheet"], root

    def test_historic_drawing_pin_markup_and_source_hash_survive_revision_and_role_changes(self):
        adm, own, con = self.quick("ADM"), self.quick("OWN"), self.quick("CON")
        old, old_set = self._prepare("previous-original.pdf", "OLD")
        new, new_set = self._prepare("new-original.pdf", "NEW")
        self.assertNotEqual(old_set["sha256"], new_set["sha256"])
        root = "/projects/" + self.project + "/drawing-sheets/"
        old_url = root + old["id"]
        new_url = root + new["id"]

        mark = {"sheetVersion": old["version"], "tool": "cloud",
                "points": [{"x": 0.18, "y": 0.22}, {"x": 0.81, "y": 0.57}],
                "color": "#ff3300", "lineWidth": 2.5, "text": ""}
        r = self.http.post(old_url + "/markups", headers={**con, "Idempotency-Key": uid()}, json=mark)
        self.assertEqual(r.status_code, 200, r.text)
        overlay = r.json()["markup"]
        pin = {"x": 0.33, "y": 0.44, "kind": "issue",
               "comment": "Prior revision interference at column C", "recordRef": None}
        created = self.http.post(old_url + "/pins", headers={**con, "Idempotency-Key": uid()}, json=pin)
        self.assertEqual(created.status_code, 200, created.text)
        marker = created.json()["pin"]

        payload = {"fromSheetId": old["id"], "toSheetId": new["id"],
                   "previousRevision": "01", "newRevision": "02",
                   "expectedFromVersion": old["version"], "expectedToVersion": new["version"],
                   "note": "Issued for comparison only; no formal approval"}
        linked = self.http.post("/projects/" + self.project + "/drawing-sheet-revisions",
            headers={**adm, "Idempotency-Key": uid()}, json=payload)
        self.assertEqual(linked.status_code, 201, linked.text)
        edge = linked.json()["link"]
        self.assertEqual(edge["classification"], "DRAFT_REVISION_LINK_NOT_APPROVED")
        self.assertEqual(edge["fromPdfHash"], old_set["sha256"])
        self.assertEqual(edge["toPdfHash"], new_set["sha256"])

        revisions = self.http.get("/projects/" + self.project + "/drawing-sheet-revisions",
                                  headers=own, params={"sheetId": new["id"]})
        self.assertEqual(revisions.status_code, 200, revisions.text)
        self.assertEqual(revisions.json()["count"], 1)
        self.assertTrue(revisions.json()["items"][0]["metadataConsistent"])
        self.assertTrue(revisions.json()["items"][0]["sourceHashesConsistent"])
        before = self.http.get(old_url + "/markups", headers=own)
        self.assertEqual(before.status_code, 200)
        self.assertEqual(before.json()["items"][0]["id"], overlay["id"])
        self.assertEqual(before.json()["items"][0]["points"], mark["points"])
        self.assertEqual(self.http.get(new_url + "/markups", headers=own).json()["count"], 0)
        self.assertEqual(self.http.get(old_url + "/pins", headers=own).json()["items"][0]["id"], marker["id"])
        self.assertEqual(self.http.get(new_url + "/pins", headers=own).json()["count"], 0)
        for sheet in (old, new):
            pic = self.http.get(root + sheet["id"] + "/image?size=preview", headers=own)
            self.assertEqual(pic.status_code, 200)
            self.assertTrue(pic.content.startswith(b"\xff\xd8\xff"))
        self.assertEqual(self.http.post(new_url + "/markups",
            headers={**own, "Idempotency-Key": uid()}, json={**mark, "sheetVersion": new["version"]}).status_code, 403)

        with self.store.transaction():
            stored_sets = self.store.meta["drawingSets"][self.project]
            for row in (old_set, new_set):
                raw = self.store.blob(stored_sets[row["id"]]["sourceBlobId"])
                self.assertEqual(sha256(raw).hexdigest(), row["sha256"])
            self.assertEqual(self.store.meta["drawingSheetPins"][self.project][old["id"]][marker["id"]]["status"], "draft")

    def test_renaming_a_linked_drawing_reports_drift_and_blocks_invalid_chain(self):
        old, _ = self._prepare("rev-one.pdf", "AA")
        middle, _ = self._prepare("rev-two.pdf", "BB")
        end, _ = self._prepare("rev-three.pdf", "CC", number="DT-06")
        adm = self.quick("ADM")
        url = "/projects/" + self.project + "/drawing-sheet-revisions"
        base = {"fromSheetId": old["id"], "toSheetId": middle["id"],
                "previousRevision": "A", "newRevision": "B",
                "expectedFromVersion": old["version"], "expectedToVersion": middle["version"],
                "note": "Old to intermediate"}
        linked = self.http.post(url, headers={**adm, "Idempotency-Key": uid()}, json=base)
        self.assertEqual(linked.status_code, 201, linked.text)

        changed = self.http.patch("/projects/" + self.project + "/drawing-sheets/" + middle["id"],
            headers={**adm, "Idempotency-Key": uid()},
            json={"expectedVersion": middle["version"], "number": "DT-06", "title": "Different detail"})
        self.assertEqual(changed.status_code, 200, changed.text)
        current_middle = changed.json()["sheet"]
        history = self.http.get(url, headers=self.quick("OWN"), params={"sheetId": middle["id"]})
        self.assertEqual(history.status_code, 200)
        self.assertFalse(history.json()["items"][0]["metadataConsistent"])
        self.assertTrue(history.json()["items"][0]["sourceHashesConsistent"])
        broken = self.http.post(url, headers={**adm, "Idempotency-Key": uid()}, json={
            "fromSheetId": current_middle["id"], "toSheetId": end["id"],
            "previousRevision": "B", "newRevision": "C",
            "expectedFromVersion": current_middle["version"], "expectedToVersion": end["version"],
            "note": "Should not continue incompatible identity",
        })
        self.assertEqual(broken.status_code, 409, broken.text)
        self.assertEqual(self.http.get(url, headers=adm).json()["count"], 1)


if __name__ == "__main__":
    unittest.main()
