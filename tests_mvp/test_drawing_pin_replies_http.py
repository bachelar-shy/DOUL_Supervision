"""A drawing-pin conversation is persistent and never alters formal approval state."""
from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest

class DrawingPinRepliesHTTPTests(DrawingSheetHTTPTest):
    def test_reply_parent_idempotency_and_project_isolation(self):
        self.assertEqual(self.upload().status_code, 202)
        adm, own, con = self.quick("ADM"), self.quick("OWN"), self.quick("CON")
        sheet = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=adm).json()["items"][0]
        base = "/projects/" + self.project + "/drawing-sheets/" + sheet["id"]
        pin_request = self.http.post(base + "/pins", headers={**con, "Idempotency-Key": uid()},
            json={"x": 0.22, "y": 0.67, "kind": "issue", "comment": "현장 방수 시공",
                  "recordRef": None})
        self.assertEqual(pin_request.status_code, 200, pin_request.text)
        pin = pin_request.json()["pin"]
        endpoint = base + "/pins/" + pin["id"] + "/replies"
        self.assertEqual(self.http.get(endpoint, headers=own).json()["count"], 0)
        first_body = {"message": "현장 확인 바랍니다", "parentId": None}
        key = uid()
        first = self.http.post(endpoint, headers={**con, "Idempotency-Key": key},
                               json=first_body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["reply"]["kind"], "discussion")
        self.assertFalse(first.json()["reply"]["officialDecision"])
        self.assertEqual(first.json()["reply"]["authorRole"], "CON")
        self.assertEqual(self.http.post(endpoint, headers={**con, "Idempotency-Key": key},
                           json=first_body).json(), first.json())
        second_pin = self.http.post(base + "/pins",
            headers={**con, "Idempotency-Key": uid()},
            json={"x": 0.43, "y": 0.55, "kind": "issue",
                  "comment": "다른 작업 위치", "recordRef": None})
        self.assertEqual(second_pin.status_code, 200, second_pin.text)
        second_endpoint = base + "/pins/" + second_pin.json()["pin"]["id"] + "/replies"
        # Same user, key, message and sheet cannot replay a different pin's reply.
        cross = self.http.post(second_endpoint,
            headers={**con, "Idempotency-Key": key}, json=first_body)
        self.assertEqual(cross.status_code, 409, cross.text)
        self.assertEqual(self.http.get(second_endpoint, headers=adm).json()["count"], 0)
        reply = self.http.post(endpoint, headers={**own, "Idempotency-Key": uid()},
              json={"message": "현장 방문 후 회신하겠습니다", "parentId": first.json()["reply"]["id"]})
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()["reply"]["authorRole"], "OWN")
        self.assertEqual(reply.json()["reply"]["parentId"], first.json()["reply"]["id"])
        thread = self.http.get(endpoint, headers=adm).json()
        self.assertEqual(thread["count"], 2)
        self.assertEqual(thread["items"][1]["id"], reply.json()["reply"]["id"])
        self.assertEqual(self.http.get(base + "/pins", headers=adm).json()["items"][0]["version"], pin["version"])
        self.assertEqual(self.http.post(endpoint, headers={**con, "Idempotency-Key": key},
                          json={"message": "changed", "parentId": None}).status_code, 409)
        for bad in [{"message": "", "parentId": None},
                    {"message": "x", "parentId": "foreign"},
                    {"message": "x", "parentId": None, "officialDecision": True},
                    {"message": "x" * 4001, "parentId": None}]:
            self.assertNotEqual(self.http.post(endpoint,
                 headers={**con, "Idempotency-Key": uid()}, json=bad).status_code, 200)
        self.assertEqual(self.http.get(endpoint).status_code, 401)
        primary = endpoint.replace(self.project, self.primary)
        self.assertIn(self.http.get(primary, headers=adm).status_code, (403, 404))
        with self.store.transaction():
            self.assertTrue(self.store.meta.get("drawingPinReplies", {}).get(self.project))
            audit = self.store.meta["drawingSheetAudit"][self.project]
            self.assertTrue(any(row["event"] == "drawing_pin_reply_created" for row in audit))
