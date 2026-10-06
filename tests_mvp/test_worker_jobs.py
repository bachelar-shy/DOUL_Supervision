"""Durable job invariants with the real application engine and persistence."""
import copy
from hashlib import sha256
import tempfile
from pathlib import Path
import unittest

from fastapi.testclient import TestClient
from app.reference.engine import uid
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter
from services.api.application import queue_media_analysis
from services.worker.jobs import register_job, ledger, dispatch, claim, finish, process_message
from services.worker.providers import FixtureProvider, UnconfiguredProvider

PNG = b'\x89PNG\r\n\x1a\nsynthetic-test-fixture'


class FakeQueue:
    def __init__(self):
        self.messages = []
        self.acks = []
    def publish(self, job_id, generation):
        self.messages.append(('1-0', {'jobId': job_id}))
        return '1-0'
    def acknowledge(self, message_id):
        self.acks.append(message_id)


def seed_source(store):
    with store.transaction(True):
        actor = store.meta['actors']['SUP']
        evidence_id, file_id = uid(), uid()
        payload = dict(sourceType='original', mediaType='photo', fileId=file_id,
                       fileHash=sha256(PNG).hexdigest(), sourcePartyId=actor['partyId'],
                       metadata={'mimeType': 'image/png'}, **store.meta['scope'])
        store.engine.add_evidence(evidence_id, store.meta['projectId'], payload, PNG,
                                 actor['partyId'], actor['roleAssignmentId'], uid())
        store.put_blob(file_id, PNG)
    return evidence_id


def create_job(store, retries=0):
    source = seed_source(store)
    with store.transaction(True):
        store.meta['projectConfiguration'] = dict(configVersion=1, mediaPolicy=dict(
            autoRetry=dict(maxAttempts=retries + 1, backoffSeconds=[0] * retries)))
        actor = store.meta['actors']['SUP']
        run = queue_media_analysis(store.engine, uid(), [source], 'photo', ['ko'],
            store.meta['analysisProfile'], actor['partyId'], actor['roleAssignmentId'], uid())
        job_id = register_job(store, run)
    return job_id, run


class WorkerJobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = SQLiteSnapshotAdapter(str(Path(self.tmp.name) / 'state.sqlite3'))
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.store.close)
        self.queue = FakeQueue()
        self.provider = FixtureProvider(demo=True)

    def results(self, run):
        with self.store.transaction():
            return [r for (kind, _), r in self.store.engine._records.items()
                    if kind == 'Observation' and r.get('analysisRunId') == run['id']]

    def test_api_persists_one_authorized_outbox_job_and_replay(self):
        source = seed_source(self.store)
        app = create_app(demo=True, persistence=self.store, queue_enabled=True)
        with TestClient(app) as client:
            session = client.post('/dev/sessions', json={'actorGroup': 'SUP'}).json()
            headers = {'Authorization': 'Bearer ' + session['accessToken'], 'Idempotency-Key': uid()}
            body = dict(roleAssignmentId=session['actor']['roleAssignmentId'], clientObjectId=uid(),
                        sourceEvidenceIds=[source], mode='photo', languages=['ko'])
            url = '/projects/' + session['projectId'] + '/media-analysis-runs'
            first = client.post(url, headers=headers, json=body)
            self.assertEqual(first.status_code, 201, first.text)
            self.assertEqual(client.post(url, headers=headers, json=body).json(), first.json())
            con = client.post('/dev/sessions', json={'actorGroup': 'CON'}).json()
            body.update(roleAssignmentId=con['actor']['roleAssignmentId'], clientObjectId=uid())
            rejected = client.post(url, headers={'Authorization': 'Bearer ' + con['accessToken'],
                                  'Idempotency-Key': uid()}, json=body)
            self.assertEqual(rejected.status_code, 403, rejected.text)
        with self.store.transaction():
            self.assertEqual(len(ledger(self.store)), 1)

    def test_outbox_rollback_and_transport_failure_do_not_lose_domain_data(self):
        job_id, run = create_job(self.store)
        with self.assertRaises(RuntimeError):
            with self.store.transaction(True):
                ledger(self.store).clear()
                raise RuntimeError('rollback')
        class Down:
            def publish(self, *_): raise ConnectionError('synthetic transport failure')
        with self.assertRaises(ConnectionError): dispatch(self.store, Down())
        with self.store.transaction():
            self.assertEqual(ledger(self.store)[job_id]['state'], 'ready')
            self.assertEqual(self.store.engine.get('AnalysisRun', run['id'])['status'], 'queued')

    def test_exactly_one_candidate_commit_and_service_actor_audit(self):
        job_id, run = create_job(self.store)
        dispatch(self.store, self.queue)
        message = self.queue.messages[-1]
        self.assertEqual(process_message(self.store, self.queue, self.provider, message), 'done')
        self.assertEqual(process_message(self.store, self.queue, self.provider, message), 'ignored')
        candidates = self.results(run)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]['status'], 'candidate')
        with self.store.transaction():
            job = ledger(self.store)[job_id]
            self.assertEqual(len(job['attempts']), 1)
            event = next(e for e in self.store.engine.audit_events if e['command'] == 'analysis_run:complete')
            self.assertEqual(event['actorPartyId'], self.store.meta['serviceActors']['SYSTEM']['partyId'])

    def test_retry_is_bounded_and_records_attempts(self):
        job_id, run = create_job(self.store, retries=1)
        class Timeout:
            def analyze(self, *_args, **_kwargs): raise TimeoutError('secret-must-not-persist')
        message = ('1-0', {'jobId': job_id})
        self.assertEqual(process_message(self.store, self.queue, Timeout(), message), 'ready')
        self.assertEqual(process_message(self.store, self.queue, Timeout(), message), 'dead')
        with self.store.transaction():
            job = ledger(self.store)[job_id]
            self.assertEqual(len(job['attempts']), 2)
            self.assertNotIn('secret-must-not-persist', str(job))
            self.assertEqual(self.store.engine.get('AnalysisRun', run['id'])['status'], 'failed')
        self.assertFalse(self.results(run))

    def test_unconfigured_provider_never_fabricates_success(self):
        job_id, run = create_job(self.store)
        self.assertEqual(process_message(self.store, self.queue, UnconfiguredProvider(),
                                        ('1-0', {'jobId': job_id})), 'dead')
        with self.store.transaction():
            self.assertEqual(ledger(self.store)[job_id]['errorCode'], 'ADAPTER_NOT_CONFIGURED')
        self.assertFalse(self.results(run))

    def test_fencing_rejects_late_worker_after_lease_recovery(self):
        job_id, run = create_job(self.store, retries=1)
        first = claim(self.store, job_id, 5)
        with self.store.transaction(True): ledger(self.store)[job_id]['leaseUntil'] = 0
        second = claim(self.store, job_id, 5)
        self.assertNotEqual(first['token'], second['token'])
        self.assertEqual(finish(self.store, job_id, first['token'], result={}), 'stale')
        with self.store.transaction():
            self.assertEqual(ledger(self.store)[job_id]['attempts'][0]['status'], 'lease_expired')
        self.assertFalse(self.results(run))

    def test_busy_delivery_and_unknown_or_forged_messages_cannot_mutate(self):
        job_id, run = create_job(self.store)
        claim(self.store, job_id)
        self.assertEqual(process_message(self.store, self.queue, self.provider, ('1-0', {'jobId': job_id})), 'ignored')
        self.assertEqual(process_message(self.store, self.queue, self.provider, ('2-0', {'jobId': 'f' * 64})), 'ignored')
        self.assertEqual(process_message(self.store, self.queue, self.provider,
            ('3-0', {'jobId': job_id, 'approved': True})), 'rejected')
        self.assertFalse(self.results(run))

    def test_cancellation_wins_over_worker_result(self):
        job_id, run = create_job(self.store)
        claimed = claim(self.store, job_id)
        with self.store.transaction(True):
            actor = self.store.meta['actors']['SUP']
            current = self.store.engine.get('AnalysisRun', run['id'])
            self.store.engine.execute('analysis_run', run['id'], 'cancel', current['version'],
                {'reason': 'user cancelled'}, [], actor['partyId'], actor['roleAssignmentId'], uid())
        self.assertEqual(finish(self.store, job_id, claimed['token'], result={}), 'cancelled')
        self.assertFalse(self.results(run))

    def test_source_hash_failure_precedes_provider(self):
        job_id, run = create_job(self.store)
        with self.store.transaction(True):
            source = self.store.engine.get('Evidence', run['sourceEvidenceIds'][0])
            self.store.put_blob(source['fileId'], b'tampered')
        class MustNotRun:
            def analyze(self, *_args, **_kwargs): raise AssertionError('provider must not be invoked')
        self.assertEqual(process_message(self.store, self.queue, MustNotRun(), ('1-0', {'jobId': job_id})), 'dead')
        with self.store.transaction(): self.assertEqual(ledger(self.store)[job_id]['errorCode'], 'EVIDENCE_INVALID')

    def test_invalid_output_rolls_back_before_failure_record(self):
        job_id, run = create_job(self.store)
        class Invalid:
            def analyze(self, *_args, **_kwargs): return {'outputs': [{'approved': True}], 'coverage': {}}
        self.assertEqual(process_message(self.store, self.queue, Invalid(), ('1-0', {'jobId': job_id})), 'dead')
        self.assertFalse(self.results(run))
        with self.store.transaction():
            self.assertFalse(any(e['command'] == 'analysis_run:complete' for e in self.store.engine.audit_events))


if __name__ == '__main__':
    unittest.main()
