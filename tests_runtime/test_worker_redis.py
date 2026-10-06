"""Real Redis/PostgreSQL and separate-process worker tests for disposable CI only."""
from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from services.api.main import create_app
from services.api.persistence import create_postgres_persistence
from services.worker.jobs import dispatch, ledger, process_message
from services.worker.providers import FixtureProvider
from services.worker.queue import RedisQueue
from tests_mvp.test_worker_jobs import seed_source, create_job


@unittest.skipUnless(os.getenv('TEST_REDIS_URL') and os.getenv('TEST_POSTGRES_DSN'), 'Disposable integration services not configured')
class RedisWorkerIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store = create_postgres_persistence(os.environ['TEST_POSTGRES_DSN'], demo=True)
        self.namespace = 'doul:test:' + uuid4().hex
        self.queue = RedisQueue(os.environ['TEST_REDIS_URL'], self.namespace)
        self.addCleanup(self.store.close)
        self.addCleanup(self.queue.close)
        self.provider = FixtureProvider(demo=True)

    def api_job(self):
        source = seed_source(self.store)
        with self.store.transaction(True):
            self.store.meta['projectConfiguration'] = dict(configVersion=1, mediaPolicy=dict(
                autoRetry=dict(maxAttempts=2, backoffSeconds=[0])))
        app = create_app(demo=True, persistence=self.store, queue_enabled=True)
        with TestClient(app) as client:
            session = client.post('/dev/sessions', json={'actorGroup': 'SUP'}).json()
            run_id = str(uuid4())
            response = client.post('/projects/' + session['projectId'] + '/media-analysis-runs',
                headers={'Authorization': 'Bearer ' + session['accessToken'], 'Idempotency-Key': run_id},
                json=dict(roleAssignmentId=session['actor']['roleAssignmentId'], clientObjectId=run_id,
                          sourceEvidenceIds=[source], mode='photo', languages=['ko', 'vi']))
            self.assertEqual(response.status_code, 201, response.text)
        with self.store.transaction():
            job_id = next(j['jobId'] for j in ledger(self.store).values() if j['runId'] == run_id)
        return job_id, run_id

    def worker_process(self):
        log = tempfile.TemporaryFile(mode='w+b')
        env = dict(os.environ, DATABASE_URL=os.environ['TEST_POSTGRES_DSN'],
                   REDIS_URL=os.environ['TEST_REDIS_URL'], DOUL_QUEUE_NAMESPACE=self.namespace)
        proc = subprocess.Popen([sys.executable, '-m', 'services.worker', '--demo', '--fixture'],
                                env=env, stdout=log, stderr=subprocess.STDOUT)
        def cleanup():
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(8)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait(5)
            log.close()
        self.addCleanup(cleanup)
        return proc, log

    def wait_done(self, job_id, proc, seconds=25):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.assertIsNone(proc.poll(), 'worker exited before completing job')
            with self.store.transaction():
                state = ledger(self.store)[job_id]['state']
            if state == 'done': return
            self.assertNotEqual(state, 'dead', 'integration job unexpectedly dead-lettered')
            time.sleep(0.2)
        self.fail('worker did not finish in bounded test interval')

    def test_api_redis_separate_worker_and_graceful_termination(self):
        job_id, run_id = self.api_job()
        # A real Redis event is explicitly observed before the separate process consumes it.
        dispatch(self.store, self.queue)
        self.assertGreater(self.queue.client.xlen(self.queue.stream), 0)
        proc, log = self.worker_process()
        self.wait_done(job_id, proc)
        proc.send_signal(signal.SIGTERM)
        self.assertEqual(proc.wait(8), 0)
        log.seek(0)
        output = log.read().decode()
        self.assertIn('graceful-stop', output)
        self.assertNotIn(os.environ['TEST_POSTGRES_DSN'], output)
        self.assertNotIn(os.environ['TEST_REDIS_URL'], output)
        with self.store.transaction():
            candidates = [r for (kind, _), r in self.store.engine._records.items()
                          if kind == 'Observation' and r.get('analysisRunId') == run_id]
            self.assertEqual(len(candidates), 1)
            self.assertEqual(candidates[0]['status'], 'candidate')

    def test_pending_delivery_claim_and_duplicate_enqueue(self):
        job_id, _ = create_job(self.store)
        first = self.queue.publish(job_id, 1)
        self.assertEqual(self.queue.publish(job_id, 1), first)
        message = self.queue.receive('crashed-consumer')
        self.assertEqual(message[0], first)
        recovered = self.queue.receive('replacement-consumer', reclaim_ms=0)
        self.assertEqual(recovered[0], first)
        self.assertEqual(process_message(self.store, self.queue, self.provider, recovered), 'done')
        self.assertEqual(self.queue.client.xpending(self.queue.stream, self.queue.group)['pending'], 0)
        self.assertEqual(process_message(self.store, self.queue, self.provider, message), 'ignored')

    def test_process_crash_lease_expiry_recovers_without_duplicate_results(self):
        job_id, run_id = self.api_job()
        env = dict(os.environ, DATABASE_URL=os.environ['TEST_POSTGRES_DSN'], JOB_ID=job_id)
        code = '''import os
from services.api.persistence import create_postgres_persistence
from services.worker.jobs import claim
s=create_postgres_persistence(os.environ['DATABASE_URL'],demo=True)
assert claim(s,os.environ['JOB_ID'],lease_seconds=5)
os._exit(9)
'''
        crashed = subprocess.run([sys.executable, '-c', code], env=env, capture_output=True, timeout=15)
        self.assertEqual(crashed.returncode, 9)
        proc, _ = self.worker_process()
        self.wait_done(job_id, proc)
        with self.store.transaction():
            job = ledger(self.store)[job_id]
            self.assertEqual(len(job['attempts']), 2)
            self.assertEqual(job['attempts'][0]['status'], 'lease_expired')
            candidates = [r for (k, _), r in self.store.engine._records.items()
                          if k == 'Observation' and r.get('analysisRunId') == run_id]
            self.assertEqual(len(candidates), 1)

    def test_connection_failure_is_nonzero_and_secret_safe(self):
        env = dict(os.environ, DATABASE_URL=os.environ['TEST_POSTGRES_DSN'],
                   REDIS_URL='redis://:never-log-this@127.0.0.1:1/0')
        result = subprocess.run([sys.executable, '-m', 'services.worker', '--demo'], env=env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 1)
        self.assertIn('runtime-failure', result.stdout)
        self.assertNotIn('never-log-this', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
