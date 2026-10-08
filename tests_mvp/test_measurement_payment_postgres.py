"""Run the F-05 HTTP acceptance chain against an isolated live PostgreSQL schema."""
import os
import re
import unittest
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from fastapi.testclient import TestClient

from services.api.main import create_app
from services.api.postgres_store import PostgresSnapshotAdapter
from tests_mvp.test_measurement_payment_http import MeasurementPaymentHttpTests


DSN = os.getenv("DOUL_TEST_POSTGRES_DSN", "")


def checked_test_settings(dsn):
    if os.getenv("DOUL_ENVIRONMENT", "development") != "development":
        raise ValueError("PostgreSQL acceptance requires the development environment")
    settings = conninfo_to_dict(dsn)
    name = settings.get("dbname", "")
    if not re.fullmatch(r"[A-Za-z0-9_]+", name) or "test" not in name.lower().split("_"):
        raise ValueError("Use a dedicated database with a 'test' name component")
    host = settings.get("host", "")
    if not (host in {"localhost", "127.0.0.1", "::1", "postgres"} or host.startswith("/")):
        raise ValueError("Use an explicit local/socket or CI PostgreSQL test host")
    if settings.get("hostaddr", "") not in {"", "127.0.0.1", "::1"}:
        raise ValueError("Remote hostaddr is prohibited for this acceptance suite")
    if settings.get("service") or "," in host:
        raise ValueError("Service indirection and multi-host DSNs are prohibited")
    return settings


@unittest.skipUnless(DSN, "DOUL_TEST_POSTGRES_DSN is not configured; live PostgreSQL not run")
class MeasurementPaymentPostgresTests(MeasurementPaymentHttpTests):
    def setUp(self):
        settings = checked_test_settings(DSN)
        self.schema_name = "doul_payment_acceptance_" + uuid4().hex
        with psycopg.connect(DSN, autocommit=True, connect_timeout=5) as connection:
            actual_name, version = connection.execute(
                "SELECT current_database(), current_setting('server_version_num')"
            ).fetchone()
            if actual_name != settings["dbname"] or int(version) < 160000:
                raise ValueError("Payment acceptance requires the configured PostgreSQL 16 test database")
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.schema_name)))
        self.addCleanup(self._drop_schema)

        scoped_dsn = make_conninfo(DSN, options="-c search_path=" + self.schema_name)
        self.store = PostgresSnapshotAdapter(scoped_dsn, demo=True)
        self.addCleanup(self._close_store)
        self.app = create_app(demo=True, persistence=self.store)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self._prepare_payment_fixture()

    def tearDown(self):
        # Registered cleanups close the app adapter before dropping its schema.
        pass

    def _close_store(self):
        if getattr(self, "store", None) is not None:
            self.store.close()

    def _drop_schema(self):
        with psycopg.connect(DSN, autocommit=True, connect_timeout=5) as connection:
            connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(self.schema_name)))


if __name__ == "__main__":
    unittest.main()
