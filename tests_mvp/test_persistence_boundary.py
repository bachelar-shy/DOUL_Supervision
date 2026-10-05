import unittest
from contextlib import contextmanager

from fastapi.testclient import TestClient

from services.api.main import create_app
from services.api.persistence import PersistencePort
from services.api.store import SQLiteSnapshotAdapter


class RecordingPersistence:
    """Test double exposing only the application persistence port surface."""

    adapter_name='recording-test-adapter'

    def __init__(self):
        self.inner=SQLiteSnapshotAdapter(':memory:',demo=True)
        self.transactions=[]

    @property
    def engine(self):return self.inner.engine

    @property
    def documents(self):return self.inner.documents

    @property
    def meta(self):return self.inner.meta

    @property
    def uploads(self):return self.inner.uploads

    @property
    def requests(self):return self.inner.requests

    @property
    def conflicts(self):return self.inner.conflicts

    @contextmanager
    def transaction(self,write=False):
        self.transactions.append(write)
        with self.inner.transaction(write):
            yield self

    def put_blob(self,file_id,content):self.inner.put_blob(file_id,content)

    def blob(self,file_id):return self.inner.blob(file_id)

    def close(self):self.inner.close()


class PersistenceBoundaryTests(unittest.TestCase):
    def test_sqlite_adapter_satisfies_application_port(self):
        adapter=SQLiteSnapshotAdapter(':memory:',demo=True)
        try:self.assertIsInstance(adapter,PersistencePort)
        finally:adapter.close()

    def test_http_application_accepts_port_without_sqlite_specific_surface(self):
        persistence=RecordingPersistence()
        self.assertIsInstance(persistence,PersistencePort)
        app=create_app(demo=True,persistence=persistence)
        client=TestClient(app)
        try:
            health=client.get('/health')
            self.assertEqual(health.status_code,200)
            self.assertEqual(health.json()['adapters']['database'],'recording-test-adapter')
            actors=client.get('/dev/actors')
            self.assertEqual(actors.status_code,200)
            self.assertTrue(persistence.transactions)
        finally:
            client.close()
            persistence.close()


if __name__=='__main__':unittest.main()
