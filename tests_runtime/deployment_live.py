"""Disposable TLS/non-demo deployment rehearsal. Never imports real identities or keys."""
from datetime import datetime, timezone, timedelta
from pathlib import Path
import ipaddress
import json
import os
import secrets
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID

from services.api.persistence import create_postgres_persistence
from services.deployment.migrate import migrate_v1
from services.deployment.auth import subject_key


def command(args, env=None, ok=True, timeout=120):
    result=subprocess.run(args,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if ok and result.returncode:raise RuntimeError('Disposable deployment test command failed: '+result.stderr.decode()[-1000:])
    return result


def wait_for_database(dsn, timeout=45):
    """Probe the exact authenticated TCP endpoint, not initdb's temporary socket."""
    import psycopg
    if timeout <= 0:
        raise ValueError('Positive readiness timeout required')
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with psycopg.connect(dsn, connect_timeout=2, options='-c statement_timeout=2000') as connection:
                if connection.execute('SELECT 1').fetchone() != (1,):
                    raise RuntimeError('Unexpected database readiness response')
                return
        except psycopg.OperationalError:
            if time.monotonic() >= deadline:
                break
            time.sleep(0.25)
    # Do not echo a credential-bearing DSN or an underlying connection error.
    raise RuntimeError('Disposable TCP database did not become ready before timeout') from None


def pem_key(path,key):
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));path.chmod(0o600)


