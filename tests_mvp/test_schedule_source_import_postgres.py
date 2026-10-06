"""Live PostgreSQL acceptance; never substitute SQLite or a fake connection.

Set DOUL_TEST_POSTGRES_DSN to an explicitly named disposable test database.
Every case owns a unique schema, and cleanup drops only that schema. The inherited
source-import scenarios run unchanged against the real PostgreSQL adapter.
"""
from copy import deepcopy
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app
from services.api.postgres_store import (
    BLOB_TABLE, STATE_TABLE, PostgresSnapshotAdapter,
)
from tests_mvp import test_schedule_source_import_http as source_http


DSN = os.getenv("DOUL_TEST_POSTGRES_DSN", "")


def checked_test_settings(dsn):
    """Fail before connection/DDL when the database is not an explicit test target."""
    if os.getenv("DOUL_ENVIRONMENT", "development") != "development":
        raise ValueError("PostgreSQL acceptance requires the development environment")
    settings = conninfo_to_dict(dsn)
    name = settings.get("dbname", "")
    if not re.fullmatch(r"[A-Za-z0-9_]+", name) or "test" not in name.lower().split("_"):
        raise ValueError("Use a dedicated database with a 'test' name component")
    host = settings.get("host", "")
    if not (host in {"localhost", "127.0.0.1", "::1", "postgres"} or host.startswith("/")):
        raise ValueError("Use an explicit local/socket or CI postgres test host")
    if settings.get("hostaddr", "") not in {"", "127.0.0.1", "::1"}:
        raise ValueError("Remote hostaddr is prohibited for this acceptance suite")
    if settings.get("service") or "," in host:
        raise ValueError("Service indirection and multi-host DSNs are prohibited")
    return settings


class PostgresSourceImportSafetyTests(unittest.TestCase):
    def test_operational_database_name_rejected_before_connection(self):
        with self.assertRaises(ValueError):
            checked_test_settings("postgresql://localhost/doul_production")

    def test_remote_host_rejected_before_connection(self):
        with self.assertRaises(ValueError):
            checked_test_settings("postgresql://db.example.invalid/doul_test")

    def test_remote_hostaddr_rejected_before_connection(self):
        with self.assertRaises(ValueError):
            checked_test_settings("host=localhost hostaddr=192.0.2.1 dbname=doul_test")

    def test_pilot_environment_rejected_before_connection(self):
        with patch.dict(os.environ, {"DOUL_ENVIRONMENT": "pilot"}):
            with self.assertRaises(ValueError):
                checked_test_settings("postgresql://localhost/doul_test")


