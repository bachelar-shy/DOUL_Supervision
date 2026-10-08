"""Drawing impact persistence, exact links, deduplication and read scope."""
from copy import deepcopy
from unittest.mock import patch
import unittest
from uuid import uuid4

from app.reference.validation import ContractError
from services.api.modules.drawing_impacts import (
    affected_records, reconcile_drawing_impacts_in_transaction, install_drawing_impact_routes,
)
from services.api.store import SQLiteSnapshotAdapter
from tests_mvp.test_inspection_authoring import InspectionAuthoringTests


class DrawingImpactTests(unittest.TestCase):
    ref = staticmethod(InspectionAuthoringTests.ref)
    add_pdf = InspectionAuthoringTests.add_pdf
    _build_app = InspectionAuthoringTests._build_app
    post = InspectionAuthoringTests.post

    def setUp(self):
        InspectionAuthoringTests.setUp(self)
        response = self.post()
        self.assertEqual(response.status_code, 201, response.text)
        self.inspection = response.json()['record']
        self.source_ref = self.inspection['drawingRef']
        install_drawing_impact_routes(self.app, self.store, identity=lambda _: self.actor,
            role_for=lambda actor, project, rid: self.store.engine.get('RoleAssignment', rid or actor['roleAssignmentId']))
        self.impact_path = f'/projects/{self.project}/parallel/drawing-impacts'

    def withdraw(self):
        with self.store.transaction(True):
            self.store.meta.setdefault('drawingFieldRevisions', []).append(dict(
                projectId=self.project, drawingRef=self.source_ref, status='withdrawn'))
        # Adapter restore binds field metadata to the engine.
        self.reconcile()

    def reconcile(self):
        with self.store.transaction(True):
            reconcile_drawing_impacts_in_transaction(self.store, self.project)

    def notices(self):
        return deepcopy(self.store.meta.get('drawingImpactNotices', {}))

    def test_usable_source_creates_no_notice(self):
        self.reconcile()
        self.assertFalse(self.notices())
        self.assertEqual(self.client.get(self.impact_path).json()['total'], 0)

    def test_withdrawal_exact_source_and_deduplication_survive_restart(self):
        before = deepcopy(self.inspection)
        self.withdraw()
        notices = self.notices()
        self.assertTrue(notices)
        self.reconcile()
        self.assertEqual(self.notices(), notices)
        self.assertEqual(self.store.engine.get('Inspection', before['id']), before)
        matching = [self.store.engine.get('Notification', identifier) for identifier in notices
                    if self.store.engine.get('Notification', identifier)['sourceRef'] == self.ref('Inspection', before)]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]['recipientPartyId'], before['createdBy'])
        reopened = SQLiteSnapshotAdapter(self.db_path)
        try:
            with reopened.transaction(True):
                reconcile_drawing_impacts_in_transaction(reopened, self.project)
            self.assertEqual(reopened.meta['drawingImpactNotices'], notices)
        finally:
            reopened.close()

    def test_restored_source_clears_incident_and_recurrence_is_distinct(self):
        self.withdraw()
        first = self.notices()
        with self.store.transaction(True):
            self.store.meta['drawingFieldRevisions'] = []
        self.reconcile()
        self.assertEqual(self.client.get(self.impact_path).json()['total'], 0)
        self.withdraw()
        self.assertGreater(len(self.notices()), len(first))

    def test_terminal_work_excluded_and_missing_optional_links_tolerated(self):
        with self.store.transaction(True):
            self.store.engine._records[('Inspection', self.inspection['id'])]['status'] = 'completed'
            self.store.meta['drawingMarkups'] = [dict(id='pin', projectId=self.project, drawingRef=self.source_ref)]
            self.store.meta['drawingMarkupIssueLinks'] = [dict(markupId='pin')]
        self.withdraw()
        selected = affected_records(self.store, self.source_ref)
        self.assertNotIn(self.inspection['id'], [record['id'] for _, record in selected])

    def test_denied_sources_are_not_projected_or_notified(self):
        with patch.object(self.store.engine, 'authorize_read', side_effect=ContractError('FORBIDDEN', 'denied')):
            self.withdraw()
            self.assertFalse(self.notices())
            self.assertEqual(self.client.get(self.impact_path).json()['items'], [])

    def test_failure_rolls_back_notices_and_incidents(self):
        before = self.notices()
        with self.assertRaises(RuntimeError):
            with self.store.transaction(True):
                self.store.meta.setdefault('drawingFieldRevisions', []).append(dict(
                    projectId=self.project, drawingRef=self.source_ref, status='withdrawn'))
                self.store.engine.drawing_field_revisions = self.store.meta['drawingFieldRevisions']
                reconcile_drawing_impacts_in_transaction(self.store, self.project)
                raise RuntimeError('transaction failed')
        self.assertEqual(self.notices(), before)
        self.assertFalse(self.store.meta.get('drawingImpactIncidents'))

    def test_closed_actions_and_foreign_drawing_versions_are_excluded(self):
        with self.store.transaction(True):
            for (kind, _), row in self.store.engine._records.items():
                if kind == 'Action': row['status'] = 'closed'
            self.store.engine._records[('Inspection', self.inspection['id'])]['drawingRef'] = dict(self.source_ref, version=999)
        with self.store.transaction():
            selected = affected_records(self.store, self.source_ref)
        self.assertFalse(any(kind == 'Action' for kind, _ in selected))
        self.assertNotIn(self.inspection['id'], [record['id'] for _, record in selected])
