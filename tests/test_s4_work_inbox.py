import unittest
from copy import deepcopy

from app.reference.validation import ContractError
from services.api.modules.work_inbox import (
    InboxCursorError,
    build_work_inbox,
)


PROJECT = "project-1"
SESSION = {"partyId": "actor-sup"}
ROLE = {
    "id": "role-sup",
    "projectId": PROJECT,
    "active": True,
    "actorGroup": "SUP",
}


class StubEngine:
    def __init__(self, rows):
        self._records = {}
        self._record_machines = {}
        for kind, machine, record in rows:
            key = (kind, record["id"])
            self._records[key] = deepcopy(record)
            self._record_machines[key] = machine

    def get(self, kind, object_id):
        return deepcopy(self._records[(kind, object_id)])


def record(object_id, *, project=PROJECT, readers=("SUP",), commands=("SUP",), updated="2026-10-07T08:00:00Z"):
    return {
        "id": object_id,
        "projectId": project,
        "version": 3,
        "status": "under_review",
        "updatedAt": updated,
        "readers": list(readers),
        "commandRoles": list(commands),
    }


def readable(item, session, role):
    if role["actorGroup"] not in item["readers"]:
        raise ContractError("NOT_AUTHORIZED", "Record is not visible")


def preflight(machine, item, session, role):
    if role["actorGroup"] not in item["commandRoles"]:
        return []
    return [
        {
            "command": f"{machine}.review",
            "expectedVersion": item["version"],
            "ready": True,
        }
    ]


def build(engine, role=ROLE, **kwargs):
    return build_work_inbox(
        engine,
        PROJECT,
        SESSION,
        role,
        readable=readable,
        preflight=preflight,
        **kwargs,
    )


class WorkInboxProjectionTests(unittest.TestCase):
    def test_projects_only_authorized_relevant_records_with_existing_commands(self):
        rows = [
            ("Inspection", "inspection", record("inspection-1")),
            ("Issue", "issue", record("issue-1")),
            ("Action", "action", record("action-1", commands=("CON",))),
            ("InformationItem", "report", record("report-1")),
            ("Decision", "decision", record("decision-1", readers=("OWN",))),
            ("SafetyPermit", "safety_permit", record("permit-1")),
            ("SafetyStopOrder", "safety_stop_order", record("stop-1")),
            ("EquipmentInspection", "safety_equipment_inspection", record("equipment-1")),
            ("RFI", "rfi", record("rfi-1")),
            ("Issue", "issue", record("other-project", project="project-2")),
        ]
        result = build(StubEngine(rows))

        self.assertEqual(
            [item["record"]["id"] for item in result["records"]],
            [
                "equipment-1",
                "inspection-1",
                "issue-1",
                "permit-1",
                "report-1",
                "stop-1",
            ],
        )
        self.assertEqual(result["total"], 6)
        self.assertTrue(all(item["commandCandidates"] for item in result["records"]))
        self.assertEqual(result["projectId"], PROJECT)
        self.assertEqual(result["roleAssignmentId"], ROLE["id"])

    def test_engine_read_scope_denials_are_hidden_but_contract_errors_surface(self):
        denial_codes = {
            "not-found": "NOT_FOUND",
            "not-authorized": "NOT_AUTHORIZED",
            "out-of-scope": "SCOPE_MISMATCH",
            "other-organization": "ORGANIZATION_MISMATCH",
            "unqualified": "QUALIFICATION_INVALID",
        }
        denial_rows = [("Issue", "issue", record(object_id)) for object_id in denial_codes]
        rows = [*denial_rows, ("Issue", "issue", record("broken"))]

        def readable_with_engine_errors(item, session, role):
            code = denial_codes.get(item["id"])
            if code:
                raise ContractError(code, "Engine denied record visibility")
            raise ContractError("QUALIFICATION_RULE_MISSING", "Project rules are incomplete")

        denied = build_work_inbox(
            StubEngine(denial_rows),
            PROJECT,
            SESSION,
            ROLE,
            readable=readable_with_engine_errors,
            preflight=preflight,
        )
        self.assertEqual(denied["records"], [])

        with self.assertRaisesRegex(ContractError, "Project rules are incomplete"):
            build_work_inbox(
                StubEngine(rows),
                PROJECT,
                SESSION,
                ROLE,
                readable=readable_with_engine_errors,
                preflight=preflight,
            )

    def test_role_scope_uses_authoritative_preflight_and_preserves_action_details(self):
        rows = [
            ("Inspection", "inspection", record("inspection-sup")),
            ("Inspection", "inspection", record("inspection-own", readers=("OWN",), commands=("OWN",))),
        ]
        result = build(StubEngine(rows))
        self.assertEqual([x["record"]["id"] for x in result["records"]], ["inspection-sup"])
        self.assertEqual(
            result["records"][0]["commandCandidates"],
            [{"command": "inspection.review", "expectedVersion": 3, "ready": True}],
        )

    def test_cursor_paginates_deterministically_and_total_is_for_full_match(self):
        rows = [
            ("Issue", "issue", record("issue-c")),
            ("Issue", "issue", record("issue-a")),
            ("Issue", "issue", record("issue-b")),
        ]
        engine = StubEngine(rows)

        first = build(engine, limit=2)
        second = build(engine, limit=2, cursor=first["nextCursor"])

        self.assertEqual([x["record"]["id"] for x in first["records"]], ["issue-a", "issue-b"])
        self.assertEqual([x["record"]["id"] for x in second["records"]], ["issue-c"])
        self.assertEqual(first["total"], 3)
        self.assertEqual(second["total"], 3)
        self.assertIsNotNone(first["nextCursor"])
        self.assertIsNone(second["nextCursor"])

    def test_page_size_is_bounded_and_boolean_is_not_accepted_as_integer(self):
        engine = StubEngine([("Issue", "issue", record("issue-1"))])
        for value in (0, -1, 101, True, 1.5):
            with self.subTest(limit=value), self.assertRaises(ValueError):
                build(engine, limit=value)

    def test_inactive_or_wrong_project_role_is_rejected(self):
        engine = StubEngine([])
        for role in (
            {**ROLE, "active": False},
            {**ROLE, "projectId": "project-2"},
        ):
            with self.subTest(role=role), self.assertRaises(ValueError):
                build(engine, role=role)

    def test_malformed_cursor_is_rejected(self):
        with self.assertRaises(InboxCursorError):
            build(StubEngine([]), cursor="not-a-valid-cursor")

    def test_empty_page_has_no_cursor_and_valid_default_limit(self):
        result = build(StubEngine([]))
        self.assertEqual(result["records"], [])
        self.assertEqual(result["limit"], 50)
        self.assertEqual(result["total"], 0)
        self.assertIsNone(result["nextCursor"])


if __name__ == "__main__":
    unittest.main()
