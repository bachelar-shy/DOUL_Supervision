"""Drawing markups are role-gated, versioned, reversible and source-PDF-safe."""
import unittest
from app.reference.engine import uid
from tests_mvp.test_drawing_sheet_catalog_http import DrawingSheetHTTPTest

class DrawingSheetMarkupHTTPTests(DrawingSheetHTTPTest):
    def test_markup_lifecycle(self):
        adm = self.quick("ADM")
        own = self.quick("OWN")
        created = self.upload()
        self.assertEqual(created.status_code, 202)
        sheet = self.http.get("/projects/" + self.project + "/drawing-sheets", headers=adm).json()["items"][0]
        url = "/projects/" + self.project + "/drawing-sheets/" + sheet["id"] + "/markups"
        body = dict(sheetVersion=sheet["version"], tool="pen",
                    points=[{"x":0.2,"y":0.3},{"x":0.5,"y":0.6}],
                    color="#ff6600", lineWidth=3, text="")
        key = uid()
        result = self.http.post(url, headers={**adm,"Idempotency-Key":key}, json=body)
        self.assertEqual(result.status_code, 200, result.text)
        item = result.json()["markup"]
        self.assertEqual(item["status"], "active")
        self.assertEqual(self.http.post(url,headers={**adm,"Idempotency-Key":key},json=body).json(), result.json())
        other = self.http.get("/projects/" + self.project +
            "/drawing-sheets", headers=adm).json()["items"][1]
        other_url = "/projects/" + self.project + "/drawing-sheets/" + other["id"] + "/markups"
        # Same payload and request key must not return another drawing's markup.
        cross = self.http.post(other_url, headers={**adm, "Idempotency-Key": key},
                               json={**body, "sheetVersion": other["version"]})
        self.assertEqual(cross.status_code, 409, cross.text)
        self.assertEqual(self.http.get(other_url, headers=adm).json()["count"], 0)
        self.assertEqual(self.http.get(url,headers=own).json()["count"], 1)
        self.assertEqual(self.http.post(url,headers={**own,"Idempotency-Key":uid()},json=body).status_code,403)
        self.assertEqual(self.http.post(url,headers={**adm,"Idempotency-Key":uid()},
            json={**body,"points":[{"x":-0.1,"y":0.1}]}).status_code,422)
        path=url+"/"+item["id"]+"/archive"
        archived=self.http.post(path,headers={**adm,"Idempotency-Key":uid()},json={"expectedVersion":1})
        self.assertEqual(archived.status_code,200,archived.text)
        self.assertEqual(archived.json()["markup"]["version"],2)
        self.assertEqual(self.http.get(url,headers=own).json()["count"],0)
        restored=self.http.post(url+"/"+item["id"]+"/restore",headers={**adm,"Idempotency-Key":uid()},
                                json={"expectedVersion":2})
        self.assertEqual(restored.status_code,200,restored.text)
        self.assertEqual(self.http.get(url,headers=own).json()["count"],1)

if __name__ == "__main__":
    unittest.main()
