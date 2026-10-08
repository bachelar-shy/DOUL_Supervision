"""Run F-07 HTTP acceptance against a disposable PostgreSQL 16 schema."""
import os
import unittest
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from fastapi.testclient import TestClient

from services.api.main import create_app
from services.api.postgres_store import PostgresSnapshotAdapter
from tests_mvp import test_handover_http as handover_http
from tests_mvp.test_schedule_source_import_postgres import checked_test_settings


DSN = os.getenv("DOUL_TEST_POSTGRES_DSN", "")


@unittest.skipUnless(DSN, "DOUL_TEST_POSTGRES_DSN is not configured; live PostgreSQL not run")
class HandoverPostgresTests(handover_http.HandoverHttpTests):
    def setUp(self):
        settings = checked_test_settings(DSN)
        self.schema_name = "doul_handover_acceptance_" + uuid4().hex
        with psycopg.connect(DSN, autocommit=True, connect_timeout=5) as connection:
            actual_name, version = connection.execute(
                "SELECT current_database(), current_setting('server_version_num')"
            ).fetchone()
            if actual_name != settings["dbname"] or int(version) < 160000:
                raise ValueError("Handover acceptance requires the configured PostgreSQL 16 test database")
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema_name)))
        self.addCleanup(self._drop_schema)
        scoped_dsn = make_conninfo(DSN, options="-c search_path=" + self.schema_name)
        self.store = PostgresSnapshotAdapter(scoped_dsn, demo=True)
        self.addCleanup(self.store.close)
        self.app = create_app(demo=True, persistence=self.store)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self._set_up_handover_fixture()

    def tearDown(self):
        # AddCleanup closes the client and adapter before dropping this schema.
        pass

    def _drop_schema(self):
        with psycopg.connect(DSN, autocommit=True, connect_timeout=5) as connection:
            connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(self.schema_name)))


if __name__ == "__main__":
    unittest.main()
