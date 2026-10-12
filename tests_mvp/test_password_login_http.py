"""Exercise real HTTP credential issuance and current server authorization on a synthetic store."""
import os
import tempfile
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding,PrivateFormat,NoEncryption,PublicFormat
from fastapi.testclient import TestClient
from services.api.persistence import create_local_persistence
from services.api.main import create_app
from services.deployment.auth import PinnedJWT
from services.deployment.password_auth import PasswordAccounts

class PasswordLoginHTTPTest(unittest.TestCase):
    def test_admin_creation_role_boundary_logout(self):
        store=create_local_persistence(':memory:',demo=True)
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        public=key.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo)
        private=key.private_bytes(Encoding.PEM,PrivateFormat.PKCS8,NoEncryption())
        verifier=PinnedJWT(public,'https://auth.doul.example','doul-supervision','test-key')
        with tempfile.TemporaryDirectory() as d:
            filename=os.path.join(d,'private.pem')
            with open(filename,'wb') as f:f.write(private)
            os.chmod(filename,0o600)
            env=patch.dict(os.environ,{'DOUL_AUTH_PRIVATE_KEY_FILE':filename,'DOUL_ENVIRONMENT':'staging','DOUL_AUTH_MODE':'local-password','DOUL_API_ALLOWED_ORIGINS':'https://app.example'},clear=False)
            with env, patch('services.deployment.gates.validate_store'),patch('services.deployment.gates.https_origins',return_value=['https://app.example']),patch('services.deployment.gates.allowed_hosts',return_value=['testserver']):
                pwd=PasswordAccounts(store,verifier)
                admin=store.meta['actors']['ADM'];supervisor=store.meta['actors']['SUP']
                # Match the project-wide administrator assignment used by operational settings.
                with store.transaction(write=True):
                    original=store.engine.get('RoleAssignment',admin['roleAssignmentId'])
                    revised=dict(original,version=original['version']+1,updatedAt=store.engine.at(),
                                 disciplines=['*'],packageIds=['*'],locationIds=['*'])
                    store.engine._save('RoleAssignment',revised)
                pwd.create({'actorGroup':'ADM','projectId':store.meta['projectId']},'operator','Secure-Password-12',admin['partyId'],admin['roleAssignmentId'])
                app=create_app(demo=False,persistence=store,authentication=verifier)
                with TestClient(app) as http:
                    base={'Origin':'https://app.example'}
                    res=http.post('/auth/login',json={'username':'operator','password':'Secure-Password-12'},headers=base)
                    self.assertEqual(res.status_code,200,res.text)
                    token=res.json()['accessToken']
                    admin_headers={**base,'Authorization':'Bearer '+token}
                    payload={'username':'supervisor','password':'Secure-Password-34','partyId':supervisor['partyId'],'roleAssignmentId':supervisor['roleAssignmentId']}
                    added=http.post('/auth/accounts',json=payload,headers=admin_headers)
                    self.assertEqual(added.status_code,200,added.text)
                    sup=http.post('/auth/login',json={'username':'supervisor','password':'Secure-Password-34'},headers=base)
                    self.assertEqual(sup.status_code,200,sup.text)
                    sup_headers={**base,'Authorization':'Bearer '+sup.json()['accessToken']}
                    self.assertEqual(http.post('/auth/accounts',json=payload,headers=sup_headers).status_code,403)
                    self.assertEqual(http.get('/projects/'+store.meta['projectId']+'/roles',headers=sup_headers).status_code,200)
                    self.assertEqual(http.post('/auth/logout',headers=sup_headers).status_code,200)
                    self.assertEqual(http.get('/projects/'+store.meta['projectId']+'/roles',headers=sup_headers).status_code,401)
                    self.assertEqual(http.post('/auth/login',json={'username':'supervisor','password':'Secure-Password-34'}).status_code,403)
        store.close()

if __name__=='__main__':unittest.main()
