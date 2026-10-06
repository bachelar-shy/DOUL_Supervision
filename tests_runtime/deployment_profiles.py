"""Validate isolated Compose profiles without starting or pulling their images."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='doul-profile-') as temporary:
        directory=Path(temporary)
        files=['service-ca-bundle','api-database-url','api-redis-url','auth-public-key','api-alert-token','worker-database-url',
               'worker-redis-url','monitor-database-url','monitor-redis-url','monitor-storage-access',
               'monitor-storage-secret','monitor-alert-token','tls-certificate','tls-private-key']
        for name in files:
            path=directory/name;path.write_text('SYNTHETIC-COMPOSE-CONFIGURATION-ONLY');path.chmod(0o600)
        projects=[]
        for stage in ['staging','pilot']:
            env=dict(os.environ,DOUL_ENVIRONMENT=stage,DOUL_RELEASE_SHA='a'*40,DOUL_SECRETS_DIR=str(directory),
                     DOUL_API_IMAGE='registry.invalid/api@sha256:'+'b'*64,
                     DOUL_WORKER_IMAGE='registry.invalid/worker@sha256:'+'b'*64,
                     DOUL_MONITOR_IMAGE='registry.invalid/monitor@sha256:'+'b'*64,
                     DOUL_PROXY_IMAGE='registry.invalid/proxy@sha256:'+'b'*64,
                     DOUL_PUBLIC_ORIGIN='https://site.example.invalid',DOUL_PUBLIC_HOSTNAME='site.example.invalid',
                     DOUL_AUTH_ISSUER='https://identity.example.invalid',DOUL_AUTH_AUDIENCE='doul-supervision',DOUL_AUTH_KEY_ID='synthetic-key',
                     DOUL_OBJECT_STORAGE_ENDPOINT='https://storage.example.invalid',DOUL_OBJECT_STORAGE_BUCKET='test',
                     DOUL_ALERT_ENDPOINT='https://alerts.example.invalid/receiver',DOUL_DATABASE_CAPACITY_BYTES='1000000000',DOUL_OBJECT_CAPACITY_BYTES='1000000000')
            command=['docker','compose','-f',str(ROOT/'infra/compose/compose.operational.yml'),
                     '-f',str(ROOT/('infra/compose/compose.'+stage+'.yml')),'config','--format','json']
            model=json.loads(subprocess.check_output(command,env=env,stderr=subprocess.PIPE))
            projects.append(model['name'])
            assert model['name']=='doul-supervision-'+stage
            assert set(model['services'])=={'api','worker-runtime','monitor','proxy'}
            for name,service in model['services'].items():
                assert '@sha256:' in service['image'] and service['read_only'] is True
                assert service['user'] not in {'0','0:0','root'}
                assert 'ALL' in service['cap_drop']
                assert 'no-new-privileges:true' in service['security_opt']
                if name!='proxy':
                    assert not service.get('ports')
                    assert service['environment']['DOUL_ENVIRONMENT']==stage
                    assert 'DATABASE_URL' not in service['environment'] and 'REDIS_URL' not in service['environment']
            assert model['services']['api']['environment']['DOUL_API_DEMO']=='false'
            assert model['services']['worker-runtime']['entrypoint']==[]
            assert model['services']['worker-runtime']['environment']['DOUL_QUEUE_NAMESPACE']=='doul:'+stage+':media'
            assert model['services']['proxy']['ports'][0]['target']==8443
            invalid=dict(env);invalid.pop('DOUL_AUTH_ISSUER')
            assert subprocess.run(command,env=invalid,stdout=subprocess.PIPE,stderr=subprocess.PIPE).returncode!=0
        assert len(set(projects))==2
        print('isolated-staging-pilot-compose-config-ok')


if __name__=='__main__':main()
