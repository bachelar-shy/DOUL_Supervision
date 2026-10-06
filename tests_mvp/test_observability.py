"""System logs, metrics and durable alert delivery do not mutate business audit."""
import contextlib
import io
import json
import logging
import os
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fastapi.testclient import TestClient
from services.api.main import create_app
from services.api.store import SQLiteSnapshotAdapter
from services.telemetry import record, SafeRuntimeFormatter
from services.observability.metrics import collect, alerts_for, object_metrics
from services.observability.alerts import AlertDispatcher
from services.runtime_config import secret
from tests_mvp.test_worker_jobs import create_job


class FakeRedis:
    def ping(self): return True
    def xpending(self, *_): return {'pending': 2}
    def xinfo_groups(self, *_): return [{'name': 'workers-v1', 'lag': 3}]
    def xlen(self, *_): return 5
    def scan_iter(self, **_): return iter(['doul:test:heartbeat:one'])
    def ttl(self, _): return 20


class QueueView:
    client = FakeRedis()
    stream = 'doul:test:events'
    group = 'workers-v1'
    namespace = 'doul:test'


class ObjectClient:
    def get_paginator(self, name):
        assert name == 'list_object_versions'
        return self
    def paginate(self, **_):
        yield {'Versions': [{'Size': 10, 'IsLatest': True}, {'Size': 20, 'IsLatest': False}],
               'DeleteMarkers': [{'Key': 'deleted'}], 'IsTruncated': False}


