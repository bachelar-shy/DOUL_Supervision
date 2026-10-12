import unittest
from services.api.modules.drawing_sheet_metadata import extract_sheet_candidate


class DrawingSheetMetadataTests(unittest.TestCase):
    def test_bilingual_original_titleblock(self):
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

    def test_vietnamese_only_titleblock(self):
        item = extract_sheet_candidate(7, """GHI CHÚ
TÊN BẢN VẼ: MẶT BẰNG TẦNG 2
SỐ HIỆU BẢN VẼ: AR-204
TỶ LỆ 1:100
""")
        self.assertEqual(item.number, "AR-204")
        self.assertEqual(item.title, "MẶT BẰNG TẦNG 2")

    def test_english_alternate_labels(self):
        item = extract_sheet_candidate(1, """DWG No.: A101
DRAWING NAME : GROUND FLOOR PLAN
Scale: 1:100
""")
        self.assertEqual(item.number, "A101")
        self.assertEqual(item.title, "GROUND FLOOR PLAN")
        self.assertFalse(item.needs_review)

    def test_number_in_next_line_of_title_block(self):
        item = extract_sheet_candidate(9, """SHEET NO.
AR-005B
Drawing Title
LEVEL 3
CEILING PLAN
Checked By: Inspector
""")
        self.assertEqual(item.number, "AR-005B")
        self.assertEqual(item.title, "LEVEL 3 CEILING PLAN")

    def test_multiple_titleblock_numbers_not_guessed(self):
        item = extract_sheet_candidate(2, """Drawing Number XX-01
Drawing Number YY-02
Drawing Title: GROUND FLOOR PLAN
""")
        self.assertIsNone(item.number)
        self.assertEqual(item.title, "GROUND FLOOR PLAN")
        self.assertTrue(item.needs_review)
        self.assertIn("ambiguous", item.provenance)

    def test_body_reference_without_titleblock_label_is_ignored(self):
        item = extract_sheet_candidate(5, """DETAIL A
AR-101 PARTITION DETAIL
NOTE REFER TO WW-01
""")
        self.assertIsNone(item.number)
        self.assertIsNone(item.title)
        self.assertTrue(item.needs_review)

    def test_repeated_identical_labeled_values_are_not_ambiguous(self):
        item = extract_sheet_candidate(4, """Drawing Number AR-005
Drawing Title: SLAB DETAIL
Drawing Number AR-005
Drawing Title: SLAB DETAIL
""")
        self.assertEqual(item.number, "AR-005")
        self.assertEqual(item.title, "SLAB DETAIL")
        self.assertFalse(item.needs_review)

    def test_scanned_page_stays_for_manual_review(self):
        item = extract_sheet_candidate(1, "")
        self.assertIsNone(item.number)
        self.assertIsNone(item.title)
        self.assertTrue(item.needs_review)

    def test_page_zero_is_rejected(self):
        with self.assertRaises(ValueError):
            extract_sheet_candidate(0, "Drawing Number WW-01")


if __name__ == "__main__":
    unittest.main()
