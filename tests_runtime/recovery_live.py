"""Disposable, real PostgreSQL/RustFS full-set recovery and tamper rejection."""
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request
from urllib.parse import quote

from cryptography.exceptions import InvalidTag
from services.api.persistence import create_postgres_persistence
from services.runtime_config import object_storage_client
from services.recovery.bundle import create_bundle, restore_bundle, ComposeBoundary, database_fingerprint
from services.recovery.objects import inventory
from tests_mvp.test_worker_jobs import seed_source

ROOT = Path(__file__).resolve().parents[1]


def main():
    dsn = os.environ['DATABASE_URL']
    client = object_storage_client()
    store = create_postgres_persistence(dsn, demo=True)
    try:
        seed_source(store)
        bucket = os.environ['OBJECT_STORAGE_BUCKET']
        client.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={'Status':'Enabled'})
        key = 'source/한글-kiểm-tra & history.txt'
        client.put_object(Bucket=bucket, Key=key, Body=b'version-one', ContentType='text/plain',
                          Metadata={'origin':'synthetic-ci'}, Tagging='revision=one')
        client.delete_object(Bucket=bucket, Key=key)
        client.put_object(Bucket=bucket, Key=key, Body=b'version-two', ContentType='text/plain',
                          Metadata={'origin':'synthetic-ci'}, Tagging='revision=two')
        client.put_object(Bucket=bucket, Key='now-deleted', Body=b'preserve-history')
        client.delete_object(Bucket=bucket, Key='now-deleted')
        source_versions = inventory(client, bucket)
        plan = json.loads((ROOT / 'infra/backup/recovery_plan.example.json').read_text())
        plan['releaseSha'] = subprocess.check_output(['git','rev-parse','HEAD'], text=True).strip()
        plan['bucket'] = bucket
        boundary = ComposeBoundary(plan)
        with tempfile.TemporaryDirectory(prefix='doul-recovery-live-') as temp:
            root = Path(temp)
            encryption_key = os.urandom(32)
            bundle = root / 'verified.backup.enc'
            backup = create_bundle(plan, bundle, encryption_key, client, dsn, boundary)
            assert backup['encrypted'] is True and backup['objectVersionCount'] == len(source_versions)
            assert bundle.stat().st_mode & 0o777 == 0o600
            original_fingerprint = database_fingerprint(dsn, plan['database'])
            class NeverMutate:
                def restore_database(self, *args): raise AssertionError('invalid archive reached target mutation')
            try:
                restore_bundle(bundle, os.urandom(32), client, dsn, NeverMutate())
                raise AssertionError('wrong encryption key was accepted')
            except InvalidTag: pass
            tampered = root / 'tampered.backup.enc'
            data = bytearray(bundle.read_bytes()); data[-32] ^= 1; tampered.write_bytes(data)
            try:
                restore_bundle(tampered, encryption_key, client, dsn, NeverMutate())
                raise AssertionError('tampered archive was accepted')
            except InvalidTag: pass
            result = restore_bundle(bundle, encryption_key, client, dsn, boundary)
            assert result['verified'] and not result['promotionApproved']
            assert len(result['objects']['versionMapping']) == len(source_versions)
            assert inventory(client, bucket) == source_versions
            assert database_fingerprint(dsn, plan['database']) == original_fingerprint
            target = result['objects']['bucket']
            target_versions = inventory(client, target)
            assert len(target_versions) == len(source_versions)
            latest = {e['key']:e for e in target_versions if e['isLatest']}
            assert latest[key]['deleteMarker'] is False
            assert latest['now-deleted']['deleteMarker'] is True
            # Anonymous read must remain denied; a new bucket never receives source public policy.
            try:
                urllib.request.urlopen(os.environ['OBJECT_STORAGE_ENDPOINT'] + '/' + target + '/' + quote(key, safe='/'), timeout=5)
                raise AssertionError('restored object became anonymously public')
            except urllib.error.HTTPError as exc:
                assert exc.code in {401,403}, 'unexpected anonymous access response'
            running = subprocess.check_output(boundary.command + ['ps','--services','--status','running'], text=True).splitlines()
            assert {'api','worker-runtime'} <= set(running), 'previously running writers were not resumed'
            print(json.dumps(dict(result='full-recovery-ok', versionCount=len(target_versions),
                                  encrypted=True, wrongKeyRejected=True, tamperRejected=True,
                                  databaseFingerprintVerified=True, sourcePreserved=True,
                                  durationSeconds=result['durationSeconds']), sort_keys=True))
    finally:
        store.close(); client.close()


if __name__ == '__main__':
    main()
