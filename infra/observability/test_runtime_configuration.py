"""Configuration errors remain observable; endpoint failures are not masked."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runtime_snapshot as snapshot


class RuntimeConfigurationTests(unittest.TestCase):
    def test_missing_redis_url_still_emits_all_signals_and_summary(self):
        def healthy(component):
            return snapshot.event(component, 'health', 'ok', 0.0)
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), patch('sys.argv', ['runtime_snapshot.py']), \
                patch.object(snapshot, 'probe_api', return_value=healthy('api')), \
                patch.object(snapshot, 'probe_postgres', return_value=healthy('postgresql')), \
                patch.object(snapshot, 'probe_object_storage', return_value=healthy('object-storage')), \
                patch.object(snapshot.socket, 'create_connection') as connect, \
                contextlib.redirect_stdout(output):
            result = snapshot.main()
        self.assertEqual(result, 1)
        connect.assert_not_called()
        signals = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(signals), 5)
        self.assertEqual(signals[-1]['status'], 'error')
        self.assertEqual(signals[-1]['details']['checks'], 4)
        self.assertEqual(signals[-2]['details']['errorType'], 'MissingRedisUrl')

    def test_explicit_minio_path_avoids_guessing_s3_health_route(self):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        with patch.object(snapshot.urllib.request, 'urlopen', return_value=response) as request:
            result = snapshot.probe_object_storage('http://127.0.0.1:9000', '/minio/health/ready')
        self.assertEqual(result['status'], 'ok')
        request.assert_called_once_with('http://127.0.0.1:9000/minio/health/ready', timeout=5)

    def test_auto_discovery_only_falls_back_on_404(self):
        response = MagicMock()
        response.__enter__.return_value.status = 200
        missing = urllib.error.HTTPError('http://storage/health', 404, 'missing', {}, None)
        with patch.object(snapshot.urllib.request, 'urlopen', side_effect=[missing, response]) as request:
            result = snapshot.probe_object_storage('http://storage')
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(request.call_count, 2)
        self.assertEqual(result['details']['healthPath'], '/minio/health/ready')

    def test_auth_and_readiness_errors_are_not_hidden_by_fallback(self):
        for code in (401, 403, 500, 503):
            error = urllib.error.HTTPError('http://storage/health?token=do-not-log', code, 'secret-message', {}, None)
            with self.subTest(code=code), patch.object(snapshot.urllib.request, 'urlopen', side_effect=error) as request:
                result = snapshot.probe_object_storage('http://storage')
            self.assertEqual(result['status'], 'error')
            self.assertEqual(request.call_count, 1)
            self.assertNotIn('do-not-log', json.dumps(result))
            self.assertNotIn('secret-message', json.dumps(result))

    def test_unknown_explicit_path_is_rejected_without_network(self):
        with patch.object(snapshot.urllib.request, 'urlopen') as request:
            result = snapshot.probe_object_storage('http://storage', '/unreviewed')
        self.assertEqual(result['status'], 'error')
        request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
