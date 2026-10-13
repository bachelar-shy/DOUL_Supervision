"""Today pin feed projects only authorized drawing pins from the current project."""
from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest

class DrawingPinActivityHTTPTests(DrawingSheetHTTPTest):
    def test_pin_index_count_coordinates_and_reply_refresh(self):
        self.assertEqual(self.upload().status_code, 202)
        adm, own = self.quick("ADM"), self.quick("OWN")
        first = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=adm).json()["items"][0]
        base = "/projects/" + self.project + "/drawing-sheets"
        def add(kind, x, y):
            request = self.http.post(base + "/" + first["id"] + "/pins",
                headers={**adm,"Idempotency-Key": uid()},
                json={"kind":kind,"x":x,"y":y,"comment":"test "+kind,"recordRef":None})
            self.assertEqual(request.status_code, 200, request.text)
            return request.json()["pin"]
        issue = add("issue", 0.41, 0.72)
        add("inspection", 0.15, 0.25)
        add("site", 0.73, 0.55)
        for role in (adm, own):
            response = self.http.get(base + "/pin-index", headers=role)
            self.assertEqual(response.status_code, 200, response.text)
            index = response.json()
            self.assertEqual(index["count"], 3)
            self.assertEqual({pin["kind"] for pin in index["items"]},
                             {"issue", "inspection", "site"})
            self.assertEqual({pin["sheetNumber"] for pin in index["items"]}, {first["number"]})
            self.assertEqual(next(x["x"] for x in index["items"] if x["pinId"] == issue["id"]), .41)
        index = self.http.get(base + "/pin-index", headers=adm).json()
        entry = next(x for x in index["items"] if x["pinId"] == issue["id"])
        self.assertEqual(entry["replyCount"], 0)
        self.assertIsNone(entry["latestReply"])
        self.assertEqual(self.http.get(base + "/pin-index").status_code, 401)
        self.assertIn(self.http.get(
            "/projects/" + self.primary + "/drawing-sheets/pin-index", headers=adm).status_code,
            (403, 404))