@unittest.skipUnless(DSN, "DOUL_TEST_POSTGRES_DSN is not configured; live PostgreSQL not run")
class ScheduleSourceImportPostgresTests(source_http.ScheduleSourceImportTests):
    def setUp(self):
        settings = checked_test_settings(DSN)
        self.client = self.app = self.store = None
        self.schema_name = "doul_schedule_import_" + uuid4().hex
        with psycopg.connect(DSN, autocommit=True, connect_timeout=5) as conn:
            actual_name, version = conn.execute(
                "SELECT current_database(), current_setting('server_version_num')"
            ).fetchone()
            self.assertEqual(actual_name, settings["dbname"])
            self.assertGreaterEqual(int(version), 160000)
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema_name)))
        self.addCleanup(self._drop_owned_schema)
        self.addCleanup(self._close_app)
        self.dsn = make_conninfo(DSN, options="-c search_path=" + self.schema_name)
        self._open_app()
        self.project_id = self.sessions["CON"]["projectId"]
        self.scope = self.workspace_scope(self.sessions["CON"], self.headers["CON"])
        self.evidence_id = self.store.meta["evidenceId"]

    def tearDown(self):
        # unittest cleanups also execute when setUp or an assertion fails.
        pass

    def _drop_owned_schema(self):
        with psycopg.connect(DSN, autocommit=True, connect_timeout=5) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(self.schema_name)))

    def _close_app(self):
        if self.client is not None:
            self.client.close()
            self.client = None
        if self.store is not None:
            self.store.close()
            self.store = None
        self.app = None

    def _open_app(self):
        self.store = PostgresSnapshotAdapter(self.dsn, demo=True)
        self.app = create_app(demo=True, persistence=self.store, queue_enabled=False)
        self.client = TestClient(self.app)
        self.assertIsInstance(self.app.state.store, PostgresSnapshotAdapter)
        self.sessions, self.headers = {}, {}
        for group in ("CON", "SUP", "OWN"):
            self.sessions[group], self.headers[group] = self.login(group)
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200, health.text)
        self.assertEqual(health.json()["adapters"]["database"], "postgresql-snapshot-development")

    def reopen(self):
        self._close_app()
        self._open_app()

    def durable_state(self):
        """Read committed database state using an independent physical connection."""
        with psycopg.connect(self.dsn, connect_timeout=5) as conn:
            state = json.loads(conn.execute(
                sql.SQL("SELECT payload FROM {} WHERE id=1").format(sql.Identifier(STATE_TABLE))
            ).fetchone()[0])
            blobs = {
                key: sha256(bytes(content)).hexdigest()
                for key, content in conn.execute(
                    sql.SQL("SELECT id, content FROM {} ORDER BY id").format(sql.Identifier(BLOB_TABLE))
                ).fetchall()
            }
        return {"snapshot": state, "blob_hashes": blobs}

    def assert_rollback(self, package, code):
        before = self.durable_state()
        super().assert_rollback(package, code)
        self.assertEqual(self.durable_state(), before)

    def test_partial_activity_failure_rolls_back_durably_and_key_can_retry(self):
        package = self.package(activities=[
            {"clientObjectId": uid(), "data": {
                "activityId": "A1", "wbsPath": "1", "activityName": "First", "critical": True,
            }},
            {"clientObjectId": uid(), "data": {
                "activityId": "A2", "wbsPath": "1", "activityName": "Second",
            }},
        ])
        key = uid()
        before = self.durable_state()
        engine = self.store.engine
        save = engine._save
        writes = []

        def fail_second(kind, record):
            if record["id"] == package["activities"][1]["clientObjectId"]:
                raise RuntimeError("Injected failure after the first activity and its audit")
            writes.append(record["id"])
            return save(kind, record)

        with patch.object(engine, "_save", side_effect=fail_second):
            with self.assertRaises(RuntimeError):
                self.submit(package, key)
        self.assertIn(package["activities"][0]["clientObjectId"], writes)
        self.assertEqual(self.durable_state(), before)
        self.assertEqual(json.loads(json.dumps(self.store.export_state())), before["snapshot"])
        self.reopen()
        self.assertEqual(self.durable_state(), before)
        self.assertEqual(self.source(package["clientObjectId"]).status_code, 404)
        result = self.imported_with_key(package, key)
        self.assertEqual(result["record"]["schedule"]["activityCount"], 2)

    def test_real_sql_failure_rolls_back_snapshot_blob_audit_history_and_idempotency(self):
        package = self.package()
        key = uid()
        before = self.durable_state()
        store = self.store
        save = store._save
        phantom_blob = "rollback-probe-" + uid()
        reached_sql = []

        def fail_after_snapshot_update():
            save()  # A real UPDATE has already written the new aggregate in this transaction.
            store.put_blob(phantom_blob, b"must be rolled back with the snapshot")
            reached_sql.append(True)
            store._execute("SELECT 1 / 0")  # Real PostgreSQL error aborts the transaction.

        with patch.object(store, "_save", side_effect=fail_after_snapshot_update):
            with self.assertRaises(psycopg.errors.DivisionByZero):
                self.submit(package, key)
        self.assertEqual(reached_sql, [True])
        self.assertEqual(self.durable_state(), before)
        self.assertEqual(json.loads(json.dumps(store.export_state())), before["snapshot"])
        self.reopen()
        self.assertEqual(self.durable_state(), before)
        result = self.imported_with_key(package, key)
        after = self.durable_state()
        self.assertNotIn(phantom_blob, after["blob_hashes"])
        self.assertEqual(self.submit(package, key).json(), result)
        self.assertEqual(self.durable_state(), after)

    def test_new_process_preserves_workflows_originals_and_exact_replay(self):
        baseline_package = self.package()
        baseline_key = uid()
        baseline_result = self.imported_with_key(baseline_package, baseline_key)
        baseline = self.activate_baseline(baseline_result["record"])
        original_activity = baseline_result["activityRefs"][0]
        progress_package = self.package(
            kind="progress_update", baseline=baseline,
            activities=[{"clientObjectId": uid(), "data": {
                "activityId": "A1", "wbsPath": "1", "activityName": "Actual progress",
                "critical": True, "percentComplete": 35, "baselineActivityRef": original_activity,
            }}],
        )
        first = self.freeze_imported(baseline, progress_package)
        prior = self.ref(first)
        correction_package = self.package(
            kind="progress_update", baseline=baseline,
            changes={"previousScheduleRef": prior, "correctionOfRef": prior,
                     "correctionReason": "Verified correction"},
        )
        corrected = self.freeze_imported(baseline, correction_package)
        recovery = self.imported(self.package(kind="recovery"))["record"]
        ids = [baseline["id"], first["id"], corrected["id"], recovery["id"]]
        sources = {oid: self.source(oid).json() for oid in ids}
        expected = self.durable_state()
        probe = {
            "project_id": self.project_id, "package": baseline_package,
            "key": baseline_key, "result": baseline_result, "sources": sources,
            "expected": expected,
            "statuses": {baseline["id"]: "effective", first["id"]: "superseded",
                         corrected["id"]: "frozen", recovery["id"]: "snapshot"},
        }
        self._close_app()
        completed = subprocess.run(
            [sys.executable, "-c", FRESH_PROCESS_PROBE],
            input=json.dumps(probe), capture_output=True, text=True,
            cwd=Path(__file__).resolve().parents[1],
            env={**os.environ, "DOUL_TEST_POSTGRES_DSN": self.dsn}, timeout=90,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr[-6000:])
        self.assertIn("POSTGRES_FRESH_PROCESS_OK", completed.stdout)
        self._open_app()
        self.assertEqual(self.durable_state(), expected)
        self.assertEqual(self.store.engine.get("InformationItem", baseline["id"]), baseline)


