"""Explicit operator migration. Normal application processes never run DDL."""
from hashlib import sha256
import json
from pathlib import Path
import argparse

from app.reference.engine import canonical
from app.reference.validation import validate
from services.runtime_config import secret, environment
from services.telemetry import configure_logging, emit


DDL = (
    'CREATE TABLE IF NOT EXISTS doul_schema_version (id SMALLINT PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS doul_snapshot_state (id SMALLINT PRIMARY KEY CHECK(id=1), payload TEXT)',
    'CREATE TABLE IF NOT EXISTS doul_snapshot_blobs (id TEXT PRIMARY KEY, content BYTEA NOT NULL)',
)


def migrate_v1(dsn):
    import psycopg
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(731906048)')
            for statement in DDL: cursor.execute(statement)
            cursor.execute('SELECT version FROM doul_schema_version WHERE id=1')
            existing = cursor.fetchone()
            if existing and existing[0] != 1:
                raise ValueError('No automatic schema upgrade or downgrade is supported')
            cursor.execute('SELECT payload FROM doul_snapshot_state WHERE id=1')
            row = cursor.fetchone()
            if row and row[0] and json.loads(row[0]).get('format') != 1:
                raise ValueError('Existing snapshot is not format 1')
            cursor.execute('INSERT INTO doul_schema_version VALUES(1,1) ON CONFLICT(id) DO NOTHING')
            cursor.execute('INSERT INTO doul_snapshot_state VALUES(1,NULL) ON CONFLICT(id) DO NOTHING')


def validate_initial_snapshot(state, stage):
    from services.api.store import decode_map, ENGINE_MAPS, DOC_MAPS
    from .gates import validate_store
    if state.get('format') != 1 or state.get('audit') or state.get('documentBytes') or state.get('uploads') or state.get('requests'):
        raise ValueError('Provisioning accepts only a clean foundation snapshot, not operational history')
    if set(state.get('engine', {})) != set(ENGINE_MAPS) or set(state.get('documents', {})) != set(DOC_MAPS):
        raise ValueError('Snapshot structure mismatch')
    if any(state['documents'].values()) or state['engine']['_record_machines'] or state['engine']['_idempotency'] or state['engine']['_notifications']:
        raise ValueError('Operational records cannot be introduced by provisioning')
    root = Path(__file__).resolve().parents[2]
    schemas = json.loads((root/'app/schema/domain_schemas_v2.json').read_text())['components']['schemas']
    records = decode_map(state['engine']['_records'])
    permitted = {'Project', 'Party', 'RoleAssignment', 'Qualification', 'Requirement'}
    if not records:
        raise ValueError('An approved project foundation is required')
    for (kind, object_id), record in records.items():
        if kind not in permitted or record['id'] != object_id:
            raise ValueError('Provisioning cannot fabricate official workflow outcomes')
        validate(record, schemas[kind], schemas)
    history = decode_map(state['engine']['_history'])
    expected_history = {(kind, object_id, record['version']): record for (kind, object_id), record in records.items()}
    if history != expected_history or state.get('escalations') or state.get('conflicts') or state.get('meta', {}).get('workerJobs'):
        raise ValueError('Provisioning history must contain only the exact approved foundation versions')
    for (kind, object_id), record in records.items():
        if record['version'] != 1:
            raise ValueError('Initial provisioning cannot import prior operational versions')
        if kind == 'RoleAssignment':
            party = records.get(('Party', record['partyId']))
            project = records.get(('Project', record['projectId']))
            if not party or not project or party['projectId'] != record['projectId']:
                raise ValueError('Foundation role refers to an unknown or different project identity')
    provision = state.get('meta', {}).get('provisioning', {})
    if provision.get('environment') != stage or provision.get('snapshotFormat') != 1 or not provision.get('approvedBy') or not provision.get('approvalRef'):
        raise ValueError('Explicit environment-specific provisioning approval required')
    if stage == 'pilot' and provision.get('syntheticData') is not False:
        raise ValueError('Pilot must not be populated with synthetic fixture data')
    for binding in state['meta'].get('identityBindings', {}).values():
        party = records.get(('Party', binding['partyId']))
        role = records.get(('RoleAssignment', binding['defaultRoleAssignmentId']))
        if not party or not role or role['partyId'] != party['id'] or role['actorGroup'] not in {'SUP','CON','OWN','DES','ADM'}:
            raise ValueError('Identity-to-Party/Role binding is invalid')
    if not state['meta'].get('identityBindings'):
        raise ValueError('At least one approved human identity must be provisioned')
    if stage == 'pilot':
        from scripts.validate_product_configuration import validate_project_config
        validate_project_config(state['meta'].get('projectConfiguration', {}))
    return True


def provision_new(dsn, state, expected_sha256, stage):
    import psycopg
    validate_initial_snapshot(state, stage)
    if sha256(canonical(state)).hexdigest() != expected_sha256:
        raise ValueError('Approved initial snapshot hash mismatch')
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT version FROM doul_schema_version WHERE id=1')
            if cursor.fetchone() != (1,): raise ValueError('Explicit migration is required first')
            cursor.execute('SELECT payload FROM doul_snapshot_state WHERE id=1 FOR UPDATE')
            row = cursor.fetchone()
            if not row or row[0] is not None:
                raise ValueError('Provisioning never replaces existing application state')
            cursor.execute('UPDATE doul_snapshot_state SET payload=%s WHERE id=1', (canonical(state).decode(),))


def main():
    configure_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['migrate-v1','provision-new'])
    parser.add_argument('--snapshot')
    parser.add_argument('--approved-sha256')
    args = parser.parse_args()
    try:
        dsn = secret('DATABASE_ADMIN_URL')
        if args.operation == 'migrate-v1': migrate_v1(dsn)
        else:
            if not args.snapshot or not args.approved_sha256: raise ValueError('Approved snapshot and hash required')
            provision_new(dsn, json.loads(Path(args.snapshot).read_text()), args.approved_sha256, environment())
        emit('deployment', 'operator-operation-complete')
        return 0
    except Exception as exc:
        emit('deployment', 'operator-operation-refused', errorType=type(exc).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
