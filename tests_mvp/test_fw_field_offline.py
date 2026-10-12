import unittest
from services.api.modules.field_offline import replay_decision
I={"projectId":"p","actorId":"u","roleId":"r","machine":"issue","itemId":"item-1","requestKey":"stable-0001","expectedVersion":2,"command":"respond","payload":{},"evidenceIds":[]}
class TestOffline(unittest.TestCase):
    def test_exact_version(self):
        self.assertTrue(replay_decision(I,2,current_party_id="u",current_role_id="r",project_id="p")["autoSubmit"])
    def test_conflict_no_rebase(self):
        res=replay_decision(I,3,current_party_id="u",current_role_id="r",project_id="p")
        self.assertFalse(res["autoSubmit"])
        self.assertEqual(res["requestKey"],"stable-0001")
    def test_user_scope(self):
        with self.assertRaises(Exception):replay_decision(I,2,current_party_id="other",current_role_id="r",project_id="p")
    def test_no_missing_expected_version(self):
        with self.assertRaises(Exception):replay_decision({**I,"expectedVersion":None},3,current_party_id="u",current_role_id="r",project_id="p")
if __name__=="__main__":unittest.main()
