"""HTTP regression for evidence-linked checklist answers and scoped unread alerts."""
import unittest
from copy import deepcopy

from app.reference.engine import uid
from tests_mvp.test_fw_five_integrated_http import FieldwireFiveHttpTests


class ChecklistCollaborationHttpTest(unittest.TestCase):
    setUp = FieldwireFiveHttpTests.setUp
    tearDown = FieldwireFiveHttpTests.tearDown
    headers = FieldwireFiveHttpTests.headers
    endpoint = FieldwireFiveHttpTests.endpoint
    visible = FieldwireFiveHttpTests.visible

    def test_checklist_item_photo_preserves_evidence_and_official_verdict(self):
        ref = self.visible("Inspection", "ADM")
        original_evidence = self.visible("Evidence", "ADM")
        photo_id = uid()
        with self.store.transaction(write=True):
            evidence = deepcopy(self.store.engine.get("Evidence", original_evidence["objectId"]))
            evidence["id"] = photo_id
            evidence["version"] = 1
            evidence["mediaType"] = "photo"
            evidence["metadata"] = {**evidence.get("metadata", {}), "mimeType": "image/jpeg"}
            self.store.engine._save("Evidence", evidence)
        template = self.http.post(self.endpoint("checklists/templates"),
            headers=self.headers("ADM"), json={"title": "현장 사진 증빙 점검표",
                "items": [{"key": "rebar", "label": "철근 간격", "type": "pass_fail"}]})
        self.assertEqual(template.status_code, 200, template.text)
        t = template.json()["template"]
        pub = self.http.post(self.endpoint("checklists/templates/" + t["id"] + "/publish"),
            headers=self.headers("ADM"), json={"expectedVersion": 1})
        self.assertEqual(pub.status_code, 200, pub.text)
        created = self.http.post(self.endpoint("checklists/runs"), headers=self.headers("ADM"),
            json={"templateId": t["id"], "templateVersion": 2, "subjectRef": ref})
        self.assertEqual(created.status_code, 200, created.text)
        run_id = created.json()["run"]["id"]
        path = self.endpoint("checklists/runs/" + run_id + "/answers")
        body = {"expectedVersion": 1, "answers": {"rebar": "pass"},
                "evidenceRefs": {"rebar": [
                    {"objectType": "Evidence", "objectId": photo_id, "version": 1}]}}
        answer = self.http.post(path, headers=self.headers("ADM"), json=body)
        self.assertEqual(answer.status_code, 200, answer.text)
        response = answer.json()["run"]
        self.assertEqual(response["answers"]["rebar"]["evidenceRefs"], body["evidenceRefs"]["rebar"])
        self.assertEqual(response["status"], "draft")
        self.assertEqual(self.http.post(path, headers=self.headers("ADM"),
            json={**body, "expectedVersion": 1}).status_code, 409)
        non_photo = self.http.post(path, headers=self.headers("ADM"),
            json={"expectedVersion": 2, "answers": {"rebar": "fail"},
                  "evidenceRefs": {"rebar": [original_evidence]}})
        self.assertNotEqual(non_photo.status_code, 200)
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Inspection", ref["objectId"])["version"], ref["version"])
            self.assertEqual(self.store.engine.get("Evidence", photo_id)["version"], 1)

    def test_discussion_alert_only_for_visible_recipient_and_read_audit(self):
        issue = self.visible("Issue", "SUP")
        mentioned_party = self.actors["ADM"]["partyId"]
        body = {"subjectRef": issue, "message": "해당 현장 이슈 협의가 필요합니다.",
                "mentionPartyIds": [mentioned_party], "evidenceRefs": []}
        comment = self.http.post(self.endpoint("discussions/comments"),
            json=body, headers=self.headers("SUP"))
        self.assertEqual(comment.status_code, 200, comment.text)
        inbox = self.endpoint("discussions/alerts")
        admin = self.http.get(inbox, headers=self.headers("ADM"),
            params={"unreadOnly": "true"})
        self.assertEqual(admin.status_code, 200, admin.text)
        alerts = admin.json()["items"]
        self.assertEqual(len(alerts), 1)
        self.assertEqual(self.http.get(inbox, headers=self.headers("CON")).json()["count"], 0)
        mark = self.http.post(self.endpoint("discussions/alerts/" + alerts[0]["id"] + "/read"),
            headers=self.headers("ADM"), json={"expectedVersion": 1})
        self.assertEqual(mark.status_code, 200, mark.text)
        self.assertEqual(mark.json()["alert"]["version"], 2)
        self.assertEqual(self.http.get(inbox, headers=self.headers("ADM"),
            params={"unreadOnly": "true"}).json()["count"], 0)
        self.assertNotEqual(self.http.post(self.endpoint("discussions/alerts/" + alerts[0]["id"] + "/read"),
            headers=self.headers("CON"), json={"expectedVersion": 2}).status_code, 200)
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Issue", issue["objectId"])["version"], issue["version"])
            self.assertTrue(any(event["event"] == "collaboration_alert_read"
                for event in self.store.meta["fieldDiscussionAudit"][self.project]))


if __name__ == "__main__":
    unittest.main()
