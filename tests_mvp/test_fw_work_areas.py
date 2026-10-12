import unittest
from services.api.modules.work_areas import work_area_path
class TestWorkAreas(unittest.TestCase):
 def test_site_label_path(self):
  items=[{"id":"a","name":"A동","treeParentRef":None},{"id":"b","name":"2층","treeParentRef":{"objectId":"a"}}]
  self.assertEqual(work_area_path(items,"b"),"A동 / 2층")
 def test_cycle_refused(self):
  items=[{"id":"a","name":"A","treeParentRef":{"objectId":"b"}},{"id":"b","name":"B","treeParentRef":{"objectId":"a"}}]
  with self.assertRaises(Exception):work_area_path(items,"a")
if __name__=="__main__":unittest.main()

