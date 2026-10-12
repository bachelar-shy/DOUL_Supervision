import unittest
from services.api.modules.photo_library import list_site_photos
class Engine:
 def __init__(self):
  self._records={("Evidence","a"):{"id":"a","projectId":"p","mimeType":"image/jpeg","filename":"Column.jpg","createdAt":"2026-10-12"},("Evidence","b"):{"id":"b","projectId":"other","mimeType":"image/jpeg"},("Evidence","c"):{"id":"c","projectId":"p","mimeType":"application/pdf"}}
 def get(self,typ,ident):return {"partyId":"u","projectId":"p"} 
 def authorize_read(self,item,party,role):pass
class TestPhotoLibrary(unittest.TestCase):
 def test_filters_originals_and_projects(self):
  rows=list_site_photos(Engine(),"p","u","r",search="column")
  self.assertEqual([i["id"] for i in rows["items"]],["a"])
 def test_no_cross_project_role(self):
  with self.assertRaises(Exception):list_site_photos(Engine(),"other","u","r")
 def test_invalid_limit(self):
  with self.assertRaises(Exception):list_site_photos(Engine(),"p","u","r",limit=999)
if __name__=="__main__":unittest.main()

