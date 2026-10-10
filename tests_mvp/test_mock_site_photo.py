"""Real synthetic image ingestion is always part of MVP CI, not an optional skip."""
from pathlib import Path
import unittest
from scripts.validate_mock_site_photo import validate

class MockSitePhotoAcceptance(unittest.TestCase):
    def test_generated_original_survives_retries_and_restart(self):
        photo=Path(__file__).resolve().parents[1]/'design/development/mock-site/assets/SYNTHETIC_WWT_contact_sheet_P01-P12.png'
        result=validate(photo)
        self.assertFalse(result['actualFieldAcceptance'])
        self.assertIn('restart_preserves_original_hash',result['checks'])
        self.assertIn('changed_body_same_key_rejected',result['checks'])
        self.assertIn('foreign_project_rejected',result['checks'])

if __name__=='__main__':unittest.main()