class TelemetryTests(unittest.TestCase):
    def test_allowlist_drops_credentials_payload_and_nonfinite_values(self):
        result = record('api', 'http-request', route='/projects/{project_id}/issues', method='POST',
                        statusCode=201, headers={'Authorization': 'Bearer secret'}, payload='secret',
                        password='secret', url='https://host/?token=secret', latencyMs=float('nan'))
        self.assertNotIn('secret', json.dumps(result))
        self.assertNotIn('latencyMs', result)
        self.assertEqual(result['statusCode'], 201)

    def test_library_exception_text_and_traceback_are_not_logged(self):
        try: raise ValueError('postgresql://user:secret@host/database')
        except ValueError:
            import sys
            entry = logging.LogRecord('httpx', logging.ERROR, '', 1, 'Bearer secret', (), sys.exc_info())
        rendered = SafeRuntimeFormatter().format(entry)
        self.assertNotIn('secret', rendered)
        self.assertIn('ValueError', rendered)

    def test_api_logs_route_template_not_query_or_identifiers(self):
        store = SQLiteSnapshotAdapter(':memory:')
        self.addCleanup(store.close)
        app = create_app(demo=True, persistence=store)
        capture = io.StringIO()
        before = len(store.engine.audit_events)
        with TestClient(app) as client, contextlib.redirect_stdout(capture):
            response = client.get('/health?token=never-log-this', headers={'X-Request-ID': 'untrusted-secret'})
            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.headers['X-Request-ID'], 'untrusted-secret')
            self.assertEqual(client.get('/ready').status_code, 200)
        lines = [json.loads(line) for line in capture.getvalue().splitlines()]
        self.assertTrue(any(x.get('route') == '/health' for x in lines))
        self.assertNotIn('never-log-this', capture.getvalue())
        self.assertNotIn('untrusted-secret', capture.getvalue())
        self.assertEqual(len(store.engine.audit_events), before)

    def test_readiness_failure_does_not_leak_exception(self):
        store = SQLiteSnapshotAdapter(':memory:')
        self.addCleanup(store.close)
        with TestClient(create_app(demo=True, persistence=store)) as client:
            with patch.object(store, 'transaction', side_effect=RuntimeError('password=secret')):
                response = client.get('/ready')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret', response.text)

    def test_runtime_secrets_require_protected_files_outside_development(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'secret'
            path.write_text('synthetic-secret')
            path.chmod(0o600)
            with patch.dict(os.environ, {'DOUL_ENVIRONMENT': 'pilot', 'TEST_VALUE_FILE': str(path)}, clear=True):
                self.assertEqual(secret('TEST_VALUE'), 'synthetic-secret')
                path.chmod(0o644)
                with self.assertRaises(ValueError): secret('TEST_VALUE')
            with patch.dict(os.environ, {'DOUL_ENVIRONMENT': 'pilot', 'TEST_VALUE': 'synthetic-secret'}, clear=True):
                with self.assertRaises(ValueError): secret('TEST_VALUE')


class MetricsTests(unittest.TestCase):
    def test_queue_capacity_counters_and_audit_separation(self):
        store = SQLiteSnapshotAdapter(':memory:')
        self.addCleanup(store.close)
        create_job(store)
        before = len(store.engine.audit_events)
        with tempfile.TemporaryDirectory() as root:
            events = collect(store, QueueView(), ObjectClient(), 'synthetic-bucket',
                             budgets={'databaseBytes': 10000000, 'objectBytes': 100},
                             disk_paths={'object-volume': root})
        by_component = {e['component']: e for e in events}
        self.assertTrue(all(e['status'] == 'ok' for e in events))
        self.assertEqual(by_component['job-queue']['details']['ready'], 1)
        self.assertEqual(by_component['redis-worker']['details']['transportPending'], 2)
        self.assertEqual(by_component['object-capacity']['details']['retainedVersionBytes'], 30)
        self.assertFalse(by_component['object-capacity']['details']['physicalFreeBytesMeasured'])
        self.assertTrue(by_component['object-volume']['details']['physicalFreeBytesMeasured'])
        self.assertEqual(len(store.engine.audit_events), before)
        self.assertFalse(alerts_for(events, capacity_percent=100))

    def test_failures_are_signals_not_fake_zero_success(self):
        store = SQLiteSnapshotAdapter(':memory:')
        self.addCleanup(store.close)
        class Down(FakeRedis):
            def ping(self): raise ConnectionError('redis://:secret@host')
        queue = QueueView()
        queue.client = Down()
        events = collect(store, queue, None, None)
        self.assertEqual(sum(e['status'] == 'error' for e in events), 2)
        self.assertNotIn('secret', json.dumps(events))
        self.assertTrue(alerts_for(events))

    def test_partial_capacity_inventory_is_explicit_and_alerted(self):
        class Paged(ObjectClient):
            def paginate(self, **_):
                while True: yield {'Versions': [{'Size': 10}], 'IsTruncated': True}
        details = object_metrics(Paged(), 'bucket', max_pages=1)
        self.assertFalse(details['inventoryComplete'])
        alerts = alerts_for([{'component': 'object-capacity', 'status': 'ok', 'details': details}])
        self.assertEqual(alerts[0]['code'], 'CAPACITY_SCAN_INCOMPLETE')


class AlertHandler(BaseHTTPRequestHandler):
    responses_to_send = []
    received = []
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.received.append((self.path, payload, self.headers.get('Authorization'), self.headers.get('Idempotency-Key')))
        status = self.responses_to_send.pop(0) if self.responses_to_send else 200
        self.send_response(status)
        if status == 302: self.send_header('Location', '/must-not-follow')
        self.end_headers()
    def log_message(self, *_): pass


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / 'alerts.json'
        AlertHandler.responses_to_send = []
        AlertHandler.received = []
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), AlertHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.url = 'http://127.0.0.1:' + str(self.server.server_address[1]) + '/alerts'
        self.token = 'synthetic-service-token'
        self.alert = {'component': 'job-queue', 'code': 'WORKER_JOB_FAILED', 'severity': 'critical'}

    def close_server(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)

    def dispatcher(self):
        return AlertDispatcher(self.state, self.url, self.token, allow_loopback_http=True)

    def test_success_dedup_and_recovery_delivery(self):
        dispatcher = self.dispatcher()
        self.assertEqual(dispatcher.pump([self.alert], now=100)['delivered'], 1)
        self.assertEqual(dispatcher.pump([self.alert], now=101)['delivered'], 0)
        self.assertEqual(dispatcher.pump([], now=102)['delivered'], 1)
        self.assertEqual([r[1]['status'] for r in AlertHandler.received], ['firing', 'resolved'])
        self.assertEqual(AlertHandler.received[0][2], 'Bearer ' + self.token)
        self.assertEqual(AlertHandler.received[0][3], AlertHandler.received[0][1]['deliveryId'])
        self.assertNotIn(self.token, self.state.read_text())
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o600)

    def test_failed_delivery_survives_restart_and_preserves_id(self):
        AlertHandler.responses_to_send = [503, 200]
        first = self.dispatcher().pump([self.alert], now=100)
        self.assertEqual(first['pending'], 1)
        second = self.dispatcher().pump([self.alert], now=120)
        self.assertEqual(second['pending'], 0)
        self.assertEqual(AlertHandler.received[0][3], AlertHandler.received[1][3])

    def test_redirect_does_not_forward_credentials(self):
        AlertHandler.responses_to_send = [302]
        result = self.dispatcher().pump([self.alert], now=100)
        self.assertEqual(result['pending'], 1)
        self.assertEqual([r[0] for r in AlertHandler.received], ['/alerts'])

    def test_insecure_non_loopback_endpoint_and_unknown_fields_rejected(self):
        with self.assertRaises(ValueError): AlertDispatcher(self.state, 'http://example.org/hook', self.token, True)
        with self.assertRaises(ValueError): self.dispatcher().pump([{**self.alert, 'password': 'secret'}])

    def test_separate_spools_do_not_share_delivery_ids(self):
        first = self.dispatcher()
        first.pump([self.alert], now=100)
        other = AlertDispatcher(Path(self.tmp.name) / 'other.json', self.url, self.token, True)
        other.pump([self.alert], now=100)
        self.assertNotEqual(AlertHandler.received[0][3], AlertHandler.received[1][3])


if __name__ == '__main__':
    unittest.main()
