"""New field attachments require current Evidence versions; existing history is unchanged."""
import unittest
from copy import deepcopy
from app.reference.engine import uid
from tests_mvp.test_fw_five_integrated_http import FieldwireFiveHttpTests


class FieldEvidenceCurrentRefsHTTP(unittest.TestCase):
    setUp = FieldwireFiveHttpTests.setUp
    tearDown = FieldwireFiveHttpTests.tearDown
    headers = FieldwireFiveHttpTests.headers
    endpoint = FieldwireFiveHttpTests.endpoint
    visible = FieldwireFiveHttpTests.visible

    def _photo_revisions(self, role):
        original_ref = self.visible("Evidence", role)
        photo_id = uid()
        with self.store.transaction(write=True):
            original = self.store.engine.get("Evidence", original_ref["objectId"])
            photo = deepcopy(original)
            photo.update(id=photo_id, version=1, mediaType="photo",
                         updatedAt=self.store.engine.at())
            photo["metadata"] = {**photo.get("metadata", {}), "mimeType": "image/jpeg"}
            self.store.engine._save("Evidence", photo)
            self.store.engine._save("Evidence", {
                **photo, "version": 2, "updatedAt": self.store.engine.at()})
        return ({"objectType": "Evidence", "objectId": photo_id, "version": 1},
                {"objectType": "Evidence", "objectId": photo_id, "version": 2})

    def test_checklist_rejects_superseded_photo_without_changing_run(self):
        inspection = self.visible("Inspection", "ADM")
        old_photo, current_photo = self._photo_revisions("ADM")
        template = self.http.post(self.endpoint("checklists/templates"),
            headers=self.headers("ADM"), json={"title": "외벽 품질 점검",
                "items": [{"key": "finish", "label": "마감 상태", "type": "pass_fail"}]})
        self.assertEqual(template.status_code, 200, template.text)
        template_id = template.json()["template"]["id"]
        published = self.http.post(self.endpoint("checklists/templates/" + template_id + "/publish"),
            headers=self.headers("ADM"), json={"expectedVersion": 1})
        self.assertEqual(published.status_code, 200, published.text)
        created = self.http.post(self.endpoint("checklists/runs"),
            headers=self.headers("ADM"),
            json={"templateId": template_id, "templateVersion": 2, "subjectRef": inspection})
        self.assertEqual(created.status_code, 200, created.text)
        run_id = created.json()["run"]["id"]
        url = self.endpoint("checklists/runs/" + run_id + "/answers")
        old_body = {"expectedVersion": 1, "answers": {"finish": "pass"},
                    "evidenceRefs": {"finish": [old_photo]}}
        rejected = self.http.post(url, headers=self.headers("ADM"), json=old_body)
        self.assertEqual(rejected.status_code, 409, rejected.text)
        with self.store.transaction():
            saved = self.store.meta["fieldChecklistRuns"][self.project][run_id]
            self.assertEqual(saved["version"], 1)
            self.assertEqual(saved["answers"], {})
        accepted = self.http.post(url, headers=self.headers("ADM"),
            json={**old_body, "evidenceRefs": {"finish": [current_photo]}})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["run"]["answers"]["finish"]["evidenceRefs"], [current_photo])
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Inspection", inspection["objectId"])["version"],
                             inspection["version"])

    def test_discussion_rejects_superseded_evidence_and_preserves_issue(self):
        issue = self.visible("Issue", "SUP")
        old_photo, current_photo = self._photo_revisions("SUP")
        message = {"subjectRef": issue, "message": "시공상태 재확인 바랍니다",
                   "mentionPartyIds": [], "evidenceRefs": [old_photo]}
        rejected = self.http.post(self.endpoint("discussions/comments"),
            headers=self.headers("SUP"), json=message)
        self.assertEqual(rejected.status_code, 409, rejected.text)
        history = self.http.get(self.endpoint("discussions"), headers=self.headers("SUP"),
            params={"subjectType": "Issue", "subjectId": issue["objectId"],
                    "version": issue["version"]})
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual(history.json()["count"], 0)
        accepted = self.http.post(self.endpoint("discussions/comments"),
            headers=self.headers("SUP"), json={**message, "evidenceRefs": [current_photo]})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["comment"]["evidenceRefs"], [current_photo])
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Issue", issue["objectId"])["version"],
                             issue["version"])


    def test_idempotent_retry_after_revision_returns_same_comment(self):
        issue = self.visible("Issue", "SUP")
        _, current_photo = self._photo_revisions("SUP")
        payload = {"subjectRef": issue, "message": "재연결 후 동일 댓글 재전송",
                   "mentionPartyIds": [], "evidenceRefs": [current_photo]}
        url = self.endpoint("discussions/comments")
        key = uid()
        first = self.http.post(url, headers=self.headers("SUP", key=key), json=payload)
        self.assertEqual(first.status_code, 200, first.text)
        with self.store.transaction(write=True):
            issue_record = self.store.engine.get("Issue", issue["objectId"])
            self.store.engine._save("Issue", {
                **issue_record, "version": issue_record["version"] + 1,
                "updatedAt": self.store.engine.at()})
            photo = self.store.engine.get("Evidence", current_photo["objectId"])
            self.store.engine._save("Evidence", {
                **photo, "version": photo["version"] + 1,
                "updatedAt": self.store.engine.at()})
        replay = self.http.post(url, headers=self.headers("SUP", key=key), json=payload)
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), first.json())
        history = self.http.get(self.endpoint("discussions"), headers=self.headers("SUP"),
            params={"subjectType": "Issue", "subjectId": issue["objectId"],
                    "version": issue["version"]})
        self.assertEqual(history.status_code, 200, history.text)
        self.assertEqual(history.json()["count"], 1)
        new_request_old_versions = self.http.post(url, headers=self.headers("SUP"), json=payload)
        self.assertEqual(new_request_old_versions.status_code, 409, new_request_old_versions.text)


if __name__ == "__main__":
    unittest.main()
