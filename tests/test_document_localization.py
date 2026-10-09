import unittest

from app.reference.document_localization import (
    DOCUMENT_LOCALIZATION_VERSION,
    document_localization,
    format_document_value,
)
from app.reference.engine import load


class DocumentLocalizationTests(unittest.TestCase):
    def test_every_declared_form_field_and_table_column_has_a_display_label(self):
        schemas = load("forms/form_data_schemas_v1.json")["forms"]
        templates = {
            item["id"]: item
            for item in load("forms/form_templates_v1.json")["templates"]
        }
        self.assertEqual(set(schemas), set(templates))
        for form_id, schema in schemas.items():
            expected_fields = set(schema["scalar_fields"])
            expected_table_keys = [
                (table["path"], table["columns"]) for table in schema["tables"]
            ]
            for table in schema["tables"]:
                expected_fields.update(f"{table['path']}.{column}" for column in table["columns"])
            catalogs = [document_localization(form_id, language) for language in ("ko", "vi", "en")]
            for catalog in catalogs:
                with self.subTest(form_id=form_id, language=catalog["language"]):
                    self.assertEqual(set(catalog["fields"]), expected_fields)
                    self.assertTrue(all(label.strip() for label in catalog["fields"].values()))
                    self.assertTrue(all(path != label for path, label in catalog["fields"].items()))
                    self.assertEqual(catalog["fallbackFields"], [])
                    self.assertEqual(catalog["version"], DOCUMENT_LOCALIZATION_VERSION)
                    self.assertEqual(
                        catalog["reviewStatus"],
                        "approved_master" if catalog["language"] == "ko" else "draft_pending_local_review",
                    )
                    self.assertRegex(catalog["sha256"], r"^[a-f0-9]{64}$")
                actual_table_keys = [
                    (table["path"], [column["key"] for column in table["columns"]])
                    for table in catalog["tables"]
                ]
                self.assertEqual(actual_table_keys, expected_table_keys)
            self.assertEqual(
                catalogs[0]["fields"].keys(),
                catalogs[1]["fields"].keys(),
            )
            self.assertEqual(
                catalogs[0]["fields"].keys(),
                catalogs[2]["fields"].keys(),
            )

    def test_catalog_hash_is_stable_and_locale_specific(self):
        first = document_localization("FM-20", "en")
        second = document_localization("FM-20", "en-US")
        vietnamese = document_localization("FM-20", "vi-VN")
        self.assertEqual(first, second)
        self.assertNotEqual(first["sha256"], vietnamese["sha256"])
        self.assertEqual(first["fields"].keys(), vietnamese["fields"].keys())

    def test_output_formatting_changes_display_only_and_preserves_decimal_precision(self):
        source_date = "2026-05-06T14:30:00+07:00"
        source_amount = "12345678901234567890.123400"
        self.assertEqual(format_document_value(source_date, "vi", "date-time"), "14:30 06/05/2026")
        self.assertEqual(format_document_value(source_date, "en", "date-time"), "05/06/2026 02:30 PM")
        self.assertEqual(
            format_document_value(source_amount, "vi", field_path="payment.claimed_amount", currency="VND"),
            "12.345.678.901.234.567.890,1234 VND",
        )
        self.assertEqual(source_date, "2026-05-06T14:30:00+07:00")
        self.assertEqual(source_amount, "12345678901234567890.123400")

    def test_unknown_forms_and_languages_are_rejected(self):
        with self.assertRaises(KeyError):
            document_localization("FM-99", "en")
        with self.assertRaises(ValueError):
            document_localization("FM-20", "fr")


if __name__ == "__main__":
    unittest.main()
