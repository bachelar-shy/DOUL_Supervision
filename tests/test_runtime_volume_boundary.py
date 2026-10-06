"""Do not mount or chown a legacy MinIO data volume during runtime replacement."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RuntimeVolumeBoundaryTests(unittest.TestCase):
    def test_rustfs_and_permission_helper_have_separate_new_volume(self):
        compose = (ROOT / 'infra/compose/compose.dev.yml').read_text()
        self.assertEqual(compose.count('- object-storage-rustfs-data:/data'), 2)
        self.assertIn('\n  object-storage-rustfs-data:\n', compose)
        self.assertNotIn('- object-storage-data:/data', compose)
        self.assertNotIn('\n  object-storage-data:', compose)

    def test_existing_data_requires_explicit_migration_and_verification(self):
        policy = (ROOT / 'infra/object-storage-transition.md').read_text()
        self.assertIn('NOT automatically migrated', policy)
        self.assertIn('byte hashes', policy)
        self.assertIn('rollback', policy)


if __name__ == '__main__':
    unittest.main()
