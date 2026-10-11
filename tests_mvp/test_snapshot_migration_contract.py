"""Snapshot normalization preflight: preservation, scope, audit and determinism."""
from copy import deepcopy
from pathlib import Path
import unittest

from services.api.snapshot_migration import (
    SnapshotMigrationError, snapshot_record_versions, snapshot_preflight_summary,
)


def snap(*, current=None, history=None):
    oldest = {"id": "INSP-001", "projectId": "SITE-A", "version": 1,
              "subtype": "IncomingInspection", "status": "requested", "note": "검측"}
    newest = {**oldest, "version": 2, "status": "passed"}
    project = {"id": "SITE-A", "version": 1, "status": "active"}
    other = {"id": "ISSUE-002", "projectId": "SITE-B", "version": 1,
             "subtype": "NCR", "status": "open"}
    current = current if current is not None else [
        [["Inspection", "INSP-001"], newest],
        [["Project", "SITE-A"], project],
        [["Issue", "ISSUE-002"], other],
    ]
    history = history if history is not None else [
        [["Inspection", "INSP-001", 1], oldest],
        [["Inspection", "INSP-001", 2], newest],
        [["Project", "SITE-A", 1], project],
        [["Issue", "ISSUE-002", 1], other],
    ]
    return {"format": 1, "engine": {"_records": current, "_history": history}}


class SnapshotNormalizationPreflightTests(unittest.TestCase):
    def test_all_versions_scoped_and_deterministic(self):
        original = snap()
        untouched = deepcopy(original)
        rows = snapshot_record_versions(original)
        self.assertEqual(len(rows), 4)
        self.assertEqual(len([r for r in rows if r.object_id == "INSP-001"]), 2)
        self.assertEqual({r.project_id for r in rows}, {"SITE-A", "SITE-B"})
        self.assertEqual(len({r.payload_sha256 for r in rows}), 4)
        summary = snapshot_preflight_summary(original)
        self.assertEqual(summary["record_versions"], 4)
        self.assertEqual(summary["distinct_records"], 3)
        self.assertEqual(summary["project_version_counts"], {"SITE-A": 3, "SITE-B": 1})
        self.assertFalse(summary["runtime_storage_switched"])
        self.assertEqual(original, untouched)
        self.assertEqual(summary, snapshot_preflight_summary(original))

    def test_input_order_does_not_change_manifest(self):
        a = snap()
        b = snap(current=list(reversed(a["engine"]["_records"])),
                 history=list(reversed(a["engine"]["_history"])))
        self.assertEqual(snapshot_preflight_summary(a)["manifest_sha256"],
                         snapshot_preflight_summary(b)["manifest_sha256"])

    def test_current_history_payload_mismatch_is_rejected(self):
        x = snap()
        x["engine"]["_records"][0][1]["note"] = "changed without a new version"
        with self.assertRaisesRegex(SnapshotMigrationError, "disagrees with history"):
            snapshot_record_versions(x)

    def test_missing_history_version_is_rejected(self):
        x = snap()
        x["engine"]["_history"] = [entry for entry in x["engine"]["_history"]
                                  if entry[0] != ["Inspection", "INSP-001", 2]]
        with self.assertRaisesRegex(SnapshotMigrationError, "not in history"):
            snapshot_record_versions(x)

    def test_duplicate_version_is_rejected(self):
        x = snap()
        x["engine"]["_history"].append(deepcopy(x["engine"]["_history"][0]))
        with self.assertRaisesRegex(SnapshotMigrationError, "duplicate record"):
            snapshot_record_versions(x)

    def test_unrelated_project_scope_is_rejected(self):
        x = snap()
        x["engine"]["_history"][0][1]["projectId"] = "SITE-C"
        with self.assertRaisesRegex(SnapshotMigrationError, "reused across projects"):
            snapshot_record_versions(x)

    def test_tampered_id_is_rejected(self):
        x = snap()
        x["engine"]["_history"][0][1]["id"] = "WRONG"
        with self.assertRaisesRegex(SnapshotMigrationError, "identity/version mismatch"):
            snapshot_record_versions(x)

    def test_bad_current_version_and_unknown_format_are_rejected(self):
        x = snap()
        x["engine"]["_records"][0][1]["version"] = 0
        with self.assertRaisesRegex(SnapshotMigrationError, "identity/version mismatch"):
            snapshot_record_versions(x)
        x = snap()
        x["format"] = 2
        with self.assertRaisesRegex(SnapshotMigrationError, "Unsupported snapshot format"):
            snapshot_record_versions(x)

    def test_shadow_schema_is_append_only_and_project_scoped(self):
        root = Path(__file__).resolve().parents[1]
        sql = (root / "infra/db/migrations/002_shadow_record_versions.sql").read_text("utf-8")
        for required in (
            "PRIMARY KEY (project_id, object_type, object_id, version)",
            "BEFORE UPDATE OR DELETE",
            "CREATE INDEX IF NOT EXISTS doul_shadow_record_latest_lookup",
            "record_json JSONB NOT NULL",
        ):
            self.assertIn(required, sql)


if __name__ == "__main__":
    unittest.main()
