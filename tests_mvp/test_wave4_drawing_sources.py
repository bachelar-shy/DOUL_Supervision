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

    def _install_usable_field_revision(self, drawing, evidence, approval, change):
        sup = self.store.meta['actors']['SUP']
        revision = dict(
            id=str(uuid4()), projectId=self.project, drawingNo='FIELD-CHANGE-TEST',
            drawingRef=self.ref('InformationItem', drawing),
            evidenceRef=self.ref('Evidence', evidence), data={'approvalRef': self.ref('Approval', approval)},
            status='released', issuedFor='construction',
            changeRefs=[self.ref('WorkItem', change)],
            requiredRecipientPartyIds=[sup['partyId']],
            receipts=[dict(recipientPartyId=sup['partyId'], deliveredAt=self.store.engine.at(),
                           receivedAt=self.store.engine.at(), returnedAt=None)],
        )
        with self.store.transaction(True):
            self.store.meta.setdefault('drawingFieldRevisions', []).append(revision)
        return revision

    def _change_request(self, drawing_ref):
        key, original = next((key, record) for key, record in self.store.engine._records.items()
                             if key[0] == 'WorkItem')
        change = deepcopy(original)
        change.update(subtype='ChangeRequest', status='approved', drawingRef=deepcopy(drawing_ref),
                      relatedRefs=[], data={})
        with self.store.transaction(True):
            self.store.engine._records[key] = deepcopy(change)
            self.store.engine._history[(key[0], key[1], change['version'])] = deepcopy(change)
        return change

    def _change_approval(self, source_approval, change, *, status='approved', expires_at=None, target=None):
        approval = deepcopy(source_approval)
        approval.update(id=str(uuid4()), version=1, status=status,
                        targetRef=deepcopy(target or self.ref('WorkItem', change)))
        for field in ('validTo', 'expiresAt', 'validUntil'):
            approval.pop(field, None)
        if expires_at is not None:
            approval['expiresAt'] = expires_at
        with self.store.transaction(True):
            self.store.engine._records[('Approval', approval['id'])] = deepcopy(approval)
            self.store.engine._history[('Approval', approval['id'], approval['version'])] = deepcopy(approval)
        return approval

    def test_drawing_usability_rejects_mismatched_change_target(self):
        result = self.post_source().json()
        drawing = result['drawing']
        approval_record = self.store.engine.get('Approval', result['approval']['id'])
        sup = self.store.meta['actors']['SUP']
        with self.store.transaction(True):
            reviewed = self.store.engine.execute('approval', approval_record['id'], 'review', approval_record['version'], {}, [],
                sup['partyId'], sup['roleAssignmentId'], 'review-mismatched-change-source')['record']
            approved = self.store.engine.execute('approval', reviewed['id'], 'approve', reviewed['version'], {}, [],
                sup['partyId'], sup['roleAssignmentId'], 'approve-mismatched-change-source')['record']
        wrong_target = dict(objectType='InformationItem', objectId=str(uuid4()), version=1)
        change = self._change_request(wrong_target)
        source_evidence = self.store.engine.get('Evidence', result['binding']['evidenceRef']['objectId'])
        self._install_usable_field_revision(drawing, source_evidence, approved, change)
        self.assertFalse(self.store.engine._drawing_field_usable(drawing))

    def test_drawing_usability_rechecks_change_approval_target_state_and_expiry(self):
        result = self.post_source().json()
        drawing = result['drawing']
        approval_record = self.store.engine.get('Approval', result['approval']['id'])
        sup = self.store.meta['actors']['SUP']
        with self.store.transaction(True):
            reviewed = self.store.engine.execute('approval', approval_record['id'], 'review', approval_record['version'], {}, [],
                sup['partyId'], sup['roleAssignmentId'], 'review-change-approval-source')['record']
            approved = self.store.engine.execute('approval', reviewed['id'], 'approve', reviewed['version'], {}, [],
                sup['partyId'], sup['roleAssignmentId'], 'approve-change-approval-source')['record']
        drawing_ref = self.ref('InformationItem', drawing)
        change = self._change_request(drawing_ref)
        source_evidence = self.store.engine.get('Evidence', result['binding']['evidenceRef']['objectId'])
        self._install_usable_field_revision(drawing, source_evidence, approved, change)

        expired = self._change_approval(approved, change, expires_at='2000-01-01T00:00:00Z')
        changed = deepcopy(change)
        changed['data'] = {'references': [drawing_ref], 'approvalRef': self.ref('Approval', expired)}
        with self.store.transaction(True):
            self.store.engine._records[('WorkItem', change['id'])] = deepcopy(changed)
            self.store.engine._history[('WorkItem', change['id'], changed['version'])] = deepcopy(changed)
        self.assertFalse(self.store.engine._drawing_field_usable(drawing))

        revoked = self._change_approval(approved, changed, status='revoked')
        changed['data']['approvalRef'] = self.ref('Approval', revoked)
        with self.store.transaction(True):
            self.store.engine._records[('WorkItem', change['id'])] = deepcopy(changed)
            self.store.engine._history[('WorkItem', change['id'], changed['version'])] = deepcopy(changed)
        self.assertFalse(self.store.engine._drawing_field_usable(drawing))

        valid = self._change_approval(approved, changed)
        changed['data']['approvalRef'] = self.ref('Approval', valid)
        with self.store.transaction(True):
            self.store.engine._records[('WorkItem', change['id'])] = deepcopy(changed)
            self.store.engine._history[('WorkItem', change['id'], changed['version'])] = deepcopy(changed)
        self.assertTrue(self.store.engine._drawing_field_usable(drawing))
