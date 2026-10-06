"""Fail-closed runtime/release gates. Configuration is not an actual approval."""
from datetime import datetime, timezone
import os
import re
from urllib.parse import urlsplit

from services.runtime_config import secret, service_url


def https_origins():
    values = [value.strip().rstrip('/') for value in os.environ.get('DOUL_API_ALLOWED_ORIGINS', '').split(',') if value.strip()]
    if not values:
        raise ValueError('Explicit HTTPS origins are required')
    for value in values:
        service_url(value)
        if urlsplit(value).path:
            raise ValueError('Origin cannot include a path')
    return list(dict.fromkeys(values))


def allowed_hosts():
    hosts = [value.strip() for value in os.environ.get('DOUL_API_ALLOWED_HOSTS', '').split(',') if value.strip()]
    if not hosts or any(not re.fullmatch(r'[A-Za-z0-9.-]{1,253}', value) or '*' in value for value in hosts):
        raise ValueError('Explicit non-wildcard API hosts required')
    return hosts


def validate_store(store, stage):
    if stage not in {'staging', 'pilot'}:
        raise ValueError('Non-demo environment required')
    with store.transaction():
        provision = store.meta.get('provisioning', {})
        if provision.get('environment') != stage or not provision.get('approvedBy') or not provision.get('approvalRef'):
            raise ValueError('Matching approved provisioning record required')
        if provision.get('snapshotFormat') != 1:
            raise ValueError('Unsupported snapshot migration version')
        if stage == 'pilot' and provision.get('syntheticData') is not False:
            raise ValueError('Pilot must not contain demonstration fixtures')
        if not store.meta.get('identityBindings'):
            raise ValueError('No provisioned identities')
        if hasattr(store, '_fetchone'):
            database_time = store._fetchone('SELECT EXTRACT(EPOCH FROM clock_timestamp())')[0]
            if abs(float(database_time) - datetime.now(timezone.utc).timestamp()) > 30:
                raise ValueError('Database and application clocks differ by more than 30 seconds')
        if stage == 'pilot':
            from scripts.validate_product_configuration import validate_project_config
            config=store.meta.get('projectConfiguration', {})
            validate_project_config(config)
            if config['mediaPolicy']['enabled']:
                raise ValueError('Pilot media must remain disabled until an approved provider adapter is installed')
    return True


def validate_connections(stage):
    from services.runtime_config import validate_database_dsn, validate_redis_url
    dsn = validate_database_dsn(secret('DATABASE_URL'), stage)
    redis = validate_redis_url(secret('REDIS_URL'), stage)
    if stage == 'pilot':
        service_url(os.environ['OBJECT_STORAGE_ENDPOINT'])
        if os.getenv('DOUL_DOCUMENT_RUNTIME') != 'local':
            raise ValueError('Verified document runtime required for pilot')
        service_url(os.environ['DOUL_ALERT_ENDPOINT'])
        secret('DOUL_ALERT_TOKEN')
    return dsn, redis


def validate_release_plan(plan, stage):
    required = {'schemaVersion', 'environment', 'releaseSha', 'images', 'publicUrl', 'snapshotFormat',
                'owners', 'approval', 'recovery', 'clockSource'}
    if set(plan) != required or plan['schemaVersion'] != 1 or plan['environment'] != stage:
        raise ValueError('Deployment plan fields/environment mismatch')
    if not re.fullmatch(r'[a-f0-9]{40}', plan['releaseSha']) or plan['releaseSha'] == '0' * 40:
        raise ValueError('Exact release commit required')
    if set(plan['images']) != {'api', 'worker', 'monitor', 'proxy'}:
        raise ValueError('Every deployed runtime needs an explicit image')
    if any(not re.fullmatch(r'[A-Za-z0-9./_:-]+@sha256:[a-f0-9]{64}', image) for image in plan['images'].values()):
        raise ValueError('Deployment images must be digest-pinned')
    service_url(plan['publicUrl'])
    if plan['snapshotFormat'] != 1:
        raise ValueError('No unreviewed database upgrade/downgrade permitted')
    if set(plan['owners']) != {'deployment', 'monitoring', 'onCall', 'backup', 'approval'} or not all(plan['owners'].values()):
        raise ValueError('Deployment and monitoring responsibilities required')
    if set(plan['approval']) != {'approvedBy', 'recordRef', 'approvedAt', 'syntheticEnvironment'}:
        raise ValueError('Explicit approval evidence required')
    if not plan['approval']['approvedBy'] or not plan['approval']['recordRef']:
        raise ValueError('Missing release approval')
    approved = datetime.fromisoformat(plan['approval']['approvedAt'].replace('Z', '+00:00'))
    if approved.tzinfo is None or approved > datetime.now(timezone.utc):
        raise ValueError('Invalid approval time')
    if stage == 'pilot' and plan['approval']['syntheticEnvironment'] is not False:
        raise ValueError('Synthetic approval cannot activate pilot')
    if set(plan['recovery']) != {'backupReport', 'restoreReport', 'scheduleRef', 'keyCustodyRef'} or not all(plan['recovery'].values()):
        raise ValueError('Backup, verified restore, scheduler and separate key custody required')
    if not plan['clockSource']:
        raise ValueError('Time synchronization source required')
    return plan
