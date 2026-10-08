"""Actual workspace capabilities must follow current server assignments.

Configuration mutations below model trusted revocation/provisioning; the
capability reads and attempted creations use the real HTTP adapter.
"""
from fastapi.testclient import TestClient
import unittest

from app.reference.engine import uid
from services.api.main import create_app


class CreationCapabilitiesHttpTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(demo=True, queue_enabled=False)
        self.client = TestClient(self.app)
        self.addCleanup(self.app.state.store.close)
        self.addCleanup(self.client.close)

    def login(self, actor):
        response = self.client.post('/dev/sessions', json={'actorGroup': actor})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        headers = {'Authorization': 'Bearer ' + session['accessToken'],
                   'X-RoleAssignment-Id': session['actor']['roleAssignmentId']}
        return session, headers

    def workspace(self, session, headers):
        response = self.client.get('/projects/' + session['projectId'] + '/workspace', headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_role_switch_changes_creation_rights_and_http_still_enforces_them(self):
        sup, sup_headers = self.login('SUP')
        con, con_headers = self.login('CON')
        own, own_headers = self.login('OWN')
        supervisor = self.workspace(sup, sup_headers)['context']['creationCapabilities']
        contractor = self.workspace(con, con_headers)['context']['creationCapabilities']
        owner_workspace = self.workspace(own, own_headers)
        owner = owner_workspace['context']['creationCapabilities']
        self.assertTrue(supervisor['contract_boq']['canCreate'])
        self.assertFalse(supervisor['payment_claim']['canCreate'])
        self.assertTrue(contractor['payment_claim']['canCreate'])
        self.assertFalse(owner['payment_claim']['canCreate'])
        self.assertEqual(owner['payment_claim']['status'], 'unauthorized')
        response = self.client.post('/projects/' + own['projectId'] + '/payment-claims',
            headers={**own_headers, 'Idempotency-Key': uid()},
            json={'roleAssignmentId': own['actor']['roleAssignmentId'], 'clientObjectId': uid(),
                  'payload': {**owner_workspace['context']['scope'], 'title': 'Denied owner draft',
                              'data': {'paymentClaimNo': 'CAP-403'}}})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'NOT_AUTHORIZED')

    def test_qualification_revocation_is_visible_on_next_read(self):
        session, headers = self.login('SUP')
        before = self.workspace(session, headers)['context']['creationCapabilities']
        self.assertTrue(before['issue']['canCreate'])
        store = self.app.state.store
        with store.transaction(True):
            role = store.engine.get('RoleAssignment', session['actor']['roleAssignmentId'])
            qualification = store.engine.get('Qualification', role['qualificationIds'][0])
            qualification.update(revoked=True, version=qualification['version'] + 1)
            store.engine._save('Qualification', qualification)
        after = self.workspace(session, headers)['context']['creationCapabilities']
        self.assertFalse(after['issue']['canCreate'])
        self.assertEqual(after['issue']['status'], 'prerequisites_missing')
        self.assertEqual(after['issue']['reasons'], ['QUALIFICATION_INVALID'])

    def test_unconfigured_scope_fails_closed_without_fabricating_defaults(self):
        session, headers = self.login('SUP')
        with self.app.state.store.transaction(True):
            self.app.state.store.meta.pop('scope')
        workspace = self.workspace(session, headers)
        self.assertNotIn('scope', workspace['context'])
        for capability in workspace['context']['creationCapabilities'].values():
            self.assertFalse(capability['canCreate'])
        self.assertEqual(workspace['context']['creationCapabilities']['contract_boq']['status'],
                         'prerequisites_missing')

    def test_unavailable_queue_does_not_disable_other_creation(self):
        session, headers = self.login('SUP')
        capabilities = self.workspace(session, headers)['context']['creationCapabilities']
        self.assertEqual(capabilities['analysis_run']['status'], 'unavailable')
        self.assertEqual(capabilities['analysis_run']['reasons'], ['ANALYSIS_QUEUE_UNAVAILABLE'])
        self.assertTrue(capabilities['contract_boq']['canCreate'])


if __name__ == '__main__':
    unittest.main()
