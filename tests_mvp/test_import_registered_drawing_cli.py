"""Import operator cannot link the wrong PDF or mutate data in dry-run mode."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.import_registered_drawing import (
    CatalogQAError, check_existing, import_one, read_manifest, verify_workspace_evidence,
)


ORIGINAL = {
    "projectId": "project-198", "evidenceId": "original-architecture",
    "version": 2, "fileName": "architecture.pdf", "sha256": "a" * 64,
    "pages": 145, "size": 56_000_000,
}


def workspace(row=ORIGINAL):
    return {"project": {"id": row["projectId"]}, "items": [{
        "machine": "evidence", "record": {
            "id": row["evidenceId"], "projectId": row["projectId"],
            "version": row["version"], "fileHash": row["sha256"],
            "sourceType": "original", "mediaType": "document",
            "metadata": {"name": row["fileName"], "mimeType": "application/pdf",
                         "byteCount": row["size"]},
        },
    }]}


def registered_set(status="ready", completed=145):
    return {
        "id": "sheet-set-id", "fileName": ORIGINAL["fileName"],
        "sourceEvidenceId": ORIGINAL["evidenceId"], "sha256": ORIGINAL["sha256"],
        "pageCount": 145, "size": ORIGINAL["size"],
        "completedPages": completed, "status": status,
    }


class FakeAPI:
    def __init__(self, *, existing=False, status="ready"):
        self.existing = existing
        self.status = status
        self.calls = []

    def json(self, method, route, payload=None, idem=None):
        self.calls.append((method, route, payload, idem))
        if route.endswith("/workspace"):
            return workspace()
        if route.endswith("/drawing-sets"):
            return {"items": [registered_set(status=self.status)] if self.existing else []}
        if route.endswith("/drawing-sets/from-evidence"):
            self.existing = True
            return {"set": registered_set(status=self.status)}
        if route.endswith("/drawing-sets/sheet-set-id"):
            return {"set": registered_set(status=self.status)}
        if route.endswith("/drawing-sheets"):
            return {"items": [{
                "id": "sheet-" + str(page), "setId": "sheet-set-id",
                "pageNo": page, "status": "ready", "hasPreview": True,
                "hasThumb": True,
            } for page in range(1, 146)]}
        raise AssertionError(route)


class RegisteredDrawingOperatorTests(unittest.TestCase):
    def test_manifest_145_page_source_must_identify_exact_existing_evidence(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "private.json"
            path.write_text(json.dumps(ORIGINAL), encoding="utf-8")
            self.assertEqual(read_manifest(path), ORIGINAL)
            for update in ({"pages": 151}, {"size": 65 * 1024 * 1024},
                           {"sha256": "not-a-hash"}, {"version": True},
                           {"fileName": "../incorrect.pdf"}):
                path.write_text(json.dumps({**ORIGINAL, **update}), encoding="utf-8")
                with self.assertRaises(CatalogQAError):
                    read_manifest(path)

    def test_dry_run_never_creates_a_drawing_index(self):
        fake = FakeAPI(existing=False)
        result = import_one(fake, ORIGINAL, apply=False)
        self.assertEqual(result["result"], "verified_dry_run")
        self.assertEqual(len([c for c in fake.calls if c[0] == "POST"]), 0)

    def test_existing_145_pages_and_new_import_have_same_verified_result(self):
        for existing in (True, False):
            with self.subTest(existing=existing):
                fake = FakeAPI(existing=existing)
                result = import_one(fake, ORIGINAL, apply=True, timeout_seconds=1)
                self.assertEqual(result["result"], "ready")
                self.assertEqual(result["pages"], 145)
                self.assertEqual(result["sha256"], ORIGINAL["sha256"])
                posts = [c for c in fake.calls if c[0] == "POST"]
                self.assertEqual(len(posts), 0 if existing else 1)
                if posts:
                    self.assertEqual(posts[0][2], {"evidenceRef": {
                        "objectType": "Evidence", "objectId": ORIGINAL["evidenceId"], "version": 2,
                    }})
                    self.assertIsInstance(posts[0][3], str)

    def test_current_evidence_and_exact_hash_are_required(self):
        for key, bad in (("fileHash", "b" * 64), ("version", 1),
                         ("projectId", "another-project"), ("sourceType", "generated")):
            with self.subTest(field=key):
                obj = workspace()
                obj["items"][0]["record"][key] = bad
                with self.assertRaises(CatalogQAError):
                    verify_workspace_evidence(obj, ORIGINAL)
        with self.assertRaises(CatalogQAError):
            verify_workspace_evidence({"project": {"id": "project-198"}, "items": []}, ORIGINAL)

    def test_existing_mismatched_evidence_hash_must_abort(self):
        with self.assertRaises(CatalogQAError):
            check_existing([{**registered_set(), "sha256": "c" * 64}], ORIGINAL)
        with self.assertRaises(CatalogQAError):
            check_existing([registered_set(), registered_set()], ORIGINAL)

    def test_failure_does_not_post_duplicate_upload(self):
        fake = FakeAPI(existing=True, status="failed")
        with self.assertRaises(CatalogQAError):
            import_one(fake, ORIGINAL, apply=True, timeout_seconds=1)
        self.assertEqual(len([c for c in fake.calls if c[0] == "POST"]), 0)


if __name__ == "__main__":
    unittest.main()
