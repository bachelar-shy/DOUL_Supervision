"""Non-demo authentication and release gates use synthetic keys/data only."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import os
import time
import unittest
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient

from app.reference.validation import ContractError
from app.reference.engine import uid
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter
from services.deployment.auth import PinnedJWT, subject_key
from services.deployment.gates import validate_store, validate_release_plan


class DeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.public = cls.private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.issuer = 'https://identity.example.invalid'
        cls.auth = PinnedJWT(cls.public, cls.issuer, 'doul-supervision', 'test-key-1')

    def setUp(self):
        self.store = SQLiteSnapshotAdapter(':memory:')
        self.addCleanup(self.store.close)
        self.environment = patch.dict(os.environ, {'DOUL_ENVIRONMENT':'staging',
            'DOUL_API_ALLOWED_HOSTS':'testserver,localhost,127.0.0.1',
            'DOUL_API_ALLOWED_ORIGINS':'https://testserver'}, clear=False)
        self.environment.start(); self.addCleanup(self.environment.stop)
        self.key = subject_key(self.issuer, 'synthetic-supervisor')
        self.actor = self.store.meta['actors']['SUP']
        with self.store.transaction(True):
            self.store.meta['provisioning'] = dict(environment='staging', snapshotFormat=1,
                approvedBy='SYNTHETIC-CI', approvalRef='test-only', syntheticData=True)
            self.store.meta['identityBindings'] = {self.key:dict(active=True, partyId=self.actor['partyId'],
                defaultRoleAssignmentId=self.actor['roleAssignmentId'], validAfter=0)}
        self.app = create_app(demo=False, persistence=self.store, authentication=self.auth)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def token(self, changes=None, headers=None, algorithm='RS256', key=None):
        now = int(time.time())
        claims = dict(sub='synthetic-supervisor', iss=self.issuer, aud='doul-supervision', iat=now, nbf=now, exp=now+600)
        if changes:
            for name,value in changes.items():
                if value is None: claims.pop(name,None)
                else: claims[name]=value
        return jwt.encode(claims, key or self.private, algorithm=algorithm, headers=headers or {'kid':'test-key-1','typ':'at+jwt'})

    def headers(self, token=None): return {'Authorization':'Bearer '+(token or self.token())}

    def test_verified_identity_uses_provisioned_role_not_claimed_admin(self):
        token = self.token({'roles':['ADM'], 'roleCode':'project_admin'})
        response = self.client.get('/projects/'+self.store.meta['projectId']+'/roles', headers=self.headers(token))
        self.assertEqual(response.status_code,200,response.text)
        self.assertTrue(all(row['partyId']==self.actor['partyId'] for row in response.json()))
        self.assertTrue(all(row['actorGroup']=='SUP' for row in response.json()))

    def test_wrong_signature_algorithm_key_or_header_rejected(self):
        other = rsa.generate_private_key(public_exponent=65537,key_size=2048)
        values = [self.token(key=other), self.token(headers={'kid':'unknown'}),
                  self.token(headers={'kid':'test-key-1','jku':'https://attacker.invalid/keys'}),
                  self.token(algorithm='HS256', key=b'synthetic-hmac-secret-for-negative-test')]
        for token in values:
            with self.subTest(token_type=token[:20]), self.assertRaises(ContractError): self.auth.verify(token)

    def test_claim_presence_types_audience_issuer_and_lifetime_enforced(self):
        now = int(time.time())
        cases = [{'aud':'other'}, {'iss':'https://other.invalid'}, {'nbf':None}, {'exp':now-100},
                 {'iat':now+100, 'nbf':now+100}, {'exp':now+7200}, {'iat':True}, {'sub':''},
                 {'aud':['doul-supervision','unexpected']}]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ContractError): self.auth.verify(self.token(changes))

    def test_unprovisioned_and_revoked_identities_rejected(self):
        with self.assertRaises(ContractError): self.auth.session(self.token({'sub':'unregistered'}),self.store)
        with self.store.transaction(True): self.store.meta['identityBindings'][self.key]['active']=False
        self.assertEqual(self.client.get('/projects/'+self.store.meta['projectId']+'/roles',headers=self.headers()).status_code,401)

    def test_credential_valid_after_and_disabled_party_rejected(self):
        with self.store.transaction(True): self.store.meta['identityBindings'][self.key]['validAfter']=int(time.time())+100
        self.assertEqual(self.client.get('/projects/'+self.store.meta['projectId']+'/roles',headers=self.headers()).status_code,401)
        with self.store.transaction(True):
            self.store.meta['identityBindings'][self.key]['validAfter']=0
            self.store.engine._records[('Party',self.actor['partyId'])]['loginEnabled']=False
        self.assertEqual(self.client.get('/projects/'+self.store.meta['projectId']+'/roles',headers=self.headers()).status_code,401)

    def test_service_actor_cannot_be_human_login(self):
        with self.store.transaction(True):
            actor=self.store.meta['serviceActors']['SYSTEM']
            self.store.meta['identityBindings'][self.key].update(partyId=actor['partyId'],defaultRoleAssignmentId=actor['roleAssignmentId'])
        with self.assertRaises(ContractError): self.auth.session(self.token(),self.store)

    def test_dev_routes_and_auto_documentation_absent(self):
        self.assertEqual(self.client.post('/dev/sessions',json={'actorGroup':'ADM'}).status_code,404)
        self.assertEqual(self.client.get('/dev/actors').status_code,404)
        self.assertEqual(self.client.get('/api-docs').status_code,404)
        self.assertEqual(self.client.get('/openapi.json').status_code,404)
        self.assertEqual(self.client.get('/health').json()['mode'],'staging')

    def test_project_and_role_escalation_denied(self):
        self.assertIn(self.client.get('/projects/'+uid()+'/roles',headers=self.headers()).status_code,[403,404])
        headers=self.headers();headers['X-RoleAssignment-ID']=self.store.meta['actors']['ADM']['roleAssignmentId']
        self.assertEqual(self.client.get('/projects/'+self.store.meta['projectId']+'/roles',headers=headers).status_code,403)

    def test_workspace_does_not_disclose_identity_binding_or_worker_ledger(self):
        with self.store.transaction(True): self.store.meta['workerJobs']={'private-job':{'source':'not-for-client'}}
        response=self.client.get('/projects/'+self.store.meta['projectId']+'/workspace',headers=self.headers())
        self.assertEqual(response.status_code,200,response.text)
        self.assertFalse(response.json()['demo'])
        self.assertNotIn('identityBindings',response.json()['context'])
        self.assertNotIn('workerJobs',response.json()['context'])
        self.assertNotIn('provisioning',response.json()['context'])

    def test_demo_and_synthetic_provisioning_cannot_activate_pilot(self):
        with self.assertRaises(RuntimeError): create_app(demo=True,persistence=self.store)
        with self.assertRaises(ValueError): validate_store(self.store,'pilot')
        with self.store.transaction(True): self.store.meta['provisioning']['environment']='pilot'
        with self.assertRaises(ValueError): validate_store(self.store,'pilot')

    def test_release_plan_requires_pinned_images_and_real_pilot_approval(self):
        plan=dict(schemaVersion=1,environment='staging',releaseSha='a'*40,
            images={name:'registry.invalid/doul/'+name+'@sha256:'+'b'*64 for name in ['api','worker','monitor','proxy']},
            publicUrl='https://staging.example.invalid',snapshotFormat=1,
            owners={name:'SYNTHETIC' for name in ['deployment','monitoring','onCall','backup','approval']},
            approval=dict(approvedBy='SYNTHETIC',recordRef='test-only',approvedAt=(datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat(),syntheticEnvironment=True),
            recovery=dict(backupReport='backup.json',restoreReport='restore.json',scheduleRef='schedule',keyCustodyRef='vault'),clockSource='host-ntp')
        self.assertIs(validate_release_plan(plan,'staging'),plan)
        bad=deepcopy(plan);bad['images']['api']='latest'
        with self.assertRaises(ValueError):validate_release_plan(bad,'staging')
        bad=deepcopy(plan);bad['environment']='pilot'
        with self.assertRaises(ValueError):validate_release_plan(bad,'pilot')
        bad=deepcopy(plan);bad['snapshotFormat']=2
        with self.assertRaises(ValueError):validate_release_plan(bad,'staging')


if __name__=='__main__': unittest.main()
