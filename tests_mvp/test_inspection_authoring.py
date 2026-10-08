from copy import deepcopy
from uuid import uuid4
import unittest
from services.api.modules.inspection_authoring import install_inspection_authoring_routes
from tests_mvp import test_wave3_drawing_markups as fixtures

class InspectionAuthoringTests(unittest.TestCase):
    ref = staticmethod(fixtures.DrawingMarkupTests.ref)
    add_pdf = fixtures.DrawingMarkupTests.add_pdf
    _build_app = fixtures.DrawingMarkupTests._build_app
    def setUp(self):
        fixtures.DrawingMarkupTests.setUp(self)
        self.actor = deepcopy(self.store.meta['actors']['CON'])
        install_inspection_authoring_routes(self.app, self.store, identity=lambda _: self.actor,
            role_for=lambda actor, project, rid: self.store.engine.get('RoleAssignment', rid or actor['roleAssignmentId']),
            key_for=lambda request: request.headers.get('Idempotency-Key', ''))
        self.path = f'/projects/{self.project}/inspection-authoring'
        self.options = self.client.get(self.path + '/options').json()
        self.chosen = self.options['drawings'][0]
        self.location = self.chosen['locations'][0]['id']
        self.context = self.client.get(self.path + '/options', params=dict(drawing_id=self.chosen['domainRef']['objectId'], drawing_version=self.chosen['domainRef']['version'], location_id=self.location)).json()
        self.body = dict(objectId=str(uuid4()), drawingRef=self.chosen['domainRef'], locationId=self.location,
            requirementRefs=[self.context['requirements'][0]['domainRef']], evidenceRefs=[self.context['evidence'][0]['domainRef']],
            workName='Selected field inspection', selfInspectionComplete=False,
            precheck=dict(drawing=False, material=False, test=False, previous=False, change=False), holdPoint=True)
    def post(self, body=None, key='authoring-one'):
        return self.client.post(self.path + '/drafts', json=self.body if body is None else body, headers={'Idempotency-Key': key})
    def test_exact_sources_draft_and_idempotency(self):
        response = self.post(); self.assertEqual(response.status_code, 201, response.text)
        record = response.json()['record']
        self.assertEqual(record['status'], 'draft'); self.assertFalse(record['nextWorkAllowed'])
        self.assertFalse(record['selfInspectionComplete']); self.assertFalse(any(record['precheck'].values()))
        self.assertEqual(record['drawingRef'], self.body['drawingRef']); self.assertEqual(record['locationId'], self.location)
        self.assertEqual(record['evidenceIds'], [self.body['evidenceRefs'][0]['objectId']])
        self.assertEqual(self.post().json()['record'], record)
        self.assertEqual(self.post(dict(self.body, workName='Changed')).status_code, 409)
    def test_stale_drawing_and_evidence_rejected_without_record(self):
        bad = deepcopy(self.body); bad['evidenceRefs'][0]['version'] += 1
        self.assertEqual(self.post(bad).status_code, 422)
        with self.store.transaction(True):
            self.store.meta.setdefault('drawingFieldRevisions', []).append(dict(projectId=self.project, drawingRef=self.body['drawingRef'], status='withdrawn'))
        self.assertEqual(self.post().status_code, 409)
        self.assertNotIn(('Inspection', self.body['objectId']), self.store.engine._records)
        self.assertFalse(self.client.get(self.path + '/options').json()['drawings'])
    def test_location_and_requirement_scope_rejected(self):
        location = deepcopy(self.store.engine.get('Location', self.location)); location['id'] = str(uuid4()); location.pop('parentId', None)
        with self.store.transaction(True): self.store.engine._records[('Location', location['id'])] = location
        self.assertEqual(self.post(dict(self.body, locationId=location['id'])).status_code, 403)
        with self.store.transaction(True):
            r = self.store.engine._records[('Requirement', self.body['requirementRefs'][0]['objectId'])]; r['packageId'] = str(uuid4())
        self.assertEqual(self.post().status_code, 422)
    def test_non_contractor_cannot_author_draft(self):
        self.actor = deepcopy(self.store.meta['actors']['SUP'])
        self.assertEqual(self.post().status_code, 403)

    def test_new_field_drawing_is_selectable_without_workspace_information_items(self):
        from services.api.modules.drawing_source_registration import install_drawing_source_routes
        install_drawing_source_routes(self.app, self.store, identity=lambda _: self.actor,
            role_for=lambda actor, project, rid: self.store.engine.get('RoleAssignment', rid or actor['roleAssignmentId']),
            key_for=lambda request: request.headers.get('Idempotency-Key', ''), demo_enabled=True)
        self.actor = deepcopy(self.store.meta['actors']['DES'])
        result = self.client.post(f'/projects/{self.project}/parallel/drawing-sources', json=dict(objectId=str(uuid4()),
            title='New field source', revision='99', evidenceRef=self.pdf_ref, predecessorRef=self.drawing_ref,
            requestReview=True), headers={'Idempotency-Key': 'new-field-source'}).json()
        reference = result['binding']['drawingRef']
        self.actor = deepcopy(self.store.meta['actors']['CON'])
        with self.store.transaction(True):
            engine = self.store.engine
            sup = self.store.meta['actors']['SUP']
            approval = result['approval']
            reviewed = engine.execute('approval', approval['id'], 'review', approval['version'], {}, [],
                sup['partyId'], sup['roleAssignmentId'], 'review-new-source')['record']
            approved = engine.execute('approval', reviewed['id'], 'approve', reviewed['version'], {}, [],
                sup['partyId'], sup['roleAssignmentId'], 'approve-new-source')['record']
            store_revision = dict(id=str(uuid4()), projectId=self.project, drawingNo='NEW-SOURCE-99', drawingRef=reference,
                evidenceRef=self.pdf_ref, approvalRef=self.ref('Approval', approved), status='released', issuedFor='construction',
                changeRefs=[], requiredRecipientPartyIds=[self.actor['partyId']], receipts=[dict(recipientPartyId=self.actor['partyId'], deliveredAt=engine.at(), receivedAt=engine.at())])
            self.store.meta.setdefault('drawingFieldRevisions', []).append(store_revision)
        response = self.client.get(self.path + '/options')
        self.assertTrue(any(d['domainRef'] == reference for d in response.json()['drawings']))
        self.assertEqual(self.post(dict(self.body, drawingRef=reference)).status_code, 201)
        with self.store.transaction(True): self.store.meta['drawingFieldRevisions'][0]['status'] = 'superseded'
        second = dict(self.body, objectId=str(uuid4()), drawingRef=reference)
        self.assertEqual(self.post(second, key='after-superseded').status_code, 409)
