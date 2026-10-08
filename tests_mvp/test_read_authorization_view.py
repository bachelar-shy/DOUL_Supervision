"""Read authorization view must preserve Engine decisions exactly."""
from datetime import datetime
import unittest

from app.reference.engine import Engine
from app.reference.validation import ContractError
from services.api.demo import seed
from services.api.modules.read_authorization import ReadAuthorizationView


def outcome(call):
    try:
        value = call()
        return ("ok", value)
    except ContractError as exc:
        return ("error", exc.code, str(exc))


class ReadAuthorizationViewTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.meta = seed(self.engine)
        self.view = ReadAuthorizationView(self.engine)

    def test_engine_and_request_view_have_identical_read_and_authority_results(self):
        for group, actor in self.meta["actors"].items():
            role_id = actor["roleAssignmentId"]
            for (kind, object_id), machine in self.engine._record_machines.items():
                if machine not in {
                    "inspection", "issue", "action", "report", "decision",
                    "safety_permit", "safety_stop_order", "safety_equipment_inspection",
                }:
                    continue
                record = self.engine.get(kind, object_id)
                with self.subTest(group=group, kind=kind, object_id=object_id, check="read"):
                    self.assertEqual(
                        outcome(lambda: self.engine.authorize_read(record, actor["partyId"], role_id)),
                        outcome(lambda: self.view.authorize_read(record, actor["partyId"], role_id)),
                    )
                for transition in self.engine.machines[machine]["transitions"]:
                    authority = transition["authority"]
                    with self.subTest(group=group, kind=kind, object_id=object_id, authority=authority):
                        self.assertEqual(
                            outcome(lambda: self.engine.authorize(record, authority, actor["partyId"], role_id)),
                            outcome(lambda: self.view.authorize(record, authority, actor["partyId"], role_id)),
                        )

    def test_cached_configuration_is_recursively_immutable(self):
        role_id = self.meta["actors"]["SUP"]["roleAssignmentId"]
        role = self.view.get("RoleAssignment", role_id)
        with self.assertRaises(TypeError):
            role["active"] = False
        with self.assertRaises((AttributeError, TypeError)):
            role["authorityCodes"].append("administer")
        self.assertTrue(self.engine.get("RoleAssignment", role_id)["active"])

    def test_assignment_expiry_is_rechecked_after_role_lookup_is_cached(self):
        role_id = self.meta["actors"]["SUP"]["roleAssignmentId"]
        actor = self.meta["actors"]["SUP"]
        record = next(
            self.engine.get(kind, object_id)
            for (kind, object_id), machine in self.engine._record_machines.items()
            if machine == "issue"
        )
        role = self.engine.get("RoleAssignment", role_id)
        self.assertEqual(
            outcome(lambda: self.view.authorize(record, "render_document", actor["partyId"], role_id))[0],
            "ok",
        )
        self.engine.now = lambda: datetime.fromisoformat(role["validTo"].replace("Z", "+00:00"))
        expired = outcome(
            lambda: self.view.authorize(record, "render_document", actor["partyId"], role_id)
        )
        self.assertEqual(expired[0:2], ("error", "ASSIGNMENT_EXPIRED"))

    def test_missing_or_revoked_qualification_is_not_cached_as_authorized(self):
        actor = self.meta["actors"]["SUP"]
        role_id = actor["roleAssignmentId"]
        role_record = self.engine._records[("RoleAssignment", role_id)]
        role_record["qualificationIds"] = []
        issue = next(
            self.engine.get(kind, object_id)
            for (kind, object_id), machine in self.engine._record_machines.items()
            if machine == "inspection"
        )
        missing_view = ReadAuthorizationView(self.engine)
        for check in (
            lambda: self.engine.authorize(issue, "perform_official_inspection", actor["partyId"], role_id),
            lambda: missing_view.authorize(issue, "perform_official_inspection", actor["partyId"], role_id),
        ):
            self.assertEqual(outcome(check)[0:2], ("error", "QUALIFICATION_INVALID"))

        qualification = next(
            record for (kind, _), record in self.engine._records.items()
            if kind == "Qualification" and record["partyId"] == actor["partyId"]
        )
        role_record["qualificationIds"] = [qualification["id"]]
        qualification["revoked"] = True
        revoked_view = ReadAuthorizationView(self.engine)
        self.assertEqual(
            outcome(lambda: self.engine.authorize(issue, "perform_official_inspection", actor["partyId"], role_id))[0:2],
            outcome(lambda: revoked_view.authorize(issue, "perform_official_inspection", actor["partyId"], role_id))[0:2],
        )
        self.assertEqual(
            outcome(lambda: revoked_view.authorize(issue, "perform_official_inspection", actor["partyId"], role_id))[0:2],
            ("error", "QUALIFICATION_INVALID"),
        )

    def test_new_request_view_reads_current_role_after_assignment_change(self):
        actor = self.meta["actors"]["SUP"]
        role_id = actor["roleAssignmentId"]
        issue = next(
            self.engine.get(kind, object_id)
            for (kind, object_id), machine in self.engine._record_machines.items()
            if machine == "issue"
        )
        first_view = ReadAuthorizationView(self.engine)
        self.assertEqual(
            outcome(lambda: first_view.authorize(issue, "render_document", actor["partyId"], role_id))[0],
            "ok",
        )
        self.engine._records[("RoleAssignment", role_id)]["active"] = False
        second_view = ReadAuthorizationView(self.engine)
        self.assertEqual(
            outcome(lambda: second_view.authorize(issue, "render_document", actor["partyId"], role_id))[0:2],
            ("error", "ASSIGNMENT_EXPIRED"),
        )

    def test_scope_descendants_and_internal_recipient_rules_match_engine(self):
        actor = self.meta["actors"]["SUP"]
        role_id = actor["roleAssignmentId"]
        parent = self.meta["scope"]["locationId"]
        child = "read-auth-child-location"
        self.engine._records[("Location", child)] = {
            "id": child,
            "projectId": self.meta["projectId"],
            "parentId": parent,
        }
        record = next(
            self.engine.get(kind, object_id)
            for (kind, object_id), machine in self.engine._record_machines.items()
            if machine == "issue"
        )
        record["locationId"] = child
        self.assertEqual(
            outcome(lambda: self.engine.authorize(record, "render_document", actor["partyId"], role_id)),
            outcome(lambda: self.view.authorize(record, "render_document", actor["partyId"], role_id)),
        )

        report = next(
            self.engine.get(kind, object_id)
            for (kind, object_id), machine in self.engine._record_machines.items()
            if machine == "report"
        )
        report["status"] = "review"
        owner = self.meta["actors"]["OWN"]
        for party_id in (owner["partyId"], actor["partyId"]):
            owner_role = owner["roleAssignmentId"] if party_id == owner["partyId"] else role_id
            self.assertEqual(
                outcome(lambda: self.engine.authorize_read(report, party_id, owner_role)),
                outcome(lambda: self.view.authorize_read(report, party_id, owner_role)),
            )


if __name__ == "__main__":
    unittest.main()
