import unittest
from services.api.modules.field_checklists import validate_template,prepare_answers
T={"projectId":"p","version":2,"status":"published","items":[{"key":"a","label":"철근 간격","type":"number","required":True},{"key":"b","label":"상태","type":"pass_fail"}]}
class TestChecklists(unittest.TestCase):
 def test_draft_answer_not_official(self):self.assertEqual(prepare_answers(T,{"a":180,"b":"pass"})["status"],"draft")
 def test_required(self):
  with self.assertRaises(Exception):prepare_answers(T,{"b":"pass"})
 def test_version_and_duplicate(self):
  x={**T,"items":[T["items"][0],T["items"][0]]}
  with self.assertRaises(Exception):validate_template(x)
if __name__=="__main__":unittest.main()

