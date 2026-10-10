"""Telemetry sink failures must not change HTTP or domain outcomes."""
import io
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter
from services.telemetry import emit


class BrokenPipeSink:
    def write(self, _value):
        raise BrokenPipeError("closed log pipe")

    def flush(self):
        raise BrokenPipeError("closed log pipe")


class TelemetrySinkFailureHttpTests(unittest.TestCase):
    def test_health_authority_and_version_outcomes_survive_stdout_failure(self):
        store = SQLiteSnapshotAdapter(':memory:')
        self.addCleanup(store.close)
        app = create_app(demo=True, persistence=store)
        stderr = io.StringIO()
        with TestClient(app) as client, patch('services.telemetry.sys.stdout', BrokenPipeSink()), patch('services.telemetry.sys.stderr', stderr):
            health = client.get('/health')
            self.assertEqual(health.status_code, 200, health.text)

            session = client.post('/dev/sessions', json={'actorGroup': 'SUP'}).json()
            project = session['projectId']
            role = session['actor']['roleAssignmentId']
            headers = {'Authorization': 'Bearer ' + session['accessToken'], 'X-RoleAssignment-Id': role}
            workspace = client.get(f'/projects/{project}/workspace', headers=headers)
            self.assertEqual(workspace.status_code, 200, workspace.text)
            inspection = next(item for item in workspace.json()['items']
                              if item['machine'] == 'inspection' and item['record']['status'] == 'scheduled')
            inspection_id = inspection['record']['id']
            original_version = inspection['record']['version']

            contractor_role = store.meta['actors']['CON']['roleAssignmentId']
            denied = client.post(
                f"/projects/{project}/inspections/{inspection_id}/start",
                headers={**headers, 'X-RoleAssignment-Id': contractor_role, 'Idempotency-Key': 'denied-start'},
                json={'roleAssignmentId': contractor_role, 'expectedVersion': original_version, 'payload': {}, 'evidenceIds': []},
            )
            self.assertEqual(denied.status_code, 403, denied.text)

            audit_before = len(store.engine.audit_events)
            started = client.post(
                f"/projects/{project}/inspections/{inspection_id}/start",
                headers={**headers, 'Idempotency-Key': 'successful-start'},
                json={'roleAssignmentId': role, 'expectedVersion': original_version, 'payload': {}, 'evidenceIds': []},
            )
            self.assertEqual(started.status_code, 200, started.text)
            self.assertEqual(started.json()['record']['status'], 'in_progress')
            self.assertEqual(len(store.engine.audit_events), audit_before + 1)

            stale = client.post(
                f"/projects/{project}/inspections/{inspection_id}/start",
                headers={**headers, 'Idempotency-Key': 'stale-start'},
                json={'roleAssignmentId': role, 'expectedVersion': original_version, 'payload': {}, 'evidenceIds': []},
            )
            self.assertEqual(stale.status_code, 409, stale.text)
            self.assertEqual(stale.json()['code'], 'VERSION_CONFLICT')

            persisted = client.get(f'/projects/{project}/inspections/{inspection_id}', headers=headers)
            self.assertEqual(persisted.status_code, 200, persisted.text)
            self.assertEqual(persisted.json()['status'], 'in_progress')

        telemetry = [json.loads(line) for line in stderr.getvalue().splitlines()]
        self.assertGreaterEqual(len(telemetry), 6)
        statuses = [row.get('statusCode') for row in telemetry if row.get('event') == 'http-request']
        self.assertIn(200, statuses)
        self.assertIn(403, statuses)
        self.assertIn(409, statuses)
        self.assertNotIn('closed log pipe', stderr.getvalue())

    def test_emit_returns_false_when_both_sinks_fail_and_validation_still_raises(self):
        sink = BrokenPipeSink()
        with patch('services.telemetry.sys.stdout', sink), patch('services.telemetry.sys.stderr', sink):
            self.assertFalse(emit('api', 'http-request', method='GET', route='/health'))
            with self.assertRaises(ValueError):
                emit('Invalid Component', 'http-request', method='GET', route='/health')


if __name__ == '__main__':
    unittest.main()
