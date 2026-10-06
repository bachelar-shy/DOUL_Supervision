"""Coverage for the PostgreSQL snapshot persistence adapter."""
from contextlib import contextmanager
from copy import deepcopy
import os
from threading import Lock, Thread
import time
import unittest
from unittest.mock import patch

import psycopg
from fastapi.testclient import TestClient

from services.api.main import create_app
from services.api.persistence import PersistencePort
from services.api.postgres_store import (
    BLOB_TABLE,
    STATE_TABLE,
    PostgresSnapshotAdapter,
)


DSN = os.getenv("DOUL_TEST_POSTGRES_DSN", "")


class FakeCursor:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return deepcopy(self.row)


class FakePostgresBackend:
    def __init__(self):
        self.payload_exists = False
        self.payload = None
        self.blobs = {}


class FakeConnection:
    """Transaction-aware stand-in for unit testing adapter behavior."""

    def __init__(self, backend):
        self.backend = backend

    def execute(self, query, params=None):
        sql = " ".join(query.split()).upper()
        params = params or ()

        if sql.startswith("CREATE TABLE"):
            return FakeCursor()
        if f"INSERT INTO {STATE_TABLE.upper()}" in sql:
            self.backend.payload_exists = True
            return FakeCursor()
        if f"SELECT PAYLOAD FROM {STATE_TABLE.upper()}" in sql:
            row = (
                (self.backend.payload,)
                if self.backend.payload_exists
                else None
            )
            return FakeCursor(row)
        if f"UPDATE {STATE_TABLE.upper()} SET PAYLOAD" in sql:
            self.backend.payload_exists = True
            self.backend.payload = params[0]
            return FakeCursor()
        if f"INSERT INTO {BLOB_TABLE.upper()}" in sql:
            self.backend.blobs[params[0]] = bytes(params[1])
            return FakeCursor()
        if f"SELECT CONTENT FROM {BLOB_TABLE.upper()}" in sql:
            value = self.backend.blobs.get(params[0])
            return FakeCursor(None if value is None else (value,))
        raise AssertionError(f"Unexpected SQL in fake PostgreSQL adapter: {query}")

    @contextmanager
    def transaction(self):
        before = (
            self.backend.payload_exists,
            deepcopy(self.backend.payload),
            deepcopy(self.backend.blobs),
        )
        try:
            yield self
        except BaseException:
            (
                self.backend.payload_exists,
                self.backend.payload,
                self.backend.blobs,
            ) = before
            raise


def fake_pool_class(backend, connection_class=FakeConnection):
    class FakePool:
        check_connection = staticmethod(lambda conn: None)

        def __init__(
            self,
            conninfo,
            min_size,
            max_size,
            timeout,
            kwargs,
            check,
            open,
        ):
            self.conninfo = conninfo
            self.min_size = min_size
            self.max_size = max_size
            self.timeout = timeout
            self.kwargs = kwargs
            self.check = check
            self.open = open
            self.wait_timeout = None
            self.closed = False
            self.checkout_count = 0

        def wait(self, timeout):
            self.wait_timeout = timeout

        @contextmanager
        def connection(self):
            self.checkout_count += 1
            yield connection_class(backend)

        def close(self):
            self.closed = True

    return FakePool


