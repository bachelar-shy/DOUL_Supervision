"""Disposable HTTPS browser fixture: real password/JWT/settings API and built UI, no live credentials."""
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
import os
from pathlib import Path
import tempfile

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, PublicFormat, NoEncryption
from cryptography.x509.oid import NameOID
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import uvicorn

from services.api.persistence import create_local_persistence
from services.api.main import create_app
from services.deployment.auth import PinnedJWT
from services.deployment.password_auth import PasswordAccounts
from scripts.install_site_test_project import install


def main():
    root=Path(__file__).resolve().parents[1]
    if not (root/'apps/web/dist/index.html').is_file():
        raise RuntimeError('Build the password-mode UI before running connected browser tests')
    with tempfile.TemporaryDirectory(prefix='doul-settings-browser-') as folder:
        directory=Path(folder)
        os.environ['DOUL_ENVIRONMENT']='development'
        store=create_local_persistence(str(directory/'fixture.sqlite3'),demo=True)
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        private=directory/'private.pem'; private.write_bytes(key.private_bytes(Encoding.PEM,PrivateFormat.PKCS8,NoEncryption())); private.chmod(0o600)
        name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')]); now=datetime.now(timezone.utc)
        certificate=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ip_address('127.0.0.1'))]),critical=False).sign(key,hashes.SHA256())
        cert=directory/'certificate.pem'; cert.write_bytes(certificate.public_bytes(Encoding.PEM))
        origin='https://127.0.0.1:5210'
        os.environ.update(DOUL_ENVIRONMENT='staging',DOUL_AUTH_MODE='local-password',
            DOUL_AUTH_PRIVATE_KEY_FILE=str(private),DOUL_API_ALLOWED_ORIGINS=origin,
            DOUL_API_ALLOWED_HOSTS='127.0.0.1,localhost',DOUL_QUEUE_ENABLED='false')
        verifier=PinnedJWT(key.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo),origin,'doul-supervision','fixture-key')
        admin=store.meta['actors']['ADM']; project=store.meta['projectId']
        with store.transaction(True):
            store.meta['provisioning']=dict(environment='staging',snapshotFormat=1,syntheticData=True,approvedBy='browser-fixture-owner',approvalRef='test-only')
            for group in ('ADM','SUP','OWN','CON'):
                role=store.engine.get('RoleAssignment',store.meta['actors'][group]['roleAssignmentId'])
                store.engine.bootstrap('Party',dict(id=role['organizationId'],projectId=project,kind='ORGANIZATION',name='기존 '+dict(ADM='관리',SUP='감리',OWN='발주처',CON='시공')[group]+' 회사',loginEnabled=False))
        PasswordAccounts(store,verifier).create(dict(actorGroup='ADM',projectId=project),'operator','Synthetic-Password-12',admin['partyId'],admin['roleAssignmentId'])
        install(store,issuer=origin,username='operator',approval_ref='browser-fixture-only',enable_project_settings=True)
        site=FastAPI(docs_url=None,openapi_url=None,redoc_url=None)
        site.mount('/api',create_app(demo=False,persistence=store,authentication=verifier))
        site.mount('/',StaticFiles(directory=root/'apps/web/dist',html=True))
        try:
            uvicorn.run(site,host='127.0.0.1',port=5210,ssl_keyfile=str(private),ssl_certfile=str(cert),access_log=False)
        finally:
            store.close()


if __name__=='__main__':main()
