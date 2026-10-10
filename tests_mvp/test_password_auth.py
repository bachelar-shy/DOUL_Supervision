import os
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding,PrivateFormat,NoEncryption,PublicFormat
from app.reference.validation import ContractError
from services.api.persistence import create_local_persistence
from services.deployment.auth import PinnedJWT
from services.deployment.password_auth import PasswordAccounts

class PasswordAccountsTest(unittest.TestCase):
    def setUp(self):
        self.store=create_local_persistence(':memory:',demo=True)
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        self.private=key.private_bytes(Encoding.PEM,PrivateFormat.PKCS8,NoEncryption()).decode()
        public=key.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo)
        self.verifier=PinnedJWT(public,'https://auth.doul.example','doul-supervision','test-key')
        self.patch=patch.dict(os.environ, {'DOUL_AUTH_PRIVATE_KEY':self.private,'DOUL_ENVIRONMENT':'development'})
        self.patch.start()
        self.accounts=PasswordAccounts(self.store,self.verifier)
        self.admin=self.store.meta['actors']['ADM']
        self.user=self.store.meta['actors']['SUP']
        self.project=self.store.meta['projectId']
        self.accounts.create(dict(actorGroup='ADM',projectId=self.project),'operator','Secure-Password-12',self.admin['partyId'],self.admin['roleAssignmentId'])

    def tearDown(self):
        self.patch.stop();self.store.close()

    def test_create_login_role_and_logout_revocation(self):
        admin=self.accounts.login('operator','Secure-Password-12')
        self.assertEqual(admin['actor']['actorGroup'],'ADM')
        self.accounts.create(dict(actorGroup='ADM',projectId=self.project),'supervisor','Secure-Password-34',self.user['partyId'],self.user['roleAssignmentId'])
        session=self.accounts.login('supervisor','Secure-Password-34')
        self.assertEqual(session['actor']['actorGroup'],'SUP')
        self.assertFalse(self.accounts.is_revoked(session['accessToken']))
        self.accounts.revoke(session['accessToken'])
        self.assertTrue(self.accounts.is_revoked(session['accessToken']))

    def test_bad_password_account_lock_and_no_plaintext_storage(self):
        self.assertNotIn('Secure-Password-12',str(self.store.meta['passwordAccounts']))
        for _ in range(5):
            with self.assertRaises(ContractError):self.accounts.login('operator','wrong')
        with self.assertRaises(ContractError):self.accounts.login('operator','Secure-Password-12')
        self.assertGreater(self.store.meta['passwordAccounts']['operator']['blockedUntil'],0)

    def test_no_self_signup_and_no_foreign_role(self):
        with self.assertRaises(ContractError):self.accounts.create(dict(actorGroup='SUP',projectId=self.project),'baduser','Secure-Password-34',self.user['partyId'],self.user['roleAssignmentId'])
        with self.assertRaises(ContractError):self.accounts.create(dict(actorGroup='ADM',projectId=self.project),'short','x',self.user['partyId'],self.user['roleAssignmentId'])
        with self.assertRaises(ContractError):self.accounts.create(dict(actorGroup='ADM',projectId=self.project),'foreign','Secure-Password-34',self.admin['partyId'],self.user['roleAssignmentId'])

if __name__=='__main__':unittest.main()
