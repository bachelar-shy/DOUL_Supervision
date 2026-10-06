"""Operator-controlled, digest-pinned activation/rollback without deleting data."""
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit
from uuid import uuid4

from services.telemetry import configure_logging, emit
from services.recovery.archive import regular_file, private_directory
from .gates import validate_release_plan

ROOT = Path(__file__).resolve().parents[2]


def run(args, timeout=120):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Deployment command failed with exit code ' + str(result.returncode))
    return result.stdout


def json_file(path):
    with regular_file(path) as file:
        if os.fstat(file.fileno()).st_size > 1024 * 1024: raise ValueError('Evidence file too large')
        return json.load(file)


def verify_recovery(plan):
    backup = json_file(plan['recovery']['backupReport'])
    restored = json_file(plan['recovery']['restoreReport'])
    if backup.get('encrypted') is not True or restored.get('verified') is not True:
        raise ValueError('Encrypted backup and verified restore evidence required')
    digest = backup.get('bundleSha256', '')
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or restored.get('bundleSha256') != digest:
        raise ValueError('Backup and restore reports must refer to the same encrypted bundle')
    target = restored.get('targets', {})
    rpo = target.get('rpoSeconds')
    if type(rpo) is not int or rpo <= 0:
        raise ValueError('Explicit recovery-point target required')
    created = backup.get('createdAt')
    if not isinstance(created, str) or restored.get('backupCreatedAt') != created:
        raise ValueError('Backup creation time must match the verified archive manifest')
    timestamp = datetime.fromisoformat(created.replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('Backup creation time must include a timezone')
    project = 'doul-supervision-' + plan['environment']
    if backup.get('composeProject') != project or restored.get('composeProject') != project:
        raise ValueError('Recovery evidence belongs to a different deployment environment')
    age = time.time() - timestamp.timestamp()
    if age < -30 or age > rpo:
        raise ValueError('Backup evidence is outside its declared recovery-point target')
    if plan['environment'] == 'pilot' and target.get('status') != 'approved':
        raise ValueError('Pilot recovery targets must be explicitly approved')


def compose_command(stage, env_file):
    if stage not in {'staging', 'pilot'}: raise ValueError('Operational environment required')
    return ['docker', 'compose', '--env-file', str(Path(env_file).resolve()),
            '-p', 'doul-supervision-' + stage,
            '-f', str(ROOT/'infra/compose/compose.operational.yml'),
            '-f', str(ROOT/('infra/compose/compose.'+stage+'.yml'))]


def verify_checkout(release_sha):
    if run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip() != release_sha:
        raise ValueError('Use the exact approved release checkout; do not deploy a moving branch')
    # A plain git diff misses staged changes; status also catches untracked inputs.
    if run(['git', '-C', str(ROOT), 'status', '--porcelain', '--untracked-files=all']).strip():
        raise ValueError('Release checkout has staged, unstaged or untracked changes')


def preflight(plan, env_file):
    stage = plan['environment']
    validate_release_plan(plan, stage)
    verify_checkout(plan['releaseSha'])
    verify_recovery(plan)
    command = compose_command(stage, env_file)
    model = json.loads(run(command + ['config', '--format', 'json']))
    expected = {'api': 'api', 'worker-runtime': 'worker', 'monitor': 'monitor', 'proxy': 'proxy'}
    if set(model['services']) != set(expected): raise ValueError('Unexpected operational services')
    for service, image in expected.items():
        cfg = model['services'][service]
        if cfg.get('image') != plan['images'][image] or cfg.get('privileged') or not cfg.get('read_only'):
            raise ValueError('Runtime image or isolation differs from the approved plan')
        if service != 'proxy' and cfg.get('ports'): raise ValueError('Only the TLS proxy may publish a port')
        if service in {'api', 'worker-runtime', 'monitor'} and cfg['environment'].get('DOUL_ENVIRONMENT') != stage:
            raise ValueError('Cross-environment configuration detected')
        if cfg.get('environment', {}).get('DOUL_API_DEMO') not in {None, 'false'}:
            raise ValueError('Demo mode prohibited')
    api = model['services']['api']['environment']
    if api['DOUL_RELEASE_SHA'] != plan['releaseSha'] or api['DOUL_API_ALLOWED_ORIGINS'] != plan['publicUrl'].rstrip('/'):
        raise ValueError('Release identity or public origin mismatch')
    ports = model['services']['proxy'].get('ports', [])
    if len(ports) != 1 or ports[0].get('target') != 8443: raise ValueError('Only the HTTPS listener is publishable')
    # File-backed secrets must exist; values are never printed or placed in state.
    for name, secret in model.get('secrets', {}).items():
        with regular_file(secret['file']) as file:
            info = os.fstat(file.fileno())
            if name == 'service-ca-bundle':
                if info.st_mode & 0o022: raise ValueError('Public CA trust bundle must not be group/world writable')
            elif info.st_mode & 0o027:
                raise ValueError('Operational secret files must deny other-user access and group writes')
    return command, model


def verify_https(plan, ca_file=None):
    context = ssl.create_default_context(cafile=ca_file)
    from services.observability.alerts import NoRedirect
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=context))
    for endpoint in ('ready', 'health'):
        with opener.open(plan['publicUrl'].rstrip('/') + '/api/' + endpoint, timeout=10) as response:
            payload = json.loads(response.read(65536))
            if response.status != 200 or payload.get('status') != 'ok':
                raise RuntimeError('Verified TLS endpoint readiness check failed')
            if endpoint == 'health' and (payload.get('mode') != plan['environment'] or payload.get('baseCommit') != plan['releaseSha']):
                raise RuntimeError('Running environment or release differs from the approved deployment')
    # This is transport/readiness verification, not an invented user acceptance.


