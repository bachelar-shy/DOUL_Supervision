import unittest

from app.reference.engine import uid
from services.api.creation_capabilities import build_creation_capabilities
from tests.fixtures import Fixture


class CreationCapabilityTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.scope = self.f.scope()

    def capabilities(self, actor="SUP", **kwargs):
        party, role_id = self.f.actors[actor]
        role = self.f.engine.get("RoleAssignment", role_id)
        return build_creation_capabilities(
            self.f.engine,
            self.f.project,
            party,
            role,
            self.scope,
            **kwargs,
        )

    def test_machine_authority_and_qualification_drive_capabilities(self):
        caps = self.capabilities("SUP")
        self.assertEqual(caps["contract_boq"]["authority"], "payment.boq.create")
        self.assertEqual(caps["contract_notice"]["status"], "available")
        self.assertTrue(caps["contract_notice"]["canCreate"])

        # The server policy matrix, not a UI role allowlist, decides this.
        supervisor_caps = self.capabilities("SUP")
        self.assertEqual(supervisor_caps["payment_claim"]["status"], "unauthorized")
        self.assertFalse(supervisor_caps["payment_claim"]["canCreate"])

        party, role_id = self.f.actors["SUP"]
        role = self.f.engine.get("RoleAssignment", role_id)
        qualification_id = role["qualificationIds"][0]
        self.f.engine._records[("Qualification", qualification_id)]["revoked"] = True
        revoked = self.capabilities("SUP")
        self.assertEqual(revoked["issue"]["status"], "prerequisites_missing")
        self.assertIn("QUALIFICATION_INVALID", revoked["issue"]["reasons"])

    def test_project_scope_and_adapter_availability_are_distinct(self):
        party, role_id = self.f.actors["SUP"]
        role = self.f.engine.get("RoleAssignment", role_id)
        incomplete = build_creation_capabilities(
            self.f.engine,
            self.f.project,
            party,
            role,
            {"discipline": "architecture"},
        )
        self.assertEqual(incomplete["issue"]["status"], "prerequisites_missing")
        self.assertIn("PROJECT_SCOPE_MISSING:packageId", incomplete["issue"]["reasons"])
        no_project_configuration = build_creation_capabilities(
            self.f.engine,
            self.f.project,
            party,
            role,
            None,
        )
        self.assertEqual(no_project_configuration["contract_notice"]["status"], "prerequisites_missing")
        self.assertIn("PROJECT_SCOPE_UNAVAILABLE", no_project_configuration["contract_notice"]["reasons"])

        offline = self.capabilities("SUP", connected=False)
        self.assertEqual(offline["contract_boq"]["status"], "unavailable")
        self.assertEqual(offline["contract_boq"]["reasons"], ["CONNECTIVITY_UNAVAILABLE"])

        no_queue = self.capabilities("SUP", queue_enabled=False)
        self.assertEqual(no_queue["analysis_run"]["status"], "unavailable")
        self.assertEqual(no_queue["contract_boq"]["status"], "available")

    def test_capability_does_not_replace_engine_create_authorization(self):
        caps = self.capabilities("SUP")
        self.assertTrue(caps["contract_notice"]["canCreate"])
        party, role_id = self.f.actors["OWN"]
        with self.assertRaises(Exception) as error:
            self.f.engine.create(
                "contract_notice",
                uid(),
                self.f.project,
                {
                    "title": "Notice",
                    "data": {
                        "noticeNo": "N-1",
                        "eventRef": {"objectType": "WorkItem", "objectId": uid(), "version": 1},
                        "clauseRef": {"objectType": "Requirement", "objectId": self.f.requirement, "version": 1},
                        "contractRuleRef": {"objectType": "Requirement", "objectId": self.f.requirement, "version": 1},
                        "eventAt": "2026-10-04T12:00:00Z",
                        "awareAt": "2026-10-04T12:00:00Z",
                        "senderPartyId": party,
                        "recipientPartyId": self.f.actors["SUP"][0],
                        "subject": "Notice",
                    },
                },
                party,
                role_id,
                uid(),
            )
        self.assertEqual(getattr(error.exception, "code", None), "NOT_AUTHORIZED")


if __name__ == "__main__":
    unittest.main()