def main():
    now=datetime.now(timezone.utc)
    names=['doul-ci-api','doul-ci-proxy','doul-ci-postgres']
    network='doul-deployment-ci'
    issuer='https://identity.example.invalid'
    password=secrets.token_urlsafe(24)
    with tempfile.TemporaryDirectory(prefix='doul-stage-') as temp:
        root=Path(temp)
        signing=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        public=root/'auth-public-key';public.write_bytes(signing.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo));public.chmod(0o600)
        ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        ca_name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'DOUL synthetic CI root')])
        ca=x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(ca_key,hashes.SHA256())
        ca_file=root/'ca.pem';ca_file.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
        tls_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cert=x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])).issuer_name(ca_name).public_key(tls_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False).sign(ca_key,hashes.SHA256())
        certificate=root/'tls-certificate';certificate.write_bytes(cert.public_bytes(serialization.Encoding.PEM));certificate.chmod(0o600)
        private=root/'tls-private-key';pem_key(private,tls_key)
        db_file=root/'api-database-url';db_file.write_text('postgresql://integration:'+password+'@postgres:5432/staging_test');db_file.chmod(0o600)
        redis_file=root/'api-redis-url';redis_file.write_text('redis://:'+secrets.token_urlsafe(24)+'@unused-redis:6379/0');redis_file.chmod(0o600)
        # Keep the temporary socket-only initialization phase observable in CI.
        # The old pg_isready-without-host probe can succeed during this pause.
        init_delay=root/'99-readiness-delay.sh'
        init_delay.write_text('#!/bin/sh\nsleep 3\n');init_delay.chmod(0o555)
        try:
            command(['docker','network','create',network])
            env=dict(os.environ,POSTGRES_USER='integration',POSTGRES_PASSWORD=password,POSTGRES_DB='staging_test')
            command(['docker','run','-d','--name',names[2],'--network',network,'--network-alias','postgres',
                     '-p','127.0.0.1:55432:5432','-e','POSTGRES_USER','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB',
                     '-v',str(init_delay)+':/docker-entrypoint-initdb.d/99-readiness-delay.sh:ro',
                     'postgres:16.15-alpine3.24'],env=env)
            dsn='postgresql://integration:'+password+'@127.0.0.1:55432/staging_test'
            wait_for_database(dsn)
            migrate_v1(dsn)
            store=create_postgres_persistence(dsn,demo=True)
            try:
                with store.transaction(True):
                    actor=store.meta['actors']['SUP'];project=store.meta['projectId']
                    store.meta['provisioning']=dict(environment='staging',snapshotFormat=1,approvedBy='SYNTHETIC-CI',approvalRef='disposable-test-only',syntheticData=True)
                    store.meta['identityBindings']={subject_key(issuer,'synthetic-supervisor'):dict(active=True,partyId=actor['partyId'],defaultRoleAssignmentId=actor['roleAssignmentId'],validAfter=0)}
            finally:store.close()
            # Ownership changes are confined to newly-created disposable CI files.
            command(['sudo','chown','10001:10001',str(db_file),str(redis_file),str(public)])
            command(['sudo','chown','101:101',str(certificate),str(private)])
            release_sha=command(['git','rev-parse','HEAD']).stdout.decode().strip()
            variables={'DOUL_ENVIRONMENT':'staging','DOUL_API_DEMO':'false','DOUL_RELEASE_SHA':release_sha,
                'DATABASE_URL_FILE':'/run/secrets/api-database-url','REDIS_URL_FILE':'/run/secrets/api-redis-url',
                'DOUL_AUTH_PUBLIC_KEY_FILE':'/run/secrets/auth-public-key','DOUL_AUTH_ISSUER':issuer,
                'DOUL_AUTH_AUDIENCE':'doul-supervision','DOUL_AUTH_KEY_ID':'test-key-1',
                'DOUL_API_ALLOWED_ORIGINS':'https://localhost:8443','DOUL_API_ALLOWED_HOSTS':'localhost,127.0.0.1,api',
                'TZ':'UTC'}
            api=['docker','run','-d','--name',names[0],'--network',network,'--network-alias','api',
                 '--read-only','--tmpfs','/tmp:rw,nosuid,size=128m']
            for name in ['api-database-url','api-redis-url','auth-public-key']:
                api+=['-v',str(root/name)+':/run/secrets/'+name+':ro']
            for name,value in variables.items():api+=['-e',name+'='+value]
            api+=['doul-operational-api:test','python','-m','services.deployment.api_runtime']
            command(api)
            proxy=['docker','run','-d','--name',names[1],'--network',network,'-p','127.0.0.1:8443:8443',
                   '--read-only','--tmpfs','/tmp:rw,nosuid,size=128m',
                   '-v',str(certificate)+':/run/secrets/tls-certificate:ro',
                   '-v',str(private)+':/run/secrets/tls-private-key:ro','doul-operational-proxy:test']
            command(proxy)
            context=ssl.create_default_context(cafile=ca_file)
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context))
            def request(path,token=None,method='GET',data=None):
                headers={'Authorization':'Bearer '+token} if token else {}
                req=urllib.request.Request('https://localhost:8443'+path,headers=headers,method=method,data=data)
                try:
                    with opener.open(req,timeout=5) as response:return response.status,response.read()
                except urllib.error.HTTPError as exc:return exc.code,exc.read()
            for _ in range(60):
                try:
                    if request('/api/ready')[0]==200:break
                except Exception:pass
                time.sleep(0.5)
            assert request('/api/ready')[0]==200,'TLS API readiness did not pass'
            assert request('/')[0]==200,'TLS web shell did not serve'
            assert request('/api/dev/sessions',method='POST',data=b'{}')[0]==404
            assert request('/api/projects/'+project+'/roles')[0]==401
            epoch=int(time.time())
            token=jwt.encode(dict(sub='synthetic-supervisor',iss=issuer,aud='doul-supervision',iat=epoch,nbf=epoch,exp=epoch+300,roles=['ADM']),signing,algorithm='RS256',headers={'kid':'test-key-1','typ':'at+jwt'})
            status,body=request('/api/projects/'+project+'/roles',token)
            assert status==200 and all(r['actorGroup']=='SUP' for r in json.loads(body)), 'Token claims widened server authority'
            assert request('/api/projects/'+project+'/roles','invalid-token')[0]==401
            status,body=request('/api/health');assert status==200 and json.loads(body)['mode']=='staging'
            from services.deployment.release import verify_https
            plan=dict(publicUrl='https://localhost:8443',environment='staging',releaseSha=release_sha)
            verify_https(plan, str(ca_file))
            for wrong in (dict(plan,releaseSha='0'*40),dict(plan,environment='pilot')):
                try:
                    verify_https(wrong, str(ca_file))
                except RuntimeError:
                    pass
                else:
                    raise AssertionError('A different running release/environment was accepted')
            logs=command(['docker','logs',names[0]]).stdout.decode()
            assert password not in logs and token not in logs,'Runtime emitted a credential'
            # A pilot process with a staging/synthetic store must not start.
            negative=api[:];negative[negative.index('-d')]='--rm'
            negative[negative.index('--name')+1]='doul-ci-pilot-negative'
            negative=[value.replace('DOUL_ENVIRONMENT=staging','DOUL_ENVIRONMENT=pilot') for value in negative]
            result=command(negative,ok=False,timeout=20)
            assert result.returncode!=0,'Unapproved pilot runtime started'
            print(json.dumps(dict(result='staging-tls-nondemo-ok',certificateVerified=True,devEndpointsAbsent=True,
                                  unverifiedTokenRejected=True,serverRolePreserved=True,unapprovedPilotRefused=True,
                                  actualPilotDeployed=False),sort_keys=True))
        finally:
            for name in names+['doul-ci-pilot-negative']:command(['docker','rm','-f',name],ok=False)
            command(['docker','network','rm',network],ok=False)
            command(['sudo','chown','-R',str(os.getuid())+':'+str(os.getgid()),str(root)],ok=False)


if __name__=='__main__':main()
