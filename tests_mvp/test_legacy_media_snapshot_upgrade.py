"""Regression coverage for media support on pre-media SQLite demo snapshots."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import base64
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.reference.engine import uid
from services.api.main import create_app
from services.api.store import Store


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
)


class LegacyMediaSnapshotUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'state.db')

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def drop_record(engine, kind, object_id):
        engine._records.pop((kind, object_id), None)
        engine._record_machines.pop((kind, object_id), None)
        for key in list(engine._history):
            if key[:2] == (kind, object_id):
                engine._history.pop(key)

    def create_legacy_snapshot(self):
        store = Store(self.path, demo=True)
        with store.transaction(True):
            evidence = deepcopy(store.engine.get('Evidence', store.meta['evidenceId']))
            audit = deepcopy(store.engine.audit_events)
            service_actors = deepcopy(store.meta.pop('serviceActors'))
            store.meta.pop('analysisProfile')
            for actor in service_actors.values():
                self.drop_record(store.engine, 'RoleAssignment', actor['roleAssignmentId'])
                self.drop_record(store.engine, 'Party', actor['partyId'])
            store.requests['legacy-upgrade-marker'] = {'hash': 'legacy', 'result': {'preserved': True}}
            project_id = store.meta['projectId']
        store.close()
        return project_id, evidence, audit

    def login(self, client, actor_group):
        response = client.post('/dev/sessions', json={'actorGroup': actor_group})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        return session, {
            'Authorization': 'Bearer ' + session['accessToken'],
            'X-RoleAssignment-Id': session['actor']['roleAssignmentId'],
        }

    def upload_photo(self, client, store, project_id, session, headers):
        scope = store.meta['scope']
        capture_id = uid()
        body = {
            'roleAssignmentId': session['actor']['roleAssignmentId'],
            'captureId': capture_id,
            'fileName': 'legacy-upgrade-photo.png',
            'mimeType': 'image/png',
            'byteCount': len(PNG),
            'expectedHash': sha256(PNG).hexdigest(),
            'sourcePartyId': session['actor']['partyId'],
            'mediaType': 'photo',
            'discipline': scope['discipline'],
            'packageId': scope['packageId'],
            'locationId': scope['locationId'],
        }
        started = client.post(
            f'/projects/{project_id}/uploads',
            headers={**headers, 'Idempotency-Key': capture_id},
            json=body,
        )
        self.assertEqual(started.status_code, 201, started.text)
        upload = started.json()
        chunk = client.put(
            f'/projects/{project_id}/uploads/{upload["id"]}/chunks',
            headers={
                **headers,
                'Idempotency-Key': uid(),
                'Upload-Offset': '0',
                'Content-Type': 'application/octet-stream',
            },
            content=PNG,
        )
        self.assertEqual(chunk.status_code, 200, chunk.text)
        completed = client.post(
            f'/projects/{project_id}/uploads/{upload["id"]}/complete',
            headers={**headers, 'Idempotency-Key': 'complete-' + capture_id},
            json={
                'roleAssignmentId': session['actor']['roleAssignmentId'],
                'expectedHash': sha256(PNG).hexdigest(),
            },
        )
        self.assertEqual(completed.status_code, 201, completed.text)
        return completed.json()

    def test_legacy_snapshot_is_upgraded_once_and_media_worker_runs(self):
        project_id, legacy_evidence, legacy_audit = self.create_legacy_snapshot()

        app = create_app(self.path, demo=True)
        store = app.state.store
        self.assertEqual(store.requests['legacy-upgrade-marker']['result'], {'preserved': True})
        self.assertEqual(store.engine.get('Evidence', legacy_evidence['id']), legacy_evidence)
        self.assertEqual(store.engine.audit_events, legacy_audit)
        self.assertIn('analysisProfile', store.meta)
        self.assertEqual(set(store.meta['serviceActors']), {'SYSTEM', 'AI'})
        service_ids = deepcopy(store.meta['serviceActors'])
        service_roles = [
            record for (kind, _), record in store.engine._records.items()
            if kind == 'RoleAssignment' and record.get('actorGroup') in {'SYSTEM', 'AI'}
        ]
        self.assertEqual(len(service_roles), 2)

        client = TestClient(app)
        supervisor, supervisor_headers = self.login(client, 'SUP')
        photo = self.upload_photo(client, store, project_id, supervisor, supervisor_headers)
        queued = client.post(
            f'/projects/{project_id}/media-analysis-runs',
            headers={**supervisor_headers, 'Idempotency-Key': uid()},
            json={
                'roleAssignmentId': supervisor['actor']['roleAssignmentId'],
                'clientObjectId': uid(),
                'sourceEvidenceIds': [photo['id']],
                'mode': 'photo',
                'languages': ['ko'],
            },
        )
        self.assertEqual(queued.status_code, 201, queued.text)
        run = queued.json()
        self.assertEqual(run['status'], 'queued')

        _, admin_headers = self.login(client, 'ADM')
        started = client.post(
            f'/dev/media-worker/projects/{project_id}/runs/{run["id"]}/start',
            headers={**admin_headers, 'Idempotency-Key': uid()},
            json={},
        )
        self.assertEqual(started.status_code, 200, started.text)
        self.assertEqual(started.json()['status'], 'running')
        client.close()
        store.close()

        reopened = create_app(self.path, demo=True)
        try:
            self.assertEqual(reopened.state.store.meta['serviceActors'], service_ids)
            service_roles = [
                record for (kind, _), record in reopened.state.store.engine._records.items()
                if kind == 'RoleAssignment' and record.get('actorGroup') in {'SYSTEM', 'AI'}
            ]
            self.assertEqual(len(service_roles), 2)
        finally:
            reopened.state.store.close()


if __name__ == '__main__':
    unittest.main()
