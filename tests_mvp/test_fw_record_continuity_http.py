"""Regression for checklist templates and historical collaboration access."""
import unittest

from app.reference.engine import uid
from tests_mvp.test_fw_five_integrated_http import FieldwireFiveHttpTests


class HistoricalFieldRecordsHTTP(unittest.TestCase):
    setUp = FieldwireFiveHttpTests.setUp
    tearDown = FieldwireFiveHttpTests.tearDown
    headers = FieldwireFiveHttpTests.headers
    endpoint = FieldwireFiveHttpTests.endpoint
    visible = FieldwireFiveHttpTests.visible

    def test_unpublished_checklist_templates_are_private(self):
        body = {"title": "철근 초안",
                "items": [{"key": "rebar", "label": "철근 간격", "type": "number"}]}
        response = self.http.post(self.endpoint("checklists/templates"),
                                  headers=self.headers("ADM"), json=body)
        self.assertEqual(response.status_code, 200, response.text)
        template_id = response.json()["template"]["id"]
        admin = self.http.get(self.endpoint("checklists/templates"), headers=self.headers("ADM"))
        self.assertIn(template_id, [row["id"] for row in admin.json()["items"]])
        contractor = self.http.get(self.endpoint("checklists/templates"), headers=self.headers("CON"))
        self.assertNotIn(template_id, [row["id"] for row in contractor.json()["items"]])
        published = self.http.post(self.endpoint("checklists/templates/" + template_id + "/publish"),
                                   headers=self.headers("ADM"), json={"expectedVersion": 1})
        self.assertEqual(published.status_code, 200, published.text)
        public = self.http.get(self.endpoint("checklists/templates"), headers=self.headers("SUP"))
        self.assertIn(template_id, [row["id"] for row in public.json()["items"]])

    def test_attached_checklist_remains_readable_after_official_version_advances(self):
        original = self.visible("Inspection", "ADM")
        template = self.http.post(self.endpoint("checklists/templates"),
                                  headers=self.headers("ADM"),
                                  json={"title": "기초 검측",
                                        "items": [{"key": "size", "label": "크기", "type": "number"}]})
        self.assertEqual(template.status_code, 200, template.text)
        template_id = template.json()["template"]["id"]
        published = self.http.post(self.endpoint("checklists/templates/" + template_id + "/publish"),
                                   headers=self.headers("ADM"), json={"expectedVersion": 1})
        self.assertEqual(published.status_code, 200, published.text)
        run = self.http.post(self.endpoint("checklists/runs"), headers=self.headers("ADM"),
                             json={"templateId": template_id, "templateVersion": 2, "subjectRef": original})
        self.assertEqual(run.status_code, 200, run.text)
        run_id = run.json()["run"]["id"]
        with self.store.transaction(write=True):
            record = self.store.engine.get("Inspection", original["objectId"])
            self.store.engine._save("Inspection", {**record, "version": record["version"] + 1,
                                                    "updatedAt": self.store.engine.at()})
        historical = self.http.get(self.endpoint("checklists/runs"), headers=self.headers("ADM"),
                                   params={"subjectId": original["objectId"]})
        self.assertEqual(historical.status_code, 200, historical.text)
        self.assertEqual(historical.json()["items"][0]["subjectRef"], original)
        saved = self.http.post(self.endpoint("checklists/runs/" + run_id + "/answers"),
                               headers=self.headers("ADM"),
                               json={"expectedVersion": 1, "answers": {"size": 180}})
        self.assertEqual(saved.status_code, 200, saved.text)
        stale_new_run = self.http.post(self.endpoint("checklists/runs"), headers=self.headers("ADM"),
                                       json={"templateId": template_id, "templateVersion": 2,
                                             "subjectRef": original})
        self.assertEqual(stale_new_run.status_code, 409, stale_new_run.text)
        with self.store.transaction():
            self.assertEqual(self.store.engine.get("Inspection", original["objectId"])["version"],
                             original["version"] + 1)

    def test_discussion_history_survives_issue_version_change(self):
        original = self.visible("Issue", "SUP")
        body = {"subjectRef": original, "message": "양생 상태 검토 요청",
                "mentionPartyIds": [], "evidenceRefs": []}
        first = self.http.post(self.endpoint("discussions/comments"), headers=self.headers("SUP"), json=body)
        self.assertEqual(first.status_code, 200, first.text)
        with self.store.transaction(write=True):
            old = self.store.engine.get("Issue", original["objectId"])
            self.store.engine._save("Issue", {**old, "version": old["version"] + 1,
                                              "updatedAt": self.store.engine.at()})
        for version in (original["version"], original["version"] + 1):
            history = self.http.get(self.endpoint("discussions"), headers=self.headers("SUP"),
                                    params={"subjectType": "Issue", "subjectId": original["objectId"],
                                            "version": version})
            self.assertEqual(history.status_code, 200, history.text)
            self.assertEqual(history.json()["count"], 1)
        stale_new_comment = self.http.post(self.endpoint("discussions/comments"),
                                           headers=self.headers("SUP"), json=body)
        self.assertEqual(stale_new_comment.status_code, 409, stale_new_comment.text)
        wrong_record = self.http.get(self.endpoint("discussions"), headers=self.headers("SUP"),
                                     params={"subjectType": "Issue", "subjectId": uid(), "version": 1})
        self.assertNotEqual(wrong_record.status_code, 200)


if __name__ == "__main__":
    unittest.main()
