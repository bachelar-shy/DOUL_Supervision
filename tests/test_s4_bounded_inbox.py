"""Page-bounded work inbox reads, guard isolation and live keyset semantics."""
from copy import deepcopy
import unittest
from unittest.mock import Mock, patch

from app.reference.engine import Engine
from app.reference.validation import ContractError
from services.api.modules.work_inbox import build_work_inbox
from test_s4_work_inbox import PROJECT, SESSION, ROLE, StubEngine, record, readable, preflight


class WorkInboxBoundedTests(unittest.TestCase):
    def make_engine(self, count=3500):
        rows = [("Issue", "issue", {**record(f"issue-{i:06}"),
                "data": {"checks": [{"values": list(range(64))}]}}) for i in range(count)]
        engine = StubEngine(rows)
        engine.get = Mock(wraps=engine.get)
        return engine

    def build(self, engine, **kwargs):
        return build_work_inbox(engine, PROJECT, SESSION, ROLE, readable=readable, preflight=preflight, **kwargs)

    def test_3500_records_limit_one_gets_and_preflights_only_page(self):
        engine = self.make_engine()
        calls = []
        def counted(machine, item, session, role):
            calls.append(item["id"])
            return preflight(machine, item, session, role)
        result = build_work_inbox(engine, PROJECT, SESSION, ROLE, readable=readable,
            preflight=counted, has_candidates=lambda *args: True, limit=1)
        self.assertEqual(result["total"], 3500)
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(engine.get.call_count, 1)
        self.assertEqual(calls, ["issue-000000"])
        self.assertIsNotNone(result["nextCursor"])
        result["records"][0]["record"]["data"]["checks"][0]["values"].clear()
        self.assertEqual(len(engine._records[("Issue", "issue-000000")]["data"]["checks"][0]["values"]), 64)

    def test_compatibility_callback_retains_membership_without_copying_every_record(self):
        engine = self.make_engine()
        result = self.build(engine, limit=1)
        self.assertEqual(result["total"], 3500)
        self.assertEqual(engine.get.call_count, 1)

    def test_guards_cannot_mutate_nested_authoritative_records(self):
        engine = self.make_engine(1)
        def mutate(item, session, role):
            item["data"]["checks"][0]["values"][0] = -1
        with self.assertRaises(TypeError):
            build_work_inbox(engine, PROJECT, SESSION, ROLE, readable=mutate, preflight=preflight)
        self.assertEqual(engine._records[("Issue", "issue-000000")]["data"]["checks"][0]["values"][0], 0)

    def test_index_query_adapter_does_not_require_access_to_whole_record_map(self):
        engine = self.make_engine(1)
        row = engine._records[("Issue", "issue-000000")]
        class QueryAdapter:
            def iter_work_inbox_records(self, project_id, machines):
                from app.reference.read_views import readonly
                yield "Issue", row["id"], "issue", readonly(row)
                yield "Issue", "foreign", "issue", readonly(record("foreign", project="other"))
            def get(self, kind, object_id):
                return deepcopy(row)
        result = self.build(QueryAdapter(), limit=1, has_candidates=lambda *args: True)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["records"][0]["record"]["id"], row["id"])

    def test_derived_current_equipment_view_matches_detached_engine_read(self):
        engine = Engine()
        raw = {**record("equipment"), "subtype": "SafetyEquipmentInspection",
               "data": {"equipmentAvailable": True, "nested": [{"original": True}]}}
        engine._records[("WorkItem", "equipment")] = raw
        engine._record_machines[("WorkItem", "equipment")] = "safety_equipment_inspection"
        engine._equipment_documents_current = lambda value: False
        view = next(engine.iter_work_inbox_records(PROJECT, {"safety_equipment_inspection"}))[3]
        self.assertEqual(view, engine.get("WorkItem", "equipment"))
        self.assertFalse(view["data"]["equipmentAvailable"])
        self.assertTrue(raw["data"]["equipmentAvailable"])

    def test_changed_version_inside_projection_requires_restart(self):
        engine = self.make_engine(2)
        def membership(machine, item, session, role):
            if item["id"] == "issue-000001":
                engine._records[("Issue", "issue-000000")]["version"] += 1
            return True
        with self.assertRaises(ContractError) as raised:
            self.build(engine, limit=1, has_candidates=membership)
        self.assertEqual(raised.exception.code, "VERSION_CONFLICT")

    def test_page_authorization_is_rechecked_before_returning_current_record(self):
        engine = self.make_engine(2)
        calls = 0
        def guard(item, session, role):
            nonlocal calls
            calls += 1
            if calls > 2:
                raise ContractError("NOT_AUTHORIZED", "Role changed")
        with self.assertRaises(ContractError):
            build_work_inbox(engine, PROJECT, SESSION, ROLE, readable=guard,
                preflight=preflight, has_candidates=lambda *args: True, limit=1)
        self.assertEqual(engine.get.call_count, 1)

    def test_live_cursor_is_not_a_frozen_snapshot_and_refresh_sees_moved_record(self):
        engine = StubEngine([
            ("Issue", "issue", record("a", updated="2026-10-07T10:00:00Z")),
            ("Issue", "issue", record("b", updated="2026-10-07T09:00:00Z")),
            ("Issue", "issue", record("c", updated="2026-10-07T08:00:00Z")),
        ])
        first = self.build(engine, limit=1, has_candidates=lambda *args: True)
        engine._records[("Issue", "b")].update(updatedAt="2026-10-07T11:00:00Z", version=4)
        second = self.build(engine, limit=1, cursor=first["nextCursor"], has_candidates=lambda *args: True)
        self.assertEqual(second["records"][0]["record"]["id"], "c")
        refreshed = self.build(engine, limit=1, has_candidates=lambda *args: True)
        self.assertEqual(refreshed["records"][0]["record"]["id"], "b")
        self.assertEqual(refreshed["records"][0]["commandCandidates"][0]["expectedVersion"], 4)
        self.assertEqual(second["total"], 3)

if __name__ == "__main__":
    unittest.main()