class PostgresSnapshotAdapterUnitTests(unittest.TestCase):
    def test_adapter_uses_pool_persists_and_rolls_back(self):
        backend = FakePostgresBackend()
        FakePool = fake_pool_class(backend)

        with patch("services.api.postgres_store.ConnectionPool", FakePool):
            adapter = PostgresSnapshotAdapter(
                "postgresql://unit-test",
                demo=True,
                connect_timeout=3,
                pool_min_size=2,
                pool_max_size=6,
                pool_timeout=4,
            )
            self.assertIsInstance(adapter, PersistencePort)
            self.assertEqual(adapter.pool.conninfo, "postgresql://unit-test")
            self.assertEqual(adapter.pool.min_size, 2)
            self.assertEqual(adapter.pool.max_size, 6)
            self.assertEqual(adapter.pool.timeout, 4)
            self.assertEqual(
                adapter.pool.kwargs,
                {"autocommit": True, "connect_timeout": 3},
            )
            self.assertEqual(adapter.pool.wait_timeout, 7)

            project_id = adapter.meta["projectId"]
            with adapter.transaction(True):
                adapter.requests["committed"] = {
                    "hash": "one",
                    "result": {"projectId": project_id},
                }
                adapter.put_blob("committed-blob", b"kept")

            with self.assertRaises(RuntimeError):
                with adapter.transaction(True):
                    adapter.requests["rolled-back"] = {
                        "hash": "two",
                        "result": {"persist": False},
                    }
                    adapter.put_blob("rolled-back-blob", b"discard")
                    raise RuntimeError("force rollback")

            reopened = PostgresSnapshotAdapter("postgresql://unit-test", demo=True)
            try:
                with reopened.transaction():
                    self.assertEqual(
                        reopened.requests["committed"]["result"]["projectId"],
                        project_id,
                    )
                    self.assertNotIn("rolled-back", reopened.requests)
                    self.assertEqual(reopened.blob("committed-blob"), b"kept")
                    with self.assertRaises(KeyError):
                        reopened.blob("rolled-back-blob")

                app = create_app(demo=True, persistence=reopened)
                with TestClient(app) as client:
                    health = client.get("/health")
                    self.assertEqual(health.status_code, 200)
                    self.assertEqual(
                        health.json()["adapters"]["database"],
                        "postgresql-snapshot-development",
                    )
            finally:
                adapter.close()
                reopened.close()

            self.assertTrue(adapter.pool.closed)
            self.assertTrue(reopened.pool.closed)

    def test_transaction_binds_one_pooled_connection_for_snapshot_and_blob(self):
        backend = FakePostgresBackend()
        connection_ids = []
        next_id = 0

        class TrackingConnection(FakeConnection):
            def __init__(self, backend):
                nonlocal next_id
                super().__init__(backend)
                next_id += 1
                self.connection_id = next_id

            def execute(self, query, params=None):
                connection_ids.append(self.connection_id)
                return super().execute(query, params)

        FakePool = fake_pool_class(backend, TrackingConnection)

        with patch("services.api.postgres_store.ConnectionPool", FakePool):
            adapter = PostgresSnapshotAdapter("postgresql://unit-test", demo=True)
            connection_ids.clear()

            with adapter.transaction(True):
                adapter.requests["atomic"] = {
                    "hash": "atomic",
                    "result": {"ok": True},
                }
                adapter.put_blob("atomic-blob", b"same-transaction")

            adapter.close()

        self.assertGreater(len(connection_ids), 2)
        self.assertEqual(len(set(connection_ids)), 1)

    def test_snapshot_model_is_serialized_while_pool_manages_connections(self):
        backend = FakePostgresBackend()
        counter_lock = Lock()
        active = 0
        max_active = 0

        class TrackingConnection(FakeConnection):
            @contextmanager
            def transaction(self):
                nonlocal active, max_active
                with counter_lock:
                    active += 1
                    max_active = max(max_active, active)
                try:
                    with super().transaction():
                        yield self
                finally:
                    with counter_lock:
                        active -= 1

        FakePool = fake_pool_class(backend, TrackingConnection)

        with patch("services.api.postgres_store.ConnectionPool", FakePool):
            adapter = PostgresSnapshotAdapter("postgresql://unit-test", demo=True)
            failures = []

            def worker(index):
                try:
                    with adapter.transaction():
                        _ = adapter.meta["projectId"]
                        time.sleep(0.02)
                except BaseException as exc:
                    failures.append((index, exc))

            threads = [Thread(target=worker, args=(index,)) for index in range(4)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            adapter.close()

        self.assertEqual(failures, [])
        self.assertEqual(max_active, 1)


@unittest.skipUnless(DSN, "DOUL_TEST_POSTGRES_DSN is not configured")
class PostgresPersistenceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.reset_database()

    def tearDown(self):
        self.reset_database()

    def reset_database(self):
        if not DSN:
            return
        with psycopg.connect(DSN, autocommit=True) as conn:
            conn.execute(f"DROP TABLE IF EXISTS {BLOB_TABLE}")
            conn.execute(f"DROP TABLE IF EXISTS {STATE_TABLE}")

    def test_adapter_persists_state_and_blobs_across_reopen(self):
        adapter = PostgresSnapshotAdapter(DSN, demo=True)
        self.assertIsInstance(adapter, PersistencePort)
        project_id = adapter.meta["projectId"]
        blob_id = "postgres-persistence-probe"
        try:
            with adapter.transaction(True):
                adapter.requests["probe"] = {
                    "hash": "abc",
                    "result": {"projectId": project_id},
                }
                adapter.put_blob(blob_id, b"postgres-blob")
        finally:
            adapter.close()

        reopened = PostgresSnapshotAdapter(DSN, demo=True)
        try:
            with reopened.transaction():
                self.assertEqual(
                    reopened.requests["probe"]["result"]["projectId"],
                    project_id,
                )
                self.assertEqual(reopened.blob(blob_id), b"postgres-blob")
                self.assertEqual(reopened.meta["projectId"], project_id)
        finally:
            reopened.close()

    def test_transaction_rolls_back_snapshot_and_blob_together(self):
        adapter = PostgresSnapshotAdapter(DSN, demo=True)
        try:
            with self.assertRaises(RuntimeError):
                with adapter.transaction(True):
                    adapter.requests["rollback-probe"] = {
                        "hash": "rollback",
                        "result": {"shouldPersist": False},
                    }
                    adapter.put_blob("rollback-blob", b"discard-me")
                    raise RuntimeError("force rollback")

            with adapter.transaction():
                self.assertNotIn("rollback-probe", adapter.requests)
                with self.assertRaises(KeyError):
                    adapter.blob("rollback-blob")
        finally:
            adapter.close()

    def test_instances_reload_committed_state_and_http_uses_adapter(self):
        first = PostgresSnapshotAdapter(DSN, demo=True)
        second = PostgresSnapshotAdapter(DSN, demo=True)
        try:
            with first.transaction(True):
                first.requests["cross-instance"] = {
                    "hash": "one",
                    "result": {"visible": True},
                }

            with second.transaction():
                self.assertTrue(
                    second.requests["cross-instance"]["result"]["visible"]
                )

            app = create_app(demo=True, persistence=second)
            with TestClient(app) as client:
                health = client.get("/health")
                self.assertEqual(health.status_code, 200)
                self.assertEqual(
                    health.json()["adapters"]["database"],
                    "postgresql-snapshot-development",
                )
                session = client.post(
                    "/dev/sessions",
                    json={"actorGroup": "SUP"},
                )
                self.assertEqual(session.status_code, 200, session.text)
                payload = session.json()
                workspace = client.get(
                    f"/projects/{payload['projectId']}/workspace",
                    headers={
                        "Authorization": "Bearer " + payload["accessToken"],
                        "X-RoleAssignment-Id": payload["actor"]["roleAssignmentId"],
                    },
                )
                self.assertEqual(workspace.status_code, 200, workspace.text)
        finally:
            first.close()
            second.close()


if __name__ == "__main__":
    unittest.main()
