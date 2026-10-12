"""Passwordless role selection must stay within the synthetic staging project."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption, PublicFormat
from fastapi.testclient import TestClient

from app.reference.engine import uid
from scripts.install_site_test_project import install
from services.api.main import create_app
from services.api.persistence import create_local_persistence
from services.deployment.auth import PinnedJWT
from services.deployment.password_auth import PasswordAccounts
from services.api.modules.synthetic_role_login import configured


class SyntheticQuickLoginHTTPTest(unittest.TestCase):
    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = create_local_persistence(str(Path(folder.name) / 'role.sqlite3'), demo=True)
        self.addCleanup(self.store.close)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private = Path(folder.name) / 'private.pem'
        private.write_bytes(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
        private.chmod(0o600)
        self.issuer = 'https://auth.doul.example'
        self.verifier = PinnedJWT(
            key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo),
            self.issuer, 'doul-supervision', 'test-synthetic-login')
        env = patch.dict(os.environ, {
            'DOUL_ENVIRONMENT': 'staging', 'DOUL_AUTH_MODE': 'local-password',
            'DOUL_TEST_ROLE_LOGIN': 'synthetic-only',
            'DOUL_AUTH_PRIVATE_KEY_FILE': str(private),
            'DOUL_API_ALLOWED_ORIGINS': 'https://app.example',
            'DOUL_API_ALLOWED_HOSTS': 'testserver',
            'DOUL_QUEUE_ENABLED': 'false',
        })
        env.start()
        self.addCleanup(env.stop)
        primary = self.store.meta['projectId']
        admin = self.store.meta['actors']['ADM']
        with self.store.transaction(write=True):
            for group in ('ADM', 'SUP', 'OWN', 'CON'):
                assignment = self.store.engine.get('RoleAssignment', self.store.meta['actors'][group]['roleAssignmentId'])
                self.store.engine.bootstrap('Party', dict(id=assignment['organizationId'], projectId=primary,
                    kind='ORGANIZATION', name='기존 ' + group + ' 회사', loginEnabled=False))
            self.store.meta['provisioning'] = dict(environment='staging', snapshotFormat=1,
                syntheticData=True, approvedBy='test-owner', approvalRef='test')
        accounts = PasswordAccounts(self.store, self.verifier)
        accounts.create(dict(actorGroup='ADM', projectId=primary), 'operator',
                        'Synthetic-Password-12', admin['partyId'], admin['roleAssignmentId'])
        self.marker = install(self.store, issuer=self.issuer, username='operator',
                              approval_ref='test', enable_project_settings=True)
        self.primary = primary
        self.project = self.marker['projectId']
        self.http = TestClient(create_app(demo=False, persistence=self.store, authentication=self.verifier))
        self.http.__enter__()
        self.addCleanup(lambda: self.http.__exit__(None, None, None))
        self.origin = {'Origin': 'https://app.example'}

    def quick(self, role):
        result = self.http.post('/auth/test-role-login', json={'role': role}, headers=self.origin)
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body['actor']['actorGroup'], role)
        self.assertEqual(body['projectId'], self.project)
        return {**self.origin, 'Authorization': 'Bearer ' + body['accessToken']}

    def test_four_buttons_issue_real_jwts_with_one_project_and_revoke(self):
        health = self.http.get('/health')
        self.assertTrue(health.json()['testRoleLogin'])
        with self.store.transaction():
            initial_projects = sum(k == 'Project' for k, _ in self.store.engine._records)
            initial_accounts = set(self.store.meta.get('passwordAccounts', {}))
        for role in ('OWN', 'CON', 'SUP', 'ADM'):
            header = self.quick(role)
            directory = self.http.get('/auth/projects', headers=header)
            self.assertEqual(directory.status_code, 200, directory.text)
            self.assertEqual(len(directory.json()['items']), 1)
            self.assertTrue(directory.json()['items'][0]['synthetic'])
            self.assertEqual(directory.json()['items'][0]['projectId'], self.project)
            workspace = self.http.get('/projects/' + self.project + '/workspace', headers=header)
            self.assertEqual(workspace.status_code, 200, workspace.text)
            self.assertEqual(workspace.json()['context']['dataClassification'],
                             'SYNTHETIC_TEST_NOT_SITE_EVIDENCE')
            self.assertEqual(self.http.get('/projects/' + self.primary + '/workspace', headers=header).status_code, 404)
            self.assertEqual(self.http.post('/auth/project-session', headers=header,
                            json={'projectId': self.primary}).status_code, 403)
            if role == 'ADM':
                self.assertEqual(self.http.get('/projects/' + self.project + '/settings', headers=header).status_code, 200)
                self.assertEqual(self.http.post('/projects/' + self.project + '/settings/projects',
                    headers={**header, 'Idempotency-Key': uid()},
                    json=dict(name='Not allowed', country='VN', timezone='Asia/Ho_Chi_Minh',
                              classification='', organizationName='Not allowed')).status_code, 403)
            else:
                self.assertEqual(self.http.get('/projects/' + self.project + '/settings', headers=header).status_code, 403)
            self.assertEqual(self.http.post('/auth/logout', headers=header).status_code, 200)
            self.assertEqual(self.http.get('/auth/projects', headers=header).status_code, 401)
        with self.store.transaction():
            self.assertEqual(sum(k == 'Project' for k, _ in self.store.engine._records), initial_projects)
            self.assertEqual(set(self.store.meta.get('passwordAccounts', {})), initial_accounts)

    def test_request_flows_from_contractor_to_project_administrator(self):
        con = self.quick('CON')
        adm = self.quick('ADM')
        payload = dict(name='추가 시험 직원', organization='테스트 시공사',
                       requestedRole='CON', reason='현장 기록 인력 보강')
        path = '/projects/' + self.project + '/personnel-requests'
        result = self.http.post(path, headers={**con, 'Idempotency-Key': uid()}, json=payload)
        self.assertEqual(result.status_code, 200, result.text)
        created = result.json()['record']
        self.assertEqual(self.http.get(path, headers=adm).json()['pendingCount'], 1)
        decision = self.http.post(path + '/' + created['id'] + '/decision',
            headers={**adm, 'Idempotency-Key': uid()},
            json={'expectedVersion': 1, 'status': 'approved', 'note': '검토 완료'})
        self.assertEqual(decision.status_code, 200, decision.text)
        self.assertFalse(decision.json()['accountCreated'])
        self.assertEqual(self.http.get(path, headers=con).json()['items'][0]['status'], 'approved')

    def test_disabled_flag_invalid_payload_origin_and_pilot_guard(self):
        for data in ({}, {'role': 'DES'}, {'role': 'ADM', 'projectId': self.primary},
                     {'role': []}, {'role': None}):
            bad = self.http.post('/auth/test-role-login', headers=self.origin, json=data)
            self.assertEqual(bad.status_code, 422, bad.text)
        self.assertEqual(self.http.post('/auth/test-role-login',
            json={'role': 'ADM'}, headers={'Origin': 'https://other.example'}).status_code, 403)
        self.assertEqual(self.http.post('/auth/test-role-login', json={'role': 'ADM'}).status_code, 403)
        session = self.quick('CON')
        with patch.dict(os.environ, {'DOUL_TEST_ROLE_LOGIN': ''}):
            app = create_app(demo=False, persistence=self.store, authentication=self.verifier)
            with TestClient(app) as client:
                self.assertFalse(client.get('/health').json()['testRoleLogin'])
                self.assertEqual(client.post('/auth/test-role-login',
                    headers=self.origin, json={'role': 'ADM'}).status_code, 403)
                self.assertEqual(client.get('/auth/projects', headers=session).status_code, 401)
        with self.assertRaises(RuntimeError):
            configured('pilot', demo=False, password_accounts=object())
        with self.assertRaises(RuntimeError):
            configured('staging', demo=False, password_accounts=None)
        with self.assertRaises(RuntimeError):
            with patch.dict(os.environ, {'DOUL_TEST_ROLE_LOGIN': 'true'}):
                configured('staging', demo=False, password_accounts=object())


if __name__ == '__main__':
    unittest.main()