FRESH_PROCESS_PROBE = r'''
from copy import deepcopy
from hashlib import sha256
import json, os, sys
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from services.api.main import create_app
from services.api.postgres_store import PostgresSnapshotAdapter, STATE_TABLE, BLOB_TABLE

def require(condition, label):
    if not condition:
        raise AssertionError(label)

def durable(dsn):
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        snapshot = json.loads(conn.execute(sql.SQL('SELECT payload FROM {} WHERE id=1').format(sql.Identifier(STATE_TABLE))).fetchone()[0])
        blobs = {key: sha256(bytes(value)).hexdigest() for key, value in conn.execute(sql.SQL('SELECT id, content FROM {}').format(sql.Identifier(BLOB_TABLE))).fetchall()}
    return {'snapshot': snapshot, 'blob_hashes': blobs}

probe = json.load(sys.stdin)
dsn = os.environ['DOUL_TEST_POSTGRES_DSN']
require(durable(dsn) == probe['expected'], 'committed aggregate changed across process boundary')
store = PostgresSnapshotAdapter(dsn, demo=True)
try:
    with TestClient(create_app(demo=True, persistence=store, queue_enabled=False)) as client:
        login = client.post('/dev/sessions', json={'actorGroup': 'CON'})
        require(login.status_code == 200, 'login failed')
        session = login.json()
        headers = {'Authorization': 'Bearer ' + session['accessToken'],
                   'X-RoleAssignment-Id': session['actor']['roleAssignmentId']}
        project = probe['project_id']
        for oid, source in probe['sources'].items():
            result = client.get(f'/projects/{project}/schedule-source-imports/{oid}', headers=headers)
            require(result.status_code == 200 and result.json() == source, 'original source not preserved')
            require(source['record']['version'] == 1, 'original schedule is not version 1')
            for activity in source['activities']:
                require(activity['data']['sourceScheduleRef'] == source['sourceScheduleRef'], 'activity source reference changed')
            require(store.engine.get('InformationItem', oid)['status'] == probe['statuses'][oid], 'workflow state not preserved')
        headers['Idempotency-Key'] = probe['key']
        replay = client.post(f'/projects/{project}/schedule-source-imports', headers=headers, json=probe['package'])
        require(replay.status_code == 201 and replay.json() == probe['result'], 'exact replay failed after workflow and restart')
        changed = deepcopy(probe['package'])
        changed['title'] = 'A different request with the same key'
        conflict = client.post(f'/projects/{project}/schedule-source-imports', headers=headers, json=changed)
        require(conflict.status_code == 409 and conflict.json()['code'] == 'IDEMPOTENCY_CONFLICT', 'changed request was not rejected')
        require(durable(dsn) == probe['expected'], 'replay/conflict created duplicate audit, history, records or requests')
finally:
    store.close()
print('POSTGRES_FRESH_PROCESS_OK')
'''
