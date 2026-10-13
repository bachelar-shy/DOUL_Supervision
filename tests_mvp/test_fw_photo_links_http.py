"""Authenticated link/unlink integration over existing pin and Evidence records."""
import unittest
from copy import deepcopy
from app.reference.engine import uid
from tests_mvp.test_fw_five_integrated_http import FieldwireFiveHttpTests


class PhotoLinkHttpTest(unittest.TestCase):
    setUp = FieldwireFiveHttpTests.setUp
    tearDown = FieldwireFiveHttpTests.tearDown
    headers = FieldwireFiveHttpTests.headers
    endpoint = FieldwireFiveHttpTests.endpoint
    visible = FieldwireFiveHttpTests.visible

    def test_photo_links_require_scope_and_preserve_official_work(self):
        issue_ref = self.visible("Issue", "SUP")
        ev_ref = self.visible("Evidence", "SUP")
        sheet_id, pin_id, photo_id = uid(), uid(), uid()
        with self.store.transaction(write=True):
            original = self.store.engine.get("Evidence", ev_ref["objectId"])
            photo = deepcopy(original)
            photo.update(id=photo_id, version=1, mediaType="photo", sourceType="original")
            photo["metadata"] = {**photo.get("metadata", {}), "name": "worksite.jpeg",
                                  "mimeType": "image/jpeg"}
            self.store.engine._save("Evidence", photo)
            self.store.meta.setdefault("drawingSheets", {}).setdefault(self.project, {})[sheet_id] = {
                "id": sheet_id, "version": 1, "projectId": self.project, "number": "A-101",
                "title": "검측 위치도", "status": "ready", "createdAt": self.store.engine.at(),
            }
            self.store.meta.setdefault("drawingSheetPins", {}).setdefault(self.project, {})[sheet_id] = {
                pin_id: {"id": pin_id, "version": 1, "sheetId": sheet_id,
                         "projectId": self.project, "kind": "issue",
                         "recordRef": issue_ref, "status": "linked",
                         "comment": "기둥 위치 검측", "createdAt": self.store.engine.at(),
                         "createdByPartyId": self.actors["SUP"]["partyId"]}
            }
        path = self.endpoint("photo-links")
        body = {"sheetId": sheet_id, "pinId": pin_id, "expectedPinVersion": 1,
                "evidenceRef": {"objectType": "Evidence", "objectId": photo_id, "version": 1}}
        self.assertEqual(self.http.get(path, headers=self.headers("SUP"),
            params={"pinId": pin_id}).status_code, 200)
        denied = self.http.post(path, json=body, headers=self.headers("OWN"))
        self.assertEqual(denied.status_code, 403, denied.text)
        key = uid()
        result = self.http.post(path, json=body, headers=self.headers("SUP", key=key))
        self.assertEqual(result.status_code, 200, result.text)
        link = result.json()["link"]
        self.assertEqual(link["recordRef"], issue_ref)
        self.assertEqual(self.http.post(path, json=body,
            headers=self.headers("SUP", key=key)).json(), result.json())
        duplicated = self.http.post(path, json=body, headers=self.headers("SUP"))
        self.assertNotEqual(duplicated.status_code, 200)
        evidence_links = self.http.get(path, headers=self.headers("SUP"),
            params={"evidenceId": photo_id}).json()
        self.assertEqual(evidence_links["count"], 1)
        # Official Evidence revisions do not erase a correctly authorized
        # historic drawing link. A new link still requires current version.
        with self.store.transaction(write=True):
            previous_photo = self.store.engine.get("Evidence", photo_id)
            self.store.engine._save("Evidence", {
                **previous_photo, "version": 2, "updatedAt": self.store.engine.at()})
        still_visible = self.http.get(path, headers=self.headers("SUP"),
            params={"evidenceId": photo_id})
        self.assertEqual(still_visible.status_code, 200, still_visible.text)
        self.assertEqual(still_visible.json()["count"], 1)
        self.assertEqual(still_visible.json()["items"][0]["evidenceRef"]["version"], 1)
        outdated_link = self.http.post(path, json=body, headers=self.headers("SUP"))
        self.assertEqual(outdated_link.status_code, 409, outdated_link.text)
        stale = self.http.post(path, headers=self.headers("SUP"),
            json={**body, "expectedPinVersion": 9})
        self.assertEqual(stale.status_code, 409, stale.text)
        wrong_project = self.http.post(path.replace(self.project, uid()),
            headers=self.headers("SUP"), json=body)
        self.assertNotEqual(wrong_project.status_code, 200)
        unlink = self.http.post(path + "/" + link["id"] + "/unlink",
            headers=self.headers("SUP"), json={"expectedVersion": 1})
        self.assertEqual(unlink.status_code, 200, unlink.text)
        self.assertEqual(self.http.get(path, headers=self.headers("SUP"),
            params={"pinId": pin_id}).json()["count"], 0)
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Issue", issue_ref["objectId"])["version"],
                             issue_ref["version"])
            self.assertEqual(len(self.store.meta["fieldPhotoLinkAudit"][self.project]), 2)
            self.assertEqual(self.store.meta["fieldPhotoLinks"][self.project][link["id"]]["version"], 2)


if __name__ == "__main__":
    unittest.main()
