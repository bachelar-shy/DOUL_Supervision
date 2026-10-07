import unittest
from copy import deepcopy
from uuid import uuid4
from app.reference.validation import ContractError
from services.api.modules.drawing_source_registration import install_drawing_source_routes
from tests_mvp import test_wave3_drawing_markups as fixtures


class DrawingSourceTests(unittest.TestCase):
    ref = staticmethod(fixtures.DrawingMarkupTests.ref)
    add_pdf = fixtures.DrawingMarkupTests.add_pdf
    _build_app = fixtures.DrawingMarkupTests._build_app
    def setUp(self):
        fixtures.DrawingMarkupTests.setUp(self)
        install_drawing_source_routes(self.app, self.store, identity=lambda _: self.actor,
            role_for=lambda actor, project_id, role_id: self.store.engine.get('RoleAssignment', role_id or actor['roleAssignmentId']),
            key_for=lambda request: request.headers.get('Idempotency-Key', ''), demo_enabled=True)
        self.actor = deepcopy(self.store.meta['actors']['DES'])
        self.role = self.store.engine.get('RoleAssignment', self.actor['roleAssignmentId'])
        self.body = dict(objectId=str(uuid4()), title='Synthetic successor', revision='04', evidenceRef=self.pdf_ref,
            predecessorRef=self.drawing_ref, requestReview=True)

    def post_source(self, key='source-one', body=None):
        return self.client.post(f'/projects/{self.project}/parallel/drawing-sources', json=body or self.body,
            headers={'Idempotency-Key': key})

    def test_designer_source_is_immutable_pending_review_and_replay_stable_after_approval(self):
        response = self.post_source(); self.assertEqual(response.status_code, 201, response.text)
        result = response.json(); self.assertEqual(result['drawing']['status'], 'draft')
        self.assertEqual(result['approval']['status'], 'pending')
        self.assertEqual(result['approval']['targetRef'], result['binding']['drawingRef'])
        self.assertEqual(self.store.engine.get('InformationItem', self.drawing['id']), self.drawing)
        self.assertFalse(self.store.engine._drawing_has_approval(result['drawing']))
        self.assertEqual(self.post_source().json(), result)
        changed = dict(self.body, title='Changed'); self.assertEqual(self.post_source(body=changed).status_code, 409)
        self.assertEqual(len([a for a in self.store.engine._audit if a['command'] == 'register_drawing_source']), 1)
        approval = result['approval']; sup = self.store.meta['actors']['SUP']
        with self.store.transaction(True):
            reviewed = self.store.engine.execute('approval', approval['id'], 'review', approval['version'], {}, [], sup['partyId'], sup['roleAssignmentId'], 'review-source')['record']
            approved = self.store.engine.execute('approval', reviewed['id'], 'approve', reviewed['version'], {}, [], sup['partyId'], sup['roleAssignmentId'], 'approve-source')['record']
        self.assertTrue(self.store.engine._drawing_has_approval(result['drawing']))
        self.assertEqual(self.post_source().json(), result)
        with self.store.transaction(True):
            self.store.engine.execute('approval', approved['id'], 'revoke', approved['version'], {'reason': 'Synthetic revocation'}, [], sup['partyId'], sup['roleAssignmentId'], 'revoke-source')
        self.assertFalse(self.store.engine._drawing_has_approval(result['drawing']))

    def test_source_authority_stale_identity_and_atomic_rollback(self):
        self.actor = deepcopy(self.store.meta['actors']['CON'])
        self.assertEqual(self.post_source().status_code, 403)
        self.actor = deepcopy(self.store.meta['actors']['DES'])
        bad = dict(self.body, evidenceRef=dict(self.pdf_ref, version=999))
        self.assertEqual(self.post_source(body=bad).status_code, 404)
        bad = dict(self.body, revision=self.drawing['revision'])
        self.assertEqual(self.post_source(body=bad).status_code, 409)
        self.assertNotIn(('InformationItem', self.body['objectId']), self.store.engine._records)
        original = self.store.engine.create
        def fail(*args, **kwargs):
            raise ContractError('INVALID_REQUEST', 'Synthetic approval creation failure')
        self.store.engine.create = fail
        try:
            self.assertEqual(self.post_source().status_code, 422)
        finally:
            self.store.engine.create = original
        self.assertNotIn(('InformationItem', self.body['objectId']), self.store.engine._records)
        self.assertFalse(any(b['drawingRef']['objectId'] == self.body['objectId'] for b in self.store.meta['drawingPdfBindings']))

    def test_new_source_needs_received_field_release_and_superseded_copy_is_blocked(self):
        result = self.post_source().json(); drawing = result['drawing']; approval = result['approval']; sup = self.store.meta['actors']['SUP']
        with self.store.transaction(True):
            reviewed = self.store.engine.execute('approval', approval['id'], 'review', approval['version'], {}, [], sup['partyId'], sup['roleAssignmentId'], 'review-for-field')['record']
            approved = self.store.engine.execute('approval', reviewed['id'], 'approve', reviewed['version'], {}, [], sup['partyId'], sup['roleAssignmentId'], 'approve-for-field')['record']
        role = self.store.engine.get('RoleAssignment', sup['roleAssignmentId'])
        payload = dict(projectId=self.project, drawingRef=result['binding']['drawingRef'])
        with self.assertRaises(ContractError):
            self.store.engine._common(payload, role)
        revision = dict(id=str(uuid4()), projectId=self.project, drawingNo='TEST-A1', drawingRef=result['binding']['drawingRef'], evidenceRef=result['binding']['evidenceRef'], approvalRef=self.ref('Approval', approved), status='released', issuedFor='construction', changeRefs=[], requiredRecipientPartyIds=[sup['partyId']], receipts=[])
        with self.store.transaction(True):
            self.store.meta.setdefault('drawingFieldRevisions', []).append(revision)
        with self.store.transaction():
            with self.assertRaises(ContractError): self.store.engine._common(payload, role)
        with self.store.transaction(True):
            self.store.meta['drawingFieldRevisions'][0]['receipts'].append(dict(recipientPartyId=sup['partyId'], deliveredAt=self.store.engine.at(), receivedAt=self.store.engine.at()))
        with self.store.transaction(): self.store.engine._common(payload, role)
        with self.store.transaction(True): self.store.meta['drawingFieldRevisions'][0]['status'] = 'superseded'
        with self.store.transaction():
            with self.assertRaises(ContractError): self.store.engine._common(payload, role)
