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

    def test_contract_creation_capabilities_follow_current_role_and_eot_is_server_denied(self):
        sessions = {}
        headers = {}
        capabilities = {}
        for actor in ('CON', 'OWN', 'SUP', 'ADM'):
            sessions[actor], headers[actor] = self.login(actor)
            capabilities[actor] = self.workspace(sessions[actor], headers[actor])[
                'context'
            ]['creationCapabilities']

        # These are the authority-matrix grants for machine creation, evaluated
        # for each current assignment by the real workspace HTTP endpoint.
        expected = {
            # Although owner_representative appears in the policy role-code
            # list, the authority also requires contractor organization scope;
            # the demo OWN assignment is therefore correctly denied.
            'contract_notice': {'CON': True, 'OWN': False, 'SUP': True, 'ADM': False},
            'claim': {'CON': True, 'OWN': False, 'SUP': False, 'ADM': False},
            'eot_request': {'CON': True, 'OWN': False, 'SUP': False, 'ADM': False},
        }
        for machine, actor_grants in expected.items():
            for actor, can_create in actor_grants.items():
                with self.subTest(machine=machine, actor=actor):
                    entry = capabilities[actor][machine]
                    self.assertEqual(entry['canCreate'], can_create, entry)
                    self.assertEqual(entry['status'], 'available' if can_create else 'unauthorized', entry)

        # A visible capability never replaces server-side authorization. The
        # payload is structurally valid so denial is attributable to authority.
        owner = sessions['OWN']
        denied = self.client.post(
            '/projects/' + owner['projectId'] + '/eot-requests',
            headers={**headers['OWN'], 'Idempotency-Key': uid()},
            json={
                'roleAssignmentId': owner['actor']['roleAssignmentId'],
                'clientObjectId': uid(),
                'payload': {
                    **self.workspace(owner, headers['OWN'])['context']['scope'],
                    'title': 'Unauthorized EOT draft',
                    'data': {'eotNo': 'EOT-CAP-403'},
                },
            },
        )
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(denied.json()['code'], 'NOT_AUTHORIZED')

    def test_qualification_revocation_is_visible_on_next_read(self):
        session, headers = self.login('SUP')
        before = self.workspace(session, headers)['context']['creationCapabilities']
        self.assertTrue(before['issue']['canCreate'])
        # Contract notice creation is not qualification-gated; the assignment
        # is still evaluated on every read, but unrelated qualification
        # revocation must not change this separate authority grant.
        self.assertTrue(before['contract_notice']['canCreate'])
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
        self.assertTrue(after['contract_notice']['canCreate'])

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
