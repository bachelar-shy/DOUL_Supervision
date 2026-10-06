"""PostgreSQL snapshot implementation of the application persistence port.

This adapter intentionally preserves the current in-memory Engine/Documents model
and snapshot semantics. It is a deployment bridge, not the later normalized
PostgreSQL domain schema. PostgreSQL connections are managed by ConnectionPool,
while RLock still serializes access to the single in-memory snapshot model.
"""
import base64
from contextlib import contextmanager
from copy import deepcopy
import json
from threading import RLock, local

from psycopg_pool import ConnectionPool

from app.reference.documents import Documents
from app.reference.engine import Engine

from .store import DOC_MAPS, ENGINE_MAPS, decode_map, encode_map


STATE_TABLE = "doul_snapshot_state"
BLOB_TABLE = "doul_snapshot_blobs"


class PostgresSnapshotAdapter:
    adapter_name = "postgresql-snapshot-development"

    def __init__(
        self,
        dsn,
        demo=True,
        connect_timeout=5,
        pool_min_size=1,
        pool_max_size=4,
        pool_timeout=5,
    ):
        if not isinstance(dsn, str) or not dsn.strip():
            raise ValueError("PostgreSQL DSN is required")
        if pool_min_size < 1 or pool_max_size < pool_min_size:
            raise ValueError("Invalid PostgreSQL pool size")

        self.lock = RLock()
        self._local = local()
        self.pool = ConnectionPool(
            conninfo=dsn,
            min_size=pool_min_size,
            max_size=pool_max_size,
            timeout=pool_timeout,
            kwargs={
                "autocommit": True,
                "connect_timeout": connect_timeout,
            },
            check=ConnectionPool.check_connection,
            open=True,
        )
        self.pool.wait(timeout=connect_timeout + pool_timeout)

        self.engine = Engine()
        self.documents = Documents(self.engine)
        self.meta = {}
        self.uploads = {}
        self.requests = {}
        self.conflicts = []

        self._ensure_schema()
        with self.lock:
            with self._transaction_connection():
                loaded = self._load(lock=True)
                if not loaded:
                    if not demo:
                        raise RuntimeError(
                            "No production provisioning/authentication adapter configured"
                        )
                    from .demo import seed

                    data = seed(self.engine)
                    for file_id, content in data.pop("blobs").items():
                        self.put_blob(file_id, content)
                    self.meta = data
                    self._save()
                elif demo:
                    from .demo import ensure_media_demo_support

                    if ensure_media_demo_support(self.engine, self.meta):
                        self._save()

    @contextmanager
    def _connection(self):
        bound = getattr(self._local, "connection", None)
        if bound is not None:
            yield bound
            return
        with self.pool.connection() as conn:
            yield conn

    @contextmanager
    def _transaction_connection(self):
        bound = getattr(self._local, "connection", None)
        if bound is not None:
            with bound.transaction():
                yield bound
            return

        with self.pool.connection() as conn:
            self._local.connection = conn
            try:
                with conn.transaction():
                    yield conn
            finally:
                del self._local.connection

    def _execute(self, query, params=None):
        with self._connection() as conn:
            conn.execute(query, params)

    def _fetchone(self, query, params=None):
        with self._connection() as conn:
            return conn.execute(query, params).fetchone()

    def _ensure_schema(self):
        with self.pool.connection() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {STATE_TABLE} (
                    id SMALLINT PRIMARY KEY CHECK (id = 1),
                    payload TEXT
                )
                """
            )
            conn.execute(
                f"""
                INSERT INTO {STATE_TABLE}(id, payload)
                VALUES (1, NULL)
                ON CONFLICT (id) DO NOTHING
                """
            )
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {BLOB_TABLE} (
                    id TEXT PRIMARY KEY,
                    content BYTEA NOT NULL
                )
                """
            )

    def export_state(self):
        return dict(
            format=1,
            engine={
                key: encode_map(getattr(self.engine, key))
                for key in ENGINE_MAPS
            },
            audit=self.engine._audit,
            escalations=[list(key) for key in self.engine._escalation_keys],
            documents={
                key: encode_map(getattr(self.documents, key))
                for key in DOC_MAPS
            },
            documentBytes={
                key: base64.b64encode(value).decode()
                for key, value in self.documents._bytes.items()
            },
            meta=self.meta,
            uploads=self.uploads,
            requests=self.requests,
            conflicts=self.conflicts,
        )

    def restore(self, state):
        if state["format"] != 1:
            raise RuntimeError("Unsupported development snapshot format")
        for key, value in state["engine"].items():
            setattr(self.engine, key, decode_map(value))
        self.engine._audit = state["audit"]
        self.engine._escalation_keys = {
            tuple(key) for key in state["escalations"]
        }
        for key, value in state["documents"].items():
            setattr(self.documents, key, decode_map(value))
        self.documents._bytes = {
            key: base64.b64decode(value)
            for key, value in state["documentBytes"].items()
        }
        self.engine.documents = deepcopy(self.documents._snapshots)
        self.meta = state["meta"]
        self.uploads = state["uploads"]
        self.requests = state["requests"]
        self.conflicts = state["conflicts"]

    def _load(self, lock=False):
        suffix = " FOR UPDATE" if lock else ""
        row = self._fetchone(
            f"SELECT payload FROM {STATE_TABLE} WHERE id = 1{suffix}"
        )
        if row is None or row[0] is None:
            return False
        self.restore(json.loads(row[0]))
        return True

    def _save(self):
        payload = json.dumps(
            self.export_state(),
            ensure_ascii=False,
            allow_nan=False,
        )
        self._execute(
            f"UPDATE {STATE_TABLE} SET payload = %s WHERE id = 1",
            (payload,),
        )

    @contextmanager
    def transaction(self, write=False):
        with self.lock:
            before = None
            try:
                with self._transaction_connection():
                    loaded = self._load(lock=write)
                    if not loaded:
                        raise RuntimeError("PostgreSQL snapshot state is not initialized")
                    before = deepcopy(self.export_state())
                    yield self
                    if write:
                        self._save()
            except BaseException:
                if before is not None:
                    self.restore(before)
                raise

    def put_blob(self, file_id, content):
        self._execute(
            f"""
            INSERT INTO {BLOB_TABLE}(id, content)
            VALUES (%s, %s)
            ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content
            """,
            (file_id, bytes(content)),
        )

    def blob(self, file_id):
        row = self._fetchone(
            f"SELECT content FROM {BLOB_TABLE} WHERE id = %s",
            (file_id,),
        )
        if row is None:
            raise KeyError("Blob not found")
        return bytes(row[0])

    def close(self):
        self.pool.close()