def activate(plan, env_file, state_dir, execute=False, ca_file=None, rollback=False):
    command, _ = preflight(plan, env_file)
    if not execute: return dict(validated=True, executed=False)
    directory = private_directory(state_dir)
    record = dict(schemaVersion=1, releaseSha=plan['releaseSha'], environment=plan['environment'],
                  action='rollback' if rollback else 'activate', startedAt=datetime.now(timezone.utc).isoformat(),
                  snapshotFormat=1, databaseReplaced=False, status='starting')
    path = directory / ('deployment-' + uuid4().hex + '.json')
    def save():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os,'O_NOFOLLOW',0), 0o600)
        with os.fdopen(fd,'w') as file: json.dump(record,file,sort_keys=True)
    save()
    try:
        run(command + ['pull'], timeout=600)
        run(command + ['up','-d','--wait','--wait-timeout','180'], timeout=300)
        verify_https(plan, ca_file)
        record.update(status='ready', completedAt=datetime.now(timezone.utc).isoformat())
        save()
        return dict(validated=True, executed=True, ready=True, releaseSha=plan['releaseSha'])
    except Exception as exc:
        record.update(status='failed', errorType=type(exc).__name__)
        save()
        # Never destroy volumes or downgrade schema in an automatic rescue path.
        # Explicit rollback uses a separately approved previous checkout/plan.
        raise


def main():
    configure_logging()
    parser=argparse.ArgumentParser()
    parser.add_argument('operation',choices=['validate','activate','rollback'])
    parser.add_argument('--plan',required=True);parser.add_argument('--env-file',required=True)
    parser.add_argument('--state-dir',required=True);parser.add_argument('--ca-file')
    args=parser.parse_args()
    try:
        plan=json_file(args.plan)
        result=activate(plan,args.env_file,args.state_dir,execute=args.operation!='validate',
                        ca_file=args.ca_file,rollback=args.operation=='rollback')
        emit('deployment','release-'+args.operation+'-complete')
        return 0
    except Exception as exc:
        emit('deployment','release-operation-refused',errorType=type(exc).__name__)
        return 1


if __name__=='__main__':raise SystemExit(main())
