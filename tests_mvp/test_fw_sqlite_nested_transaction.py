"""SQLite demo snapshot transaction nesting exercised by authenticated field routes."""
import unittest
from concurrent.futures import ThreadPoolExecutor

from services.api.store import SQLiteSnapshotAdapter


class SQLiteNestedTransactionTest(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteSnapshotAdapter(':memory:', demo=True)

    def tearDown(self):
        self.store.close()

    def test_read_inside_write_uses_current_uncommitted_authorized_snapshot(self):
        with self.store.transaction(write=True):
            self.store.meta['nestedFieldAuthProbe'] = {'actor': 'SUP', 'version': 1}
            with self.store.transaction():
                self.assertEqual(self.store.meta['nestedFieldAuthProbe']['actor'], 'SUP')
                self.assertTrue(self.store.db.in_transaction)
                with self.store.transaction():
                    self.assertEqual(self.store.meta['nestedFieldAuthProbe']['version'], 1)
            self.assertEqual(self.store.meta['nestedFieldAuthProbe']['version'], 1)
        self.assertFalse(self.store.db.in_transaction)
        self.assertEqual(self.store._transaction_depth, 0)
        with self.store.transaction():
            self.assertEqual(self.store.meta['nestedFieldAuthProbe']['actor'], 'SUP')

    def test_nested_read_preserves_rollback_and_resets_scope(self):
        with self.assertRaisesRegex(ValueError, 'rollback'):
            with self.store.transaction(write=True):
                self.store.meta['nestedFieldRollback'] = True
                with self.store.transaction():
                    raise ValueError('rollback')
        self.assertFalse(self.store.db.in_transaction)
        self.assertEqual(self.store._transaction_depth, 0)
        with self.store.transaction():
            self.assertNotIn('nestedFieldRollback', self.store.meta)

    def test_nested_write_is_rejected_without_committing_partial_data(self):
        with self.store.transaction(write=True):
            with self.assertRaisesRegex(RuntimeError, 'Nested SQLite snapshot writes'):
                with self.store.transaction(write=True):
                    self.store.meta['nestedFieldWriteForbidden'] = True
            self.store.meta['outerWriteAllowed'] = 'ok'
        with self.store.transaction():
            self.assertNotIn('nestedFieldWriteForbidden', self.store.meta)
            self.assertEqual(self.store.meta['outerWriteAllowed'], 'ok')

    def test_concurrent_auth_reads_serialize_on_same_connection(self):
        with self.store.transaction(write=True):
            self.store.meta['roleVisibilityProbe'] = 'ready'

        def repeated_read(_):
            for _ in range(8):
                with self.store.transaction():
                    with self.store.transaction():
                        if self.store.meta['roleVisibilityProbe'] != 'ready':
                            raise AssertionError('Transaction snapshot changed')
            return True

        with ThreadPoolExecutor(max_workers=5) as pool:
            self.assertEqual(list(pool.map(repeated_read, range(8))), [True] * 8)
        self.assertEqual(self.store._transaction_depth, 0)


if __name__ == '__main__':
    unittest.main()
