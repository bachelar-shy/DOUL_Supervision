"""Consistent DB/object/config recovery set. Existing sources are never replaced."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import time
from uuid import uuid4

from .archive import encrypt_directory, decrypted_directory, digest_file, private_directory, regular_file
from .objects import backup_objects, validate_objects, restore_objects

ROOT = Path(__file__).resolve().parents[2]
REQUIRED_SECRETS = {'DATABASE_URL','REDIS_URL','OBJECT_STORAGE_ACCESS_KEY','OBJECT_STORAGE_SECRET_KEY','RECOVERY_ENCRYPTION_KEY'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def validate_plan(plan):
    required = {'schemaVersion','composeProject','composeFiles','database','bucket','releaseSha',
                'configurationPaths','secretRecovery','targets','owners','writeBoundary','applicationStorage'}
    if set(plan) != required or plan['schemaVersion'] != 1:
        raise ValueError('Unsupported recovery plan fields/version')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{1,60}', plan['composeProject']):
        raise ValueError('Invalid Compose project')
    if not re.fullmatch(r'[A-Za-z0-9_]{1,63}', plan['database']): raise ValueError('Invalid source database')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', plan['bucket']): raise ValueError('Invalid source bucket')
    if not re.fullmatch(r'[a-f0-9]{40}', plan['releaseSha']): raise ValueError('Exact release commit required')
    if plan['applicationStorage'] != 'database-blobs-v1':
        raise ValueError('This recovery adapter requires the current DB-blob storage contract')
    if plan['writeBoundary'] != 'all-api-worker-and-external-writers-stopped':
        raise ValueError('A declared write-quiescence boundary is required')
    for field in ('composeFiles', 'configurationPaths'):
        if not isinstance(plan[field], list) or not plan[field]: raise ValueError('Recovery paths required')
        for text in plan[field]:
            path = PurePosixPath(text)
            if path.is_absolute() or '..' in path.parts or '\\' in text or text.startswith('.') or not re.fullmatch(r'[A-Za-z0-9_./-]+', text):
                raise ValueError('Recovery path must be a tracked, non-secret relative file')
    if len(set(plan['configurationPaths'])) != len(plan['configurationPaths']): raise ValueError('Duplicate configuration path')
    refs = plan['secretRecovery']
    if not isinstance(refs, list) or not REQUIRED_SECRETS <= {r.get('name') for r in refs}:
        raise ValueError('Required secret recovery inventory missing')
    for ref in refs:
        if set(ref) != {'name','vaultRef','versionRef','owner'} or any(not isinstance(v,str) or not v.strip() for v in ref.values()):
            raise ValueError('Secret inventory stores names, vault/version references and owners only')
        if not re.fullmatch(r'[A-Z0-9_]+', ref['name']): raise ValueError('Invalid secret name')
    if set(plan['owners']) != {'backup','restore','approval'} or not all(plan['owners'].values()):
        raise ValueError('Explicit backup/restore/approval responsibility required')
    if set(plan['targets']) != {'rpoSeconds','rtoSeconds','status'} or plan['targets']['status'] not in {'draft','approved'}:
        raise ValueError('Explicit RPO/RTO target status required')
    for field in ('rpoSeconds','rtoSeconds'):
        if type(plan['targets'][field]) is not int or plan['targets'][field] <= 0:
            raise ValueError('Positive recovery targets required')
    return plan


def run_command(args, env=None, timeout=600):
    result = subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Do not echo pg/docker raw diagnostics that may carry credentials.
        raise RuntimeError('Recovery subprocess failed with exit code ' + str(result.returncode))
    return result.stdout


def configuration_inventory(plan, root):
    directory = Path(root) / 'configuration'
    directory.mkdir(mode=0o700)
    result = []
    for path in plan['configurationPaths']:
        # Read the exact tracked release, not potentially modified live secret files.
        data = run_command(['git','-C',str(ROOT),'show', plan['releaseSha'] + ':' + path])
        if len(data) > 16 * 1024**2: raise ValueError('Configuration artifact exceeds bound')
        name = sha256(path.encode()).hexdigest()
        (directory / name).write_bytes(data)
        result.append(dict(sourcePath=path, member='configuration/' + name, sha256=sha256(data).hexdigest()))
    return result


def database_fingerprint(dsn, expected_database):
    import psycopg
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT current_database()')
            if cursor.fetchone()[0] != expected_database: raise ValueError('Recovery DSN points to a different database')
            cursor.execute('SELECT payload FROM doul_snapshot_state WHERE id=1')
            row = cursor.fetchone()
            if not row or not row[0]: raise ValueError('Application snapshot is not provisioned')
            payload = json.loads(row[0])
            if payload.get('format') != 1: raise ValueError('Unsupported application snapshot format')
            cursor.execute('SELECT id, content FROM doul_snapshot_blobs ORDER BY id')
            inventory = {key: sha256(bytes(data)).hexdigest() for key,data in cursor}
    return dict(format=1, snapshotSha256=sha256(canonical(payload)).hexdigest(),
                blobHashes=inventory, blobCount=len(inventory), workerLedgerIncluded=True)


class ComposeBoundary:
    """Operator invoked only: stop/resume precisely the chosen app writer services."""
    def __init__(self, plan):
        self.plan = validate_plan(plan)
        self.command = ['docker','compose','-p',plan['composeProject']]
        for file in plan['composeFiles']:
            path = ROOT / file
            if path.is_symlink() or not path.is_file(): raise ValueError('Invalid Compose file')
            self.command.extend(['-f',str(path)])
        self.running = []

    def __enter__(self):
        # Save only the services running before this explicitly authorized operation.
        running = run_command(self.command + ['ps','--services','--status','running']).decode().splitlines()
        self.running = [name for name in ('api','worker-runtime') if name in running]
        try:
            if self.running:
                run_command(self.command + ['stop','--timeout','70',*self.running], timeout=120)
            remains = run_command(self.command + ['ps','--services','--status','running']).decode().splitlines()
            if set(remains) & {'api','worker-runtime'}:
                raise RuntimeError('Application writers did not stop')
            return self
        except Exception:
            if self.running:
                run_command(self.command + ['start',*self.running], timeout=120)
            raise

    def __exit__(self, *_):
        if self.running:
            run_command(self.command + ['start',*self.running], timeout=120)

    def pg_env(self):
        return dict(os.environ, DOUL_COMPOSE_FILE=str(ROOT / self.plan['composeFiles'][0]),
                    COMPOSE_PROJECT_NAME=self.plan['composeProject'])

    def backup_database(self, output):
        run_command(['sh',str(ROOT / 'infra/backup/postgres_backup.sh'),self.plan['database'],str(output)], self.pg_env())

    def restore_database(self, dump, target):
        run_command(['sh',str(ROOT / 'infra/backup/postgres_restore_clean.sh'),str(dump),target], self.pg_env())


def create_bundle(plan, output, key, client, dsn, boundary=None):
    plan = validate_plan(plan)
    output = Path(output)
    private_directory(output.parent)
    if output.exists() or output.is_symlink(): raise FileExistsError('Backup output already exists')
    boundary = boundary or ComposeBoundary(plan)
    # Invalid release/config references must fail before stopping any service.
    run_command(['git','-C',str(ROOT),'rev-parse','--verify',plan['releaseSha'] + '^{commit}'])
    for path in plan['configurationPaths']:
        run_command(['git','-C',str(ROOT),'cat-file','-e',plan['releaseSha'] + ':' + path])
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='.recovery-source-', dir=output.parent) as temp:
        root = Path(temp)
        with boundary:
            before = database_fingerprint(dsn, plan['database'])
            database = root / 'database'
            database.mkdir(mode=0o700)
            boundary.backup_database(database / 'snapshot.dump')
            objects = backup_objects(client, plan['bucket'], root / 'objects')
            config = configuration_inventory(plan, root)
            after = database_fingerprint(dsn, plan['database'])
            if before != after: raise RuntimeError('Database changed during supposedly quiescent backup')
            manifest = dict(schemaVersion=1, createdAt=datetime.now(timezone.utc).isoformat(),
                plan=plan, planSha256=sha256(canonical(plan)).hexdigest(), configuration=config,
                databaseSha256=digest_file(database / 'snapshot.dump'), databaseFingerprint=before,
                objectManifestSha256=digest_file(root / 'objects/manifest.json'),
                objectVersionCount=len(objects['entries']), snapshotFormat=1,
                consistency='writers-stopped-and-source-fingerprints-stable')
            (root / 'manifest.json').write_bytes(canonical(manifest))
            encrypted_hash = encrypt_directory(root, output, key)
        return dict(bundleSha256=encrypted_hash, encrypted=True,
                    durationSeconds=round(time.monotonic()-started,3), objectVersionCount=manifest['objectVersionCount'])


def verify_bundle(root):
    root = Path(root)
    with regular_file(root / 'manifest.json') as file: manifest = json.load(file)
    if manifest.get('schemaVersion') != 1 or manifest.get('snapshotFormat') != 1:
        raise ValueError('Unsupported recovery set')
    validate_plan(manifest['plan'])
    if sha256(canonical(manifest['plan'])).hexdigest() != manifest['planSha256']:
        raise ValueError('Recovery plan integrity mismatch')
    if digest_file(root / 'database/snapshot.dump') != manifest['databaseSha256']:
        raise ValueError('Database dump integrity mismatch')
    with regular_file(root / 'database/snapshot.dump.sha256') as file: sidecar = file.read().decode().strip()
    if sidecar != manifest['databaseSha256']: raise ValueError('Database sidecar mismatch')
    if digest_file(root / 'objects/manifest.json') != manifest['objectManifestSha256']:
        raise ValueError('Object manifest integrity mismatch')
    validate_objects(root / 'objects')
    for entry in manifest['configuration']:
        if not re.fullmatch(r'configuration/[a-f0-9]{64}', entry['member']) or digest_file(root / entry['member']) != entry['sha256']:
            raise ValueError('Configuration artifact integrity mismatch')
    return manifest


def restore_bundle(bundle, key, client, dsn, boundary, target_encryption=None):
    """Restore new targets and verify; never promote, replace or edit source refs."""
    import psycopg.conninfo
    started = time.monotonic()
    with decrypted_directory(bundle, key) as root:
        manifest = verify_bundle(root)
        # Only the passed operator target environment is used, never execute a
        # Compose path/project or a credential chosen by the archive itself.
        target = 'doul_restore_' + uuid4().hex
        boundary.restore_database(root / 'database/snapshot.dump', target)
        target_dsn = psycopg.conninfo.make_conninfo(dsn, dbname=target)
        if database_fingerprint(target_dsn, target) != manifest['databaseFingerprint']:
            raise RuntimeError('Restored database snapshot/blob fingerprint mismatch')
        objects = restore_objects(client, root / 'objects', target_encryption=target_encryption)
        return dict(schemaVersion=1, verified=True, targetDatabase=target, objects=objects,
                    sourceReleaseSha=manifest['plan']['releaseSha'], configuration=manifest['configuration'],
                    secretRecovery=manifest['plan']['secretRecovery'], targets=manifest['plan']['targets'],
                    durationSeconds=round(time.monotonic()-started,3),
                    promotionApproved=False, sourceDataChanged=False,
                    applicationStorage='database-blobs-v1',
                    note='Original DB references retained; object version mapping must accompany any future S3 adapter.')
