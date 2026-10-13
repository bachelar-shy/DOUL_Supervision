import unittest
from services.api.modules.photo_library import list_site_photos

class Engine:
    def __init__(self):
        self._records={
          ("Evidence","a"):{"id":"a","projectId":"p","version":1,"mediaType":"photo","metadata":{"name":"Column.jpg"},"createdAt":"2026-10-12T08:00:00Z","capturedAt":"2026-10-11T08:00:00Z","uploadedAt":"2026-10-12T08:00:00Z","locationId":"room"},
          ("Evidence","b"):{"id":"b","projectId":"other","mediaType":"photo"},
          ("Evidence","c"):{"id":"c","projectId":"p","mediaType":"document"}}
    def get(self, typ, ident): return {"partyId":"u","projectId":"p"}
    def authorize_read(self,item,party,role): pass
    def _scope(self, allowed, item, inherited): return item in allowed
class TestPhotoLibrary(unittest.TestCase):
    def test_filters_originals_and_projects(self):
        rows=list_site_photos(Engine(),"p","u","r",search="column")
        self.assertEqual([i["id"] for i in rows["items"]],["a"])
        self.assertEqual(rows["items"][0]["name"],"Column.jpg")
    def test_tag_and_capture_date(self):
        rows=list_site_photos(Engine(),"p","u","r",tag="steel",
                tag_overlays={"a":{"tags":["Steel"],"version":3}},capture_from="2026-10-10")
        self.assertEqual(rows["count"],1)
        self.assertEqual(rows["items"][0]["tagVersion"],3)
        self.assertEqual(list_site_photos(Engine(),"p","u","r",capture_from="2026-10-12")["count"],0)
    def test_no_cross_project_role(self):
        with self.assertRaises(Exception):list_site_photos(Engine(),"other","u","r")
    def test_invalid_limit(self):
        with self.assertRaises(Exception):list_site_photos(Engine(),"p","u","r",limit=999)
if __name__=="__main__":unittest.main()
