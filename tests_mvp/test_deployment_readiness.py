"""Regression for post-merge #48 startup race; no live database is required."""
import unittest
from unittest.mock import MagicMock, patch

import psycopg
from tests_runtime.deployment_live import wait_for_database


class DeploymentReadinessTests(unittest.TestCase):
    dsn = 'postgresql://test:synthetic-password@127.0.0.1:55432/staging_test'

    def ready_connection(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.__exit__.return_value = False
        connection.execute.return_value.fetchone.return_value = (1,)
        return connection

    def test_temporary_connection_failure_then_real_authenticated_query(self):
        connection = self.ready_connection()
        with patch('psycopg.connect', side_effect=[psycopg.OperationalError('temporary startup'), connection]) as connect, \
                patch('tests_runtime.deployment_live.time.monotonic', return_value=0), \
                patch('tests_runtime.deployment_live.time.sleep') as sleep:
            wait_for_database(self.dsn)
        self.assertEqual(connect.call_count, 2)
        connect.assert_called_with(self.dsn, connect_timeout=2, options='-c statement_timeout=2000')
        connection.execute.assert_called_once_with('SELECT 1')
        connection.__exit__.assert_called_once()
        sleep.assert_called_once_with(0.25)

    def test_connection_without_successful_query_is_not_ready(self):
        starting = self.ready_connection()
        starting.execute.side_effect = psycopg.OperationalError('restarting')
        ready = self.ready_connection()
        with patch('psycopg.connect', side_effect=[starting, ready]) as connect, \
                patch('tests_runtime.deployment_live.time.monotonic', return_value=0), \
                patch('tests_runtime.deployment_live.time.sleep'):
            wait_for_database(self.dsn)
        self.assertEqual(connect.call_count, 2)
        starting.__exit__.assert_called_once()
        ready.execute.assert_called_once_with('SELECT 1')

    def test_timeout_is_bounded_and_does_not_echo_connection_secrets(self):
        with patch('psycopg.connect', side_effect=psycopg.OperationalError(self.dsn)) as connect, \
                patch('tests_runtime.deployment_live.time.monotonic', side_effect=[0, 0, 5]), \
                patch('tests_runtime.deployment_live.time.sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'before timeout') as caught:
                wait_for_database(self.dsn, timeout=5)
        self.assertNotIn('synthetic-password', str(caught.exception))
        self.assertIsNone(caught.exception.__cause__)
        self.assertEqual(connect.call_count, 1)
        sleep.assert_not_called()

    def test_programming_error_is_not_retried_as_startup(self):
        with patch('psycopg.connect', side_effect=psycopg.ProgrammingError('not a startup error')) as connect, \
                patch('tests_runtime.deployment_live.time.sleep') as sleep:
            with self.assertRaises(psycopg.ProgrammingError):
                wait_for_database(self.dsn)
        self.assertEqual(connect.call_count, 1)
        sleep.assert_not_called()

    def test_unexpected_query_result_fails_closed(self):
        connection = self.ready_connection()
        connection.execute.return_value.fetchone.return_value = None
        with patch('psycopg.connect', return_value=connection) as connect:
            with self.assertRaisesRegex(RuntimeError, 'Unexpected'):
                wait_for_database(self.dsn)
        self.assertEqual(connect.call_count, 1)
        connection.__exit__.assert_called_once()

    def test_non_positive_timeout_never_connects(self):
        with patch('psycopg.connect') as connect:
            for timeout in (0, -1):
                with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                    wait_for_database(self.dsn, timeout=timeout)
        connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
