"""Authenticated API adapters for the read-only parallel workspace projections."""
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
from services.api.main import create_app
from app.reference.engine import uid


class ParallelWorkspaceApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(str(Path(self.temp.name) / 'state.db'), demo=True)
        self.client = TestClient(self.app)
        session_response = self.client.post('/dev/sessions', json={'actorGroup': 'SUP'})
        self.assertEqual(session_response.status_code, 200, session_response.text)
        self.session = session_response.json()
        self.project = self.session['projectId']
        self.headers = {
            'Authorization': 'Bearer ' + self.session['accessToken'],
            'X-RoleAssignment-Id': self.session['actor']['roleAssignmentId'],
        }

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()
        self.temp.cleanup()

    @staticmethod
    def ref(record):
        return {'objectType': 'WorkItem', 'objectId': record['id'], 'version': record['version']}

    def get(self, path, *, headers=None):
        return self.client.get(f'/projects/{self.project}/parallel/{path}', headers=self.headers if headers is None else headers)

    def test_parallel_projections_require_session_and_project_role(self):
        for path in ('drawings', 'locations', 'work-inbox', 'notifications'):
            with self.subTest(path=path):
                self.assertEqual(self.get(path, headers={}).status_code, 401)
        wrong_project = self.get('locations', headers={**self.headers})
        self.assertEqual(wrong_project.status_code, 200)
        other_project = self.client.get(f'/projects/{uid()}/parallel/locations', headers=self.headers)
        self.assertEqual(other_project.status_code, 404)
        other_role = self.app.state.store.meta['actors']['CON']['roleAssignmentId']
        denied = self.get('locations', headers={**self.headers, 'X-RoleAssignment-Id': other_role})
        self.assertEqual(denied.status_code, 403)

    def test_drawing_and_location_responses_are_authorized_existing_records(self):
        drawings = self.get('drawings')
        self.assertEqual(drawings.status_code, 200, drawings.text)
        body = drawings.json()
        self.assertEqual(body['projectId'], self.project)
        self.assertTrue(body['items'])
        self.assertTrue(all(row['domainRef']['objectType'] == 'InformationItem' for row in body['items']))
        # The demo fixture's drawing is returned as an exact source version, with
        # no guessed "current" revision indicator.
        first = body['items'][0]
        detail = self.get(f"drawings?object_id={first['domainRef']['objectId']}&version={first['domainRef']['version']}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['drawing']['domainRef'], first['domainRef'])
        self.assertEqual(detail.json()['releaseReadinessDiagnostic']['result'], 'unknown')
        locations = self.get('locations')
        self.assertEqual(locations.status_code, 200, locations.text)
        self.assertEqual(locations.json()['projectRef']['objectId'], self.project)
        self.assertEqual(locations.json()['items'][0]['depth'], 0)

    def test_work_inbox_and_notifications_preserve_canonical_projection_shapes(self):
        work = self.get('work-inbox')
        self.assertEqual(work.status_code, 200, work.text)
        self.assertEqual(work.json()['projectId'], self.project)
        self.assertIn('roleAssignmentId', work.json())
        self.assertIn('records', work.json())
        invalid_page = self.get('work-inbox?limit=101')
        self.assertEqual(invalid_page.status_code, 422)
        notifications = self.get('notifications')
        self.assertEqual(notifications.status_code, 200, notifications.text)
        body = notifications.json()
        self.assertEqual(body['total'], len(body['items']))
        self.assertEqual(body['unreadCount'], sum(not row['isRead'] for row in body['items']))
        self.assertTrue(body['items'])
        for row in body['items']:
            self.assertEqual(row['notification']['recipientPartyId'], self.session['actor']['partyId'])
            self.assertEqual(row['notification']['projectId'], self.project)
            self.assertEqual(row['notification']['channel'], 'in_app')
            self.assertEqual(row['notification']['status'], 'queued')
            self.assertIn('sourceRef', row['notification'])
        self.assertNotIn('intents', notifications.json())

    def test_safety_traceability_requires_exact_reference_and_keeps_read_only_shape(self):
        missing = self.get('safety-traceability')
        self.assertEqual(missing.status_code, 422)
        invalid_id = self.get(f'safety-traceability?object_id={uid()}&version=1')
        self.assertEqual(invalid_id.status_code, 404)

    def test_location_tree_includes_authorized_descendants_and_hides_other_projects(self):
        store = self.app.state.store
        root_id = store.meta['scope']['locationId']
        child_id = uid()
        with store.transaction(True):
            store.engine.bootstrap('Location', {
                'id': child_id,
                'projectId': self.project,
                'name': 'Accessible child area',
                'semanticAnchor': 'demo/child-area',
                'parentId': root_id,
            })
            other_project_location = uid()
            store.engine.bootstrap('Location', {
                'id': other_project_location,
                'projectId': uid(),
                'name': 'Foreign project area',
                'semanticAnchor': 'foreign/area',
            })

        response = self.get('locations')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        by_id = {item['reference']['objectId']: item for item in body['items']}
        self.assertIn(root_id, by_id)
        self.assertIn(child_id, by_id)
        self.assertNotIn(other_project_location, by_id)
        self.assertEqual(by_id[child_id]['depth'], 1)
        self.assertEqual(by_id[child_id]['treeParentRef']['objectId'], root_id)
        foreign_project = self.client.get(
            f"/projects/{uid()}/parallel/locations", headers=self.headers
        )
        self.assertEqual(foreign_project.status_code, 404)

    def test_location_read_requires_render_document_authority(self):
        store = self.app.state.store
        role_id = self.headers['X-RoleAssignment-Id']
        with store.transaction(True):
            role = store.engine.get('RoleAssignment', role_id)
            role['authorityCodes'].remove('render_document')
            store.engine._save('RoleAssignment', role)

        denied = self.get('locations')
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(denied.json()['code'], 'NOT_AUTHORIZED')

    def test_safety_traceability_returns_exact_read_only_stop_order_projection(self):
        store = self.app.state.store
        project = self.project
        scope = store.meta['scope']
        evidence_id = store.meta['evidenceId']
        contractor_response = self.client.post('/dev/sessions', json={'actorGroup': 'CON'})
        self.assertEqual(contractor_response.status_code, 200, contractor_response.text)
        contractor = contractor_response.json()
        contractor_headers = {
            'Authorization': 'Bearer ' + contractor['accessToken'],
            'X-RoleAssignment-Id': contractor['actor']['roleAssignmentId'],
        }
        permit_id = uid()
        created_permit = self.client.post(
            f'/projects/{project}/safety-permits',
            headers={**contractor_headers, 'Idempotency-Key': uid()},
            json={
                'roleAssignmentId': contractor['actor']['roleAssignmentId'],
                'clientObjectId': permit_id,
                'payload': {**scope, 'title': 'API traceability fixture', 'data': {}},
            },
        )
        self.assertEqual(created_permit.status_code, 201, created_permit.text)
        permit = created_permit.json()['record']
        with store.transaction(True):
            current = store.engine.get('WorkItem', permit_id)
            current['status'] = 'active'
            current['data']['workAuthorized'] = True
            store.engine._save('WorkItem', current)
            permit = store.engine.get('WorkItem', permit_id)

        supervisor_response = self.client.post('/dev/sessions', json={'actorGroup': 'SUP'})
        self.assertEqual(supervisor_response.status_code, 200, supervisor_response.text)
        supervisor = supervisor_response.json()
        supervisor_headers = {
            'Authorization': 'Bearer ' + supervisor['accessToken'],
            'X-RoleAssignment-Id': supervisor['actor']['roleAssignmentId'],
        }
        stop_id = uid()
        stop_response = self.client.post(
            f'/projects/{project}/safety-stop-orders',
            headers={**supervisor_headers, 'Idempotency-Key': uid()},
            json={
                'roleAssignmentId': supervisor['actor']['roleAssignmentId'],
                'clientObjectId': stop_id,
                'payload': {
                    **scope,
                    'title': 'API traceability fixture stop',
                    'evidenceIds': [evidence_id],
                    'data': {
                        'stopOrderNo': 'API-TRACE-001',
                        'stopScopeType': 'permit',
                        'stopReason': 'synthetic API integration fixture',
                        'observedAt': '2026-10-07T09:00:00Z',
                        'effectiveAt': '2026-10-07T09:00:00Z',
                        'affectedPermitRefs': [self.ref(permit)],
                    },
                },
            },
        )
        self.assertEqual(stop_response.status_code, 201, stop_response.text)
        stop = stop_response.json()['record']
        before_version = store.engine.get('WorkItem', stop_id)['version']
        trace = self.client.get(
            f"/projects/{project}/parallel/safety-traceability?object_id={stop_id}&version={stop['version']}",
            headers=supervisor_headers,
        )
        self.assertEqual(trace.status_code, 200, trace.text)
        body = trace.json()
        self.assertTrue(body['readOnly'])
        self.assertFalse(body['officialStateChanged'])
        self.assertEqual(body['rootReference'], self.ref(stop))
        permit_links = [link for link in body['links'] if link['relation'] == 'affectedPermitRefs']
        self.assertTrue(permit_links)
        self.assertEqual(permit_links[0]['reference'], self.ref(permit))
        self.assertEqual(permit_links[0]['versionResolution'], 'exact_historical_version')
        self.assertEqual(store.engine.get('WorkItem', stop_id)['version'], before_version)


if __name__ == '__main__':
    unittest.main()
