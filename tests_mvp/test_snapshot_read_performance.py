"""Regression coverage for snapshot reads avoiding a second full-state copy."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from services.api.store import SQLiteSnapshotAdapter


class SnapshotReadTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="snapshot-read-")
        self.path = str(Path(self.temp.name) / "state.sqlite3")
        self.store = SQLiteSnapshotAdapter(self.path, demo=True)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_successful_read_does_not_export_or_deepcopy_a_second_snapshot(self):
        with self.store.transaction(write=True):
            self.store.requests["seed"] = {
                "hash": "stable",
                "result": {"value": "visible"},
            }

        with patch.object(self.store, "export_state", side_effect=AssertionError("read exported snapshot")):
            with self.store.transaction():
                self.assertEqual(
                    self.store.requests["seed"]["result"]["value"], "visible"
                )

    def test_read_exception_restores_all_snapshot_memory_from_committed_payload(self):
        with self.store.transaction(write=True):
            self.store.requests["stable"] = {
                "hash": "committed",
                "result": {"value": "before"},
            }
            self.store.engine._audit.append({"event": "committed-audit"})
            self.store.engine._history[("Issue", "known")] = [
                {"version": 1, "status": "open"},
            ]

        with self.store.transaction():
            baseline = deepcopy(self.store.export_state())

        with self.assertRaisesRegex(RuntimeError, "abort read"):
            with self.store.transaction():
                self.store.requests["stable"]["result"]["value"] = "transient"
                self.store.requests["transient"] = {"hash": "bad", "result": {}}
                self.store.engine._audit.append({"event": "transient-audit"})
                self.store.engine._history[("Issue", "known")].append(
                    {"version": 2, "status": "closed"}
                )
                raise RuntimeError("abort read")

        with self.store.transaction():
            self.assertEqual(self.store.requests["stable"]["result"]["value"], "before")
            self.assertNotIn("transient", self.store.requests)
            self.assertEqual(self.store.engine._audit, baseline["audit"])
            self.assertEqual(
                self.store.engine._history[("Issue", "known")],
                [{"version": 1, "status": "open"}],
            )

    def test_second_adapter_observes_committed_writes_after_its_next_read(self):
        second = SQLiteSnapshotAdapter(self.path, demo=True)
        try:
            with self.store.transaction(write=True):
                self.store.requests["cross-instance"] = {
                    "hash": "cross-instance",
                    "result": {"visible": True},
                }
            with second.transaction():
                self.assertTrue(
                    second.requests["cross-instance"]["result"]["visible"]
                )
        finally:
            second.close()


if __name__ == "__main__":
    unittest.main()
