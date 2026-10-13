import unittest
from services.api.modules.field_checklists import validate_template,prepare_answers
T={"projectId":"p","version":2,"status":"published","items":[{"key":"a","label":"철근 간격","type":"number","required":True},{"key":"b","label":"상태","type":"pass_fail"}]}
class TestChecklists(unittest.TestCase):
    def test_draft_answer_not_official(self):
        self.assertEqual(prepare_answers(T,{"a":180,"b":"pass"})["status"],"draft")
    def test_partial_progress_is_allowed(self):
        self.assertEqual(prepare_answers(T,{"b":"pass"})["answers"],{"b":"pass"})
    def test_cannot_clear_required_item(self):
        with self.assertRaises(Exception):prepare_answers(T,{"a":None})
    def test_version_and_duplicate(self):
        x={**T,"items":[T["items"][0],T["items"][0]]}
        with self.assertRaises(Exception):validate_template(x)
    def test_max_500(self):
        x={**T,"items":[{"key":str(i),"label":"검측 "+str(i),"type":"pass_fail"} for i in range(500)]}
        self.assertEqual(len(validate_template(x)["items"]),500)
        with self.assertRaises(Exception):validate_template({**x,"items":x["items"]+[{"key":"501","label":"추가","type":"text"}]})
if __name__=="__main__":unittest.main()
