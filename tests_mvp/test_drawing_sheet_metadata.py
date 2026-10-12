import unittest
from services.api.modules.drawing_sheet_metadata import extract_sheet_candidate


class DrawingSheetMetadataTests(unittest.TestCase):
    def test_title_block_number(self):
        source = """DRAWING LIST
WW-02 A3
TÊN BẢN VẼ / Drawing Title
WASTE WATER TREATMENT SYSTEM
DIAGRAM
Rev No Date
SỐ HIỆU BẢN VẼ
Drawing Number                                    WW-01
"""
        item = extract_sheet_candidate(3, source)
        self.assertEqual(item.number, "WW-01")
        self.assertEqual(item.title, "WASTE WATER TREATMENT SYSTEM DIAGRAM")
        self.assertFalse(item.needs_review)

    def test_multiple_titleblock_numbers_not_guessed(self):
        item = extract_sheet_candidate(2, "Drawing Number XX-01\\nDrawing Number YY-02")
        self.assertIsNone(item.number)
        self.assertTrue(item.needs_review)

    def test_scanned_page_stays_for_manual_review(self):
        item = extract_sheet_candidate(1, "")
        self.assertIsNone(item.number)
        self.assertIsNone(item.title)
        self.assertTrue(item.needs_review)


if __name__ == "__main__":
    unittest.main()
