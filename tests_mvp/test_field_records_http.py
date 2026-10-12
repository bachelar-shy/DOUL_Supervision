"""Read/write field record drafts across isolated project role sessions."""
import unittest

from app.reference.engine import uid
from tests_mvp.test_synthetic_role_login_http import SyntheticQuickLoginHTTPTest


class FieldRecordsHTTPTest(unittest.TestCase):
    def setUp(self):
        SyntheticQuickLoginHTTPTest.setUp(self)

    def quick(self, role):
        return SyntheticQuickLoginHTTPTest.quick(self, role)

    def create(self, role, payload=None, key=None):
        path = "/projects/" + self.project + "/field-records"
        body = payload or {
            "recordType": "daily", "title": "현장 기록 테스트", "recordDate": "2026-10-12",
            "locationId": "", "description": "현장 확인사항 및 진행 상황",
            "evidenceIds": [],
        }
        return self.http.post(path, headers={**self.quick(role), "Idempotency-Key": key or uid()}, json=body)

    def test_con_sup_adm_can_save_drafts_with_private_visibility_and_audit(self):
        con = self.quick("CON")
        sup = self.quick("SUP")
        adm = self.quick("ADM")
        own = self.quick("OWN")
        path = "/projects/" + self.project + "/field-records"

        payload = dict(recordType="daily", title="점검 현장일보",
                       recordDate="2026-10-12", locationId="",
                       description="가설·안전·품질 상태를 현장에서 확인함", evidenceIds=[])
        key = uid()
        res = self.http.post(path, headers={**con, "Idempotency-Key": key}, json=payload)
        self.assertEqual(res.status_code, 200, res.text)
        record = res.json()["record"]
        self.assertEqual(record["status"], "draft")
        self.assertEqual(record["projectId"], self.project)
        self.assertEqual(record["createdByRole"], "CON")
        self.assertEqual(self.http.post(path, headers={**con, "Idempotency-Key": key}, json=payload).json(), res.json())
        self.assertEqual(self.http.post(path, headers={**con, "Idempotency-Key": key},
                                       json={**payload,"title":"changed"}).status_code, 409)
        self.assertEqual(self.http.get(path, headers=con).json()["count"], 1)
        self.assertEqual(self.http.get(path, headers=sup).json()["count"], 0)
        self.assertEqual(self.http.get(path, headers=own).json()["count"], 0)
        self.assertEqual(self.http.get(path, headers=adm).json()["count"], 1)

        sup_result = self.http.post(path, headers={**sup, "Idempotency-Key": uid()}, json=dict(
            payload, title="감리 기록", description="현장 감리자 별도 메모",
            recordType="inspection_support"))
        self.assertEqual(sup_result.status_code, 200, sup_result.text)
        self.assertEqual(self.http.get(path, headers=sup).json()["count"], 1)
        self.assertEqual(self.http.get(path, headers=con).json()["count"], 1)
        self.assertEqual(self.http.get(path, headers=adm).json()["count"], 2)

        admin_result = self.http.post(path, headers={**adm, "Idempotency-Key": uid()},
                                      json={**payload,"title":"관리자 메모"})
        self.assertEqual(admin_result.status_code, 200, admin_result.text)
        self.assertEqual(self.http.get(path, headers=adm).json()["count"], 3)
        self.assertEqual(self.http.post(path, headers={**own, "Idempotency-Key": uid()}, json=payload).status_code, 403)
        with self.store.transaction():
            events = self.store.meta["fieldRecordAudit"][self.project]
            self.assertEqual(len(events), 3)
            self.assertEqual({event["event"] for event in events}, {"draft_created"})
        # A separately opened adapter must recover the durable records.
        from services.api.persistence import create_local_persistence
        database_file = self.store.db.execute('PRAGMA database_list').fetchone()[2]
        reopened = create_local_persistence(database_file, demo=False)
        try:
            with reopened.transaction():
                self.assertEqual(len(reopened.meta["fieldRecordDrafts"][self.project]), 3)
                self.assertEqual(len(reopened.meta["fieldRecordAudit"][self.project]), 3)
        finally:
            reopened.close()


    def test_rejects_invalid_field_values_forged_evidence_and_cross_project(self):
        path="/projects/" + self.project + "/field-records"
        con = self.quick("CON")
        adm = self.quick("ADM")
        body = dict(recordType="daily", title="유효 제목", recordDate="2026-10-12",
                    description="확인한 내용", locationId="", evidenceIds=[])
        for wrong in (
            dict(body, recordType="other", description=" "),
            dict(body, recordType="ADMIN"),
            dict(body, recordDate="2026-02-30"),
            dict(body, evidenceIds=[uid()]),
            dict(body, evidenceIds=[uid(), uid()], requestedRole="ADM"),
            dict(body, locationId=uid()),
            dict(body, evidenceIds=[12]),
        ):
            response = self.http.post(path, headers={**con, "Idempotency-Key": uid()}, json=wrong)
            self.assertNotEqual(response.status_code, 200, response.text)
        self.assertEqual(self.http.get("/projects/" + self.primary + "/field-records",headers=adm).status_code,404)
        self.assertEqual(self.http.post("/projects/" + self.primary + "/field-records",
            headers={**adm, "Idempotency-Key": uid()},json=body).status_code,404)
        self.assertEqual(self.http.get(path).status_code,401)


if __name__ == "__main__":
    unittest.main()
