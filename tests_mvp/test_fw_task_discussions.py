import unittest
from services.api.modules.task_discussions import make_task_comment
R={"objectType":"Issue","objectId":"issue1","version":1}
class TestTaskComments(unittest.TestCase):
 def test_conversation_not_approval(self):
  x=make_task_comment(project_id="p",work_ref=R,author_party_id="u",role_assignment_id="r",message="현장 확인 바랍니다")
  self.assertFalse(x["officialDecision"])
 def test_version_required(self):
  with self.assertRaises(Exception):make_task_comment(project_id="p",work_ref={**R,"version":0},author_party_id="u",role_assignment_id="r",message="x")
 def test_mentions_not_duplicated(self):
  with self.assertRaises(Exception):make_task_comment(project_id="p",work_ref=R,author_party_id="u",role_assignment_id="r",message="x",mentions=["a","a"])
if __name__=="__main__":unittest.main()

