"""Real workspace reads must not expose foreign or unauthorized draft references."""
from copy import deepcopy
import unittest

from fastapi.testclient import TestClient
from app.reference.engine import uid
from services.api.main import create_app


class ReferenceCatalogHTTPTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(demo=True, queue_enabled=False)
        self.client = TestClient(self.app)
        self.addCleanup(self.app.state.store.close)
        self.addCleanup(self.client.close)
        self.session = self.client.post('/dev/sessions', json={'actorGroup': 'SUP'}).json()
        self.project = self.session['projectId']
        self.headers = {'Authorization': 'Bearer ' + self.session['accessToken'],
                        'X-RoleAssignment-Id': self.session['actor']['roleAssignmentId']}

    def catalog(self):
        response = self.client.get('/projects/' + self.project + '/workspace', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['context']['referenceCatalog']

    def test_foreign_scope_and_foreign_project_evidence_are_not_offered(self):
        store = self.app.state.store
        with store.transaction(True):
            evidence = store.engine.get('Evidence', store.meta['evidenceId'])
            foreign = deepcopy(evidence)
            foreign.update(id=uid(), projectId=uid())
            outside_scope = deepcopy(evidence)
            outside_scope.update(id=uid(), locationId=uid())
            store.engine._save('Evidence', foreign)
            store.engine._save('Evidence', outside_scope)
        values = self.catalog()['evidence']
        self.assertIn(evidence['id'], [value['ref']['objectId'] for value in values])
        self.assertNotIn(foreign['id'], [value['ref']['objectId'] for value in values])
        self.assertNotIn(outside_scope['id'], [value['ref']['objectId'] for value in values])
        for value in values:
            self.assertEqual(value['record']['projectId'], self.project)
            self.assertEqual(value['ref']['version'], value['record']['version'])

    def test_information_items_are_exact_current_and_read_authorized(self):
        store = self.app.state.store
        with store.transaction(True):
            source = next(record for (kind, _), record in store.engine._records.items()
                          if kind == 'InformationItem' and record.get('subtype') == 'Drawing')
            foreign = deepcopy(source)
            foreign.update(id=uid(), projectId=uid())
            outside = deepcopy(source)
            outside.update(id=uid(), locationId=uid())
            store.engine._save('InformationItem', foreign)
            store.engine._save('InformationItem', outside)
        values = self.catalog()['informationItems']
        ids = [value['ref']['objectId'] for value in values]
        self.assertIn(source['id'], ids)
        self.assertNotIn(foreign['id'], ids)
        self.assertNotIn(outside['id'], ids)
        for value in values:
            self.assertEqual(value['ref']['objectType'], 'InformationItem')
            self.assertEqual(value['ref']['version'], value['record']['version'])
        with store.transaction(True):
            role = store.engine.get('RoleAssignment', self.session['actor']['roleAssignmentId'])
            role.update(locationIds=[uid()], version=role['version'] + 1)
            store.engine._save('RoleAssignment', role)
        self.assertEqual(self.catalog()['informationItems'], [])

    def test_expired_requirements_are_excluded_and_assignment_changes_take_effect(self):
        store = self.app.state.store
        before = self.catalog()
        self.assertTrue(before['requirements'])
        with store.transaction(True):
            requirement = store.engine.get('Requirement', before['requirements'][0]['ref']['objectId'])
            requirement.update(effectiveTo='2000-01-01T00:00:00Z', version=requirement['version'] + 1)
            store.engine._save('Requirement', requirement)
        self.assertNotIn(requirement['id'], [value['ref']['objectId'] for value in self.catalog()['requirements']])
        with store.transaction(True):
            role = store.engine.get('RoleAssignment', self.session['actor']['roleAssignmentId'])
            role.update(locationIds=[uid()], version=role['version'] + 1)
            store.engine._save('RoleAssignment', role)
        after = self.catalog()
        self.assertEqual(after['evidence'], [])
        self.assertEqual(after['requirements'], [])


if __name__ == '__main__':
    unittest.main()
