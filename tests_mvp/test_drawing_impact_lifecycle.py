"""Observed drawing restoration/history, retention and access regression."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch
from uuid import uuid4

from app.reference.validation import ContractError
from services.api.modules.drawing_impacts import reconcile_drawing_impacts_in_transaction
from services.api.store import SQLiteSnapshotAdapter
from tests_mvp import test_drawing_impacts as impact_fixtures


class DrawingImpactLifecycleTests(unittest.TestCase):
    setUp = impact_fixtures.DrawingImpactTests.setUp
    ref = staticmethod(impact_fixtures.DrawingImpactTests.ref)
    add_pdf = impact_fixtures.DrawingImpactTests.add_pdf
    _build_app = impact_fixtures.DrawingImpactTests._build_app
    post = impact_fixtures.DrawingImpactTests.post
    withdraw = impact_fixtures.DrawingImpactTests.withdraw
    reconcile = impact_fixtures.DrawingImpactTests.reconcile
    notices = impact_fixtures.DrawingImpactTests.notices
    headers = impact_fixtures.DrawingImpactTests.headers
    markup_body = impact_fixtures.DrawingImpactTests.markup_body

    def history(self):
        response = self.client.get(self.impact_path + '/history')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def restore(self):
        with self.store.transaction(True):
            self.store.meta['drawingFieldRevisions'] = []
        self.reconcile()

    def test_occurrence_restoration_recurrence_retains_exact_sources_and_times(self):
        clock = [datetime.now(timezone.utc)]
        self.store.engine.now = lambda: clock[0]
        canonical = deepcopy(self.store.engine._records)
        self.withdraw()
        first = self.history()['items'][0]
        self.assertEqual(first['state'], 'active')
        self.assertIsNone(first['resolvedAt'])
        self.assertEqual(first['drawingRef'], self.source_ref)
        self.assertIn(self.ref('Inspection', self.inspection), [r['sourceRef'] for r in first['items']])
        notices = self.notices()
        clock[0] += timedelta(minutes=1)
        self.restore()
        restored = self.history()['items'][0]
        self.assertEqual(restored['state'], 'restored')
        self.assertEqual(restored['resolvedAt'], self.store.engine.at())
        clock[0] += timedelta(minutes=1)
        self.assertEqual(self.history()['items'][0], restored)
        self.assertEqual(self.notices(), notices)
        self.withdraw()
        history = self.history()
        self.assertEqual(history['total'], 2)
        self.assertEqual({r['state'] for r in history['items']}, {'active', 'restored'})
        self.assertEqual(len({r['incidentId'] for r in history['items']}), 2)
        self.assertEqual(next(r for r in history['items'] if r['incidentId'] == first['incidentId']), restored)
        for key, original in canonical.items():
            self.assertEqual(self.store.engine._records[key], original)
        repeated = self.notices()
        self.history()
        self.assertEqual(self.notices(), repeated)

    def test_completed_work_remains_historical_without_automatic_restoration(self):
        self.withdraw()
        first = self.history()['items'][0]
        with self.store.transaction(True):
            current = self.store.engine.get('Inspection', self.inspection['id'])
            current['status'] = 'completed'
            current['version'] += 1
            current['drawingRef'] = dict(self.source_ref, version=999)
            self.store.engine._save('Inspection', current)
        body = self.history()
        incident = next(row for row in body['items'] if row['incidentId'] == first['incidentId'])
        self.assertEqual(incident, first)
        active = self.client.get(self.impact_path).json()['items']
        self.assertNotIn(self.inspection['id'], [row['sourceRef']['objectId'] for event in active for row in event['items']])

    def test_reason_changes_do_not_replace_occurrence_or_duplicate_notifications(self):
        self.withdraw()
        first = self.history()['items'][0]
        notices = self.notices()
        with patch('services.api.modules.drawing_impacts.unavailable_reason', return_value='APPROVAL_UNAVAILABLE'):
            self.reconcile()
            active = self.client.get(self.impact_path).json()['items'][0]
            history = self.history()
        self.assertEqual(active['reason'], 'APPROVAL_UNAVAILABLE')
        self.assertEqual(history['total'], 1)
        self.assertEqual(history['items'][0], first)
        self.assertEqual(self.notices(), notices)

    def test_archive_survives_restart_and_transaction_rollback(self):
        self.withdraw()
        self.restore()
        before = deepcopy(self.store.meta['drawingImpactArchive'])
        notices = self.notices()
        reopened = SQLiteSnapshotAdapter(self.db_path)
        try:
            with reopened.transaction(True):
                reconcile_drawing_impacts_in_transaction(reopened, self.project)
            self.assertEqual(reopened.meta['drawingImpactArchive'], before)
            self.assertEqual(reopened.meta['drawingImpactNotices'], notices)
        finally:
            reopened.close()
        with self.assertRaises(RuntimeError):
            with self.store.transaction(True):
                self.store.engine.drawing_field_revisions = [dict(projectId=self.project,
                    drawingRef=self.source_ref, status='withdrawn')]
                reconcile_drawing_impacts_in_transaction(self.store, self.project)
                raise RuntimeError('rollback archive')
        self.assertEqual(self.store.meta['drawingImpactArchive'], before)
        self.assertEqual(self.notices(), notices)

    def test_migration_recovers_proven_notice_generations_without_invented_times(self):
        self.withdraw()
        first = self.history()['items'][0]
        self.restore()
        self.withdraw()
        current = next(r for r in self.history()['items'] if r['state'] == 'active')
        with self.store.transaction(True):
            self.store.meta.pop('drawingImpactArchive')
            unknown = deepcopy(next(iter(self.store.meta['drawingImpactNotices'].values())))
            unknown['incidentId'] = str(uuid4())
            self.store.meta['drawingImpactNotices']['unsupported-missing-notification'] = unknown
        rows = self.history()['items']
        self.assertEqual(len(rows), 2)
        migrated = next(r for r in rows if r['incidentId'] == first['incidentId'])
        self.assertEqual(migrated['state'], 'restored')
        self.assertIsNone(migrated['resolvedAt'])
        self.assertEqual(migrated['occurredAt'], first['occurredAt'])
        self.assertEqual(migrated['items'], first['items'])
        self.assertEqual(next(r for r in rows if r['incidentId'] == current['incidentId'])['state'], 'active')

    def test_migration_prefers_original_notice_reason_over_changed_snapshot(self):
        self.withdraw()
        first = self.history()['items'][0]
        with patch('services.api.modules.drawing_impacts.unavailable_reason', return_value='APPROVAL_UNAVAILABLE'):
            self.reconcile()
            with self.store.transaction(True):
                self.store.meta.pop('drawingImpactArchive')
            migrated = self.history()['items'][0]
        self.assertEqual(migrated['reason'], first['reason'])
        self.assertEqual(migrated['occurredAt'], first['occurredAt'])
        self.assertEqual(migrated['incidentId'], first['incidentId'])

    def test_inactive_legacy_snapshot_retains_unknown_restoration_time(self):
        self.withdraw()
        self.restore()
        with self.store.transaction(True):
            self.store.meta.pop('drawingImpactArchive')
            for value in self.store.meta['drawingImpactIncidents'].values():
                value.pop('resolvedAt', None)
        incident = self.history()['items'][0]
        self.assertEqual(incident['state'], 'restored')
        self.assertIsNone(incident['resolvedAt'])

    def test_history_rechecks_current_and_historical_work_access(self):
        self.withdraw()
        old = self.history()['items'][0]
        with self.store.transaction(True):
            work = self.store.engine.get('Inspection', self.inspection['id'])
            work['version'] += 1
            self.store.engine._save('Inspection', work)
        authorize = self.store.engine.authorize_read
        for denied_version in (self.inspection['version'], work['version']):
            def restricted(record, party, role):
                if record['id'] == self.inspection['id'] and record['version'] == denied_version:
                    raise ContractError('NOT_AUTHORIZED', 'history work denied')
                return authorize(record, party, role)
            with patch.object(self.store.engine, 'authorize_read', side_effect=restricted):
                incident = next(r for r in self.history()['items'] if r['incidentId'] == old['incidentId'])
                self.assertNotIn(self.inspection['id'], [r['sourceRef']['objectId'] for r in incident['items']])

    def test_no_work_history_still_requires_drawing_access_and_project_scope(self):
        with self.store.transaction(True):
            terminal = {'Inspection': 'completed', 'Issue': 'closed', 'Action': 'closed'}
            for (kind, _), record in self.store.engine._records.items():
                if kind in terminal: record['status'] = terminal[kind]
        self.withdraw()
        incident = self.history()['items'][0]
        self.assertEqual(incident['items'], [])
        foreign = self.client.get('/projects/' + str(uuid4()) + '/parallel/drawing-impacts/history')
        self.assertEqual(foreign.json()['items'], [])
        with self.store.transaction(True):
            role = self.store.engine.get('RoleAssignment', self.actor['roleAssignmentId'])
            role['authorityCodes'].remove('render_document')
            self.store.engine._save('RoleAssignment', role)
        self.assertEqual(self.history(), {'items': [], 'total': 0})


if __name__ == '__main__':
    unittest.main()
