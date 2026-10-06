"""Pre-network transport and exact-release regressions; synthetic data only."""
from datetime import datetime, timezone, timedelta
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from services.api.postgres_store import PostgresSnapshotAdapter
from services.deployment.release import verify_checkout, verify_recovery, verify_https
from services.runtime_config import validate_database_dsn, validate_redis_url
from services.worker.queue import RedisQueue


class TransportSafetyTests(unittest.TestCase):
    def test_pilot_plaintext_database_is_rejected_before_pool_creation(self):
        with patch.dict(os.environ, {'DOUL_ENVIRONMENT': 'pilot'}), patch('services.api.postgres_store.ConnectionPool') as pool:
            with self.assertRaisesRegex(ValueError, 'verified TLS'):
                PostgresSnapshotAdapter('postgresql://review:synthetic-secret@db.invalid/review', demo=False)
            pool.assert_not_called()

    def test_operational_demo_rejected_before_database_pool(self):
        with patch.dict(os.environ, {'DOUL_ENVIRONMENT': 'staging'}), patch('services.api.postgres_store.ConnectionPool') as pool:
            with self.assertRaisesRegex(ValueError, 'Demo persistence'):
                PostgresSnapshotAdapter('postgresql://review:synthetic-secret@db.invalid/review', demo=True)
            pool.assert_not_called()

    def test_pilot_redis_certificate_and_hostname_bypass_rejected_before_client(self):
        urls = ['redis://:synthetic-secret@redis.invalid/0']
        urls += ['rediss://:synthetic-secret@redis.invalid/0?' + query for query in (
            'ssl_cert_reqs=none', 'ssl_cert_reqs=optional', 'ssl_check_hostname=False',
            'ssl_check_hostname=No', 'ssl_cert_reqs=none&ssl_check_hostname=True')]
        for url in urls:
            with self.subTest(url=url), patch.dict(os.environ, {'DOUL_ENVIRONMENT': 'pilot'}), patch('redis.Redis.from_url') as client:
                with self.assertRaises(ValueError):
                    RedisQueue(url, 'doul:pilot:media')
                client.assert_not_called()

    def test_explicit_verified_pilot_transports_are_accepted(self):
        dsn = 'postgresql://review:synthetic-secret@db.invalid/review?sslmode=verify-full&sslrootcert=/run/secrets/ca'
        redis = 'rediss://:synthetic-secret@redis.invalid/0?ssl_cert_reqs=required&ssl_check_hostname=True'
        self.assertEqual(validate_database_dsn(dsn, 'pilot'), dsn)
        self.assertEqual(validate_redis_url(redis, 'pilot'), redis)

    def test_default_credentials_rejected_for_each_operational_transport(self):
        for stage in ('staging', 'pilot'):
            with self.subTest(stage=stage):
                with self.assertRaises(ValueError):
                    validate_database_dsn('postgresql://review:password@db.invalid/review', stage)
                with self.assertRaises(ValueError):
                    validate_redis_url('rediss://:local%2Dredis%2Donly@redis.invalid/0', stage)


class RecoveryEvidenceSafetyTests(unittest.TestCase):
    def reports(self, root, age=0):
        created = (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat()
        backup = dict(encrypted=True, bundleSha256='a'*64, createdAt=created,
                      composeProject='doul-supervision-staging')
        restored = dict(verified=True, bundleSha256='a'*64, backupCreatedAt=created,
                        composeProject='doul-supervision-staging', targets={'rpoSeconds': 300, 'status': 'draft'})
        return backup, restored

    def verify(self, root, backup, restored, stage='staging'):
        a, b = root/'backup.json', root/'restore.json'
        a.write_text(json.dumps(backup)); b.write_text(json.dumps(restored))
        return verify_recovery({'environment': stage, 'recovery': {'backupReport': str(a), 'restoreReport': str(b)}})

    def test_copied_old_report_cannot_reset_recovery_point_age(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            backup, restored = self.reports(root, age=3600)
            with self.assertRaisesRegex(ValueError, 'recovery-point'):
                self.verify(root, backup, restored)
            self.assertGreater((root/'backup.json').stat().st_mtime, datetime.now(timezone.utc).timestamp()-10)

    def test_creation_time_must_match_decrypted_manifest_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            backup, restored = self.reports(root)
            restored['backupCreatedAt'] = '2020-01-01T00:00:00Z'
            with self.assertRaisesRegex(ValueError, 'verified archive'):
                self.verify(root, backup, restored)
            backup.pop('createdAt')
            with self.assertRaises(ValueError):
                self.verify(root, backup, restored)

    def test_recovery_evidence_cannot_cross_staging_pilot_boundary(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            backup, restored = self.reports(root)
            restored['targets']['status'] = 'approved'
            with self.assertRaisesRegex(ValueError, 'different deployment'):
                self.verify(root, backup, restored, 'pilot')

    def test_future_or_timezone_free_recovery_times_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for created in ('2026-10-06T01:00:00', (datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()):
                backup, restored = self.reports(root)
                backup['createdAt'] = restored['backupCreatedAt'] = created
                with self.subTest(created=created), self.assertRaises(ValueError):
                    self.verify(root, backup, restored)

    def test_fresh_matching_reports_are_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.verify(root, *self.reports(root))


class ExactCheckoutTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.file = self.root/'tracked.txt'
        self.file.write_text('approved\n')
        self.git('add', 'tracked.txt')
        self.git('-c', 'user.name=Review Test', '-c', 'user.email=review@example.invalid', 'commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        patched = patch('services.deployment.release.ROOT', self.root)
        patched.start(); self.addCleanup(patched.stop)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True, stderr=subprocess.PIPE)

    def test_clean_exact_checkout_is_accepted(self):
        verify_checkout(self.sha)

    def test_staged_changes_are_rejected(self):
        self.file.write_text('unapproved\n'); self.git('add', 'tracked.txt')
        self.assertEqual(self.git('diff'), '')
        with self.assertRaisesRegex(ValueError, 'staged'):
            verify_checkout(self.sha)

    def test_unstaged_and_untracked_changes_are_rejected(self):
        self.file.write_text('unapproved\n')
        with self.assertRaises(ValueError): verify_checkout(self.sha)
        self.file.write_text('approved\n')
        (self.root/'new.py').write_text('unapproved\n')
        with self.assertRaises(ValueError): verify_checkout(self.sha)


class RunningReleaseTests(unittest.TestCase):
    def test_tls_readiness_alone_cannot_confirm_wrong_release_or_environment(self):
        plan = dict(publicUrl='https://deployment.invalid', environment='staging', releaseSha='a'*40)
        for mode, sha, succeeds in [('staging', 'a'*40, True), ('pilot', 'a'*40, False), ('staging', 'b'*40, False)]:
            responses = []
            for payload in ({'status':'ok'}, {'status':'ok','mode':mode,'baseCommit':sha}):
                response = MagicMock()
                response.__enter__.return_value.status = 200
                response.__enter__.return_value.read.return_value = json.dumps(payload).encode()
                responses.append(response)
            opener = MagicMock(); opener.open.side_effect = responses
            with self.subTest(mode=mode, sha=sha), patch('urllib.request.build_opener', return_value=opener):
                if succeeds: verify_https(plan)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'Running environment'):
                        verify_https(plan)
            self.assertEqual(opener.open.call_count, 2)


if __name__ == '__main__':
    unittest.main()
