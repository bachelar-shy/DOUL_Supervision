import unittest
from services.api.modules.field_offline import replay_decision
I={"projectId":"p","actorId":"u","roleId":"r","requestKey":"stable-0001","expectedVersion":2,"command":"comment","payload":{}}
class TestOffline(unittest.TestCase):
 def test_exact_version(self):self.assertTrue(replay_decision(I,2,current_party_id="u",current_role_id="r",project_id="p")["autoSubmit"])
 def test_conflict_no_rebase(self):self.assertFalse(replay_decision(I,3,current_party_id="u",current_role_id="r",project_id="p")["autoSubmit"])
 def test_user_scope(self):
  with self.assertRaises(Exception):replay_decision(I,2,current_party_id="other",current_role_id="r",project_id="p")
if __name__=="__main__":unittest.main()

