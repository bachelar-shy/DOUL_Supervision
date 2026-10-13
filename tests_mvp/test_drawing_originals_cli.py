"""Original drawing E2E audit runner must be read-only and source-identity exact."""
import unittest

from scripts.verify_drawing_originals import (
    APIReader, CatalogQAError, check_images, inspect_catalog,
    parse_manifest, require_safe_api_url, valid_jpeg,
)


PDF_A = {"fileName": "architecture.pdf", "sha256": "a" * 64,
         "pages": 3, "expectEvidenceReuse": True}
PDF_B = {"fileName": "mechanical.pdf", "sha256": "b" * 64,
         "pages": 2, "expectEvidenceReuse": False}


def fixture():
    sets = [
        {"id": "a", "fileName": PDF_A["fileName"], "sha256": PDF_A["sha256"],
         "pageCount": 3, "completedPages": 3, "status": "ready",
         "sourceEvidenceId": "source-evidence-id"},
        {"id": "b", "fileName": PDF_B["fileName"], "sha256": PDF_B["sha256"],
         "pageCount": 2, "completedPages": 2, "status": "ready"},
        {"id": "synthetic", "fileName": "SYNTHETIC-8.pdf", "sha256": "c" * 64,
         "pageCount": 8, "completedPages": 8, "status": "ready"}
    ]
    sheets = []
    for set_id, count in (("a", 3), ("b", 2), ("synthetic", 8)):
        for n in range(1, count + 1):
            sheets.append({
                "id": set_id + str(n), "setId": set_id, "pageNo": n,
                "number": f"Sheet-{n:03d}", "title": "Needs titleblock review",
                "extractedNumber": "A-01" if set_id == "a" else None,
                "extractedTitle": "Original title" if set_id == "a" else None,
                "metadataReview": {"status": "verified"} if set_id == "a" and n == 1 else None,
                "status": "ready", "hasThumb": True, "hasPreview": True
            })
    return sets, sheets


class DrawingOriginalQATests(unittest.TestCase):
    def test_198_style_aggregate_does_not_confuse_other_registered_sheets(self):
        groups, sheets = fixture()
        report = inspect_catalog(groups, sheets, [PDF_A, PDF_B])
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["selectedPages"], 5)
        self.assertEqual(report["otherRegisteredPages"], 8)
        self.assertEqual([g["actualPages"] for g in report["sources"]], [3, 2])
        self.assertEqual(report["sources"][0]["humanVerified"], 1)
        self.assertEqual(report["sources"][0]["numberCandidates"], 3)
        self.assertEqual(report["sources"][1]["humanVerified"], 0)
        self.assertEqual(report["sources"][0]["duplicateNumberCandidates"], ["A-01"])

    def test_missing_page_and_missing_preview_are_blocking(self):
        groups, sheets = fixture()
        sheets[:] = [s for s in sheets if s["id"] != "a2"]
        sheets[0]["hasPreview"] = False
        report = inspect_catalog(groups, sheets, [PDF_A, PDF_B])
        self.assertTrue(any("Page identity mismatch" in e for e in report["errors"]))
        self.assertTrue(any("Missing ready image" in e for e in report["errors"]))
        self.assertTrue(any("total mismatch" in e for e in report["errors"]))

    def test_sha_and_file_name_must_match_exact_source(self):
        groups, sheets = fixture()
        groups[0]["sha256"] = "0" * 64
        report = inspect_catalog(groups, sheets, [PDF_A, PDF_B])
        self.assertTrue(any("Source identity ambiguity" in e for e in report["errors"]))

    def test_expected_evidence_reuse_blocks_an_unlinked_duplicate(self):
        groups, sheets = fixture()
        groups[0]["sourceEvidenceId"] = None
        report = inspect_catalog(groups, sheets, [PDF_A, PDF_B])
        self.assertTrue(any("Evidence was not linked" in e for e in report["errors"]))

    def test_manifest_rejects_duplicate_sources_and_unsafe_pages(self):
        with self.assertRaises(CatalogQAError):
            parse_manifest({"projectId": "abc", "sources": [PDF_A, PDF_A]})
        with self.assertRaises(CatalogQAError):
            parse_manifest({"projectId": "abc", "sources": [{**PDF_A, "pages": 0}]})
        with self.assertRaises(CatalogQAError):
            parse_manifest({"projectId": "abc", "sources": [{**PDF_A, "sha256": "X" * 64}]})
        with self.assertRaises(CatalogQAError):
            parse_manifest({"projectId": "../project", "sources": [PDF_A]})
        project, items = parse_manifest({"projectId": "safe-pid", "sources": [PDF_A]})
        self.assertEqual(project, "safe-pid")
        self.assertEqual(len(items), 1)

    def test_download_signature_limits_and_mime(self):
        valid = b"\xff\xd8\xff" + b"x" * 1002 + b"\xff\xd9"
        self.assertTrue(valid_jpeg(valid, "image/jpeg"))
        self.assertTrue(valid_jpeg(valid, "image/jpeg; charset=binary"))
        self.assertFalse(valid_jpeg(valid, "application/pdf"))
        self.assertFalse(valid_jpeg(b"%PDF-1.5", "image/jpeg"))
        self.assertFalse(valid_jpeg(b"\xff\xd8\xff", "image/jpeg"))

    def test_api_url_security(self):
        self.assertEqual(require_safe_api_url("http://127.0.0.1:8795/"), "http://127.0.0.1:8795")
        self.assertEqual(require_safe_api_url("https://staging.example/api"),
                         "https://staging.example/api")
        for url in ("http://staging.example", "https://user:pass@staging.example",
                    "https://staging.example/?token=bad", "ftp://host/path"):
            with self.assertRaises(CatalogQAError):
                require_safe_api_url(url)
        with self.assertRaises(CatalogQAError):
            APIReader("https://example.test", "", None)

    def test_two_images_per_selected_page_with_bounded_executor(self):
        groups, sheets = fixture()
        catalog = inspect_catalog(groups, sheets, [PDF_A, PDF_B])
        jpeg = b"\xff\xd8\xff" + b"x" * 1002 + b"\xff\xd9"

        class FakeReader:
            def fetch(self, route, limit=0):
                self_routes.append(route)
                return jpeg, "image/jpeg"

        self_routes = []
        result = check_images(FakeReader(), "project-id", catalog["sources"], workers=3)
        self.assertEqual(result["requested"], 10)
        self.assertEqual(result["passed"], 10)
        self.assertEqual(result["failures"], [])
        self.assertEqual(len(set(self_routes)), 10)
        self.assertTrue(all(route.startswith("/projects/project-id/drawing-sheets/")
                            for route in self_routes))
        self.assertEqual(sum("size=thumb" in route for route in self_routes), 5)
        self.assertEqual(sum("size=preview" in route for route in self_routes), 5)


if __name__ == "__main__":
    unittest.main()
