import json
import unittest
from pathlib import Path

from app.reference.handover import check_guard, initialize_create
from app.reference.validation import ContractError


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads((ROOT / path).read_text())


class HandoverContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schemas = read("app/schema/domain_schemas_v2.json")["components"]["schemas"]
        cls.machines = read("app/schema/state_machines_v1.json")["machines"]
        cls.authorities = read("app/schema/authority_matrix_v1.json")["policies"]
        cls.bindings = read("app/reference/machine_bindings_v1.json")["machines"]

    def test_workflows_are_three_separate_contract_objects(self):
        expected = {
            "commissioning_package": ("CommissioningPackage", "CommissioningPackageData", "planned", "closed"),
            "handover_package": ("HandoverPackage", "HandoverPackageData", "draft", "closed"),
            "warranty_claim": ("WarrantyClaim", "WarrantyClaimData", "draft", "closed"),
        }
        for name, (subtype, data_schema, initial, terminal) in expected.items():
            machine = self.machines[name]
            self.assertEqual(machine["object_type"], "WorkItem")
            self.assertEqual(machine["subtype"], subtype)
            self.assertEqual(machine["initial"], initial)
            self.assertIn(terminal, machine["states"])
            self.assertEqual(self.bindings[name]["collection"], {
                "commissioning_package": "commissioning-packages",
                "handover_package": "handover-packages",
                "warranty_claim": "warranty-claims",
            }[name])
            self.assertEqual(self.schemas["WorkItem"]["allOf"][-3 + list(expected).index(name)]["then"]["properties"]["data"]["$ref"], f"#/components/schemas/{data_schema}")

    def test_commands_keep_contract_decision_rights(self):
        commands = {name: {item["command"]: item for item in machine["transitions"]}
                    for name, machine in self.machines.items()}
        self.assertEqual(commands["commissioning_package"]["submit_test_result"]["authority"], "completion.commissioning.submit_result")
        self.assertEqual(commands["commissioning_package"]["accept_test"]["authority"], "completion.commissioning.verify")
        self.assertEqual(commands["handover_package"]["accept_handover"]["authority"], "completion.handover.owner_decide")
        self.assertEqual(commands["handover_package"]["record_partial_handover"]["authority"], "completion.handover.partial")
        self.assertEqual(commands["warranty_claim"]["close_warranty_claim"]["authority"], "completion.warranty.close")
        self.assertNotIn("CON", self.authorities["completion.warranty.close"]["actor_groups"])
        self.assertIn("OWN", self.authorities["completion.warranty.close"]["actor_groups"])
        self.assertIn("SUP", self.authorities["completion.warranty.close"]["actor_groups"])

    def test_result_and_acceptance_history_are_server_owned(self):
        properties = self.schemas["CommissioningPackageData"]["properties"]
        for field in ("testResultRefs", "testResultHistory", "readinessStatus", "lastTestOutcome"):
            self.assertTrue(properties[field].get("readOnly"), field)
        self.assertNotIn("testResultHistory", self.machines["commissioning_package"]["transitions"][4]["payload_fields"])
        create = {"subtype": "CommissioningPackage", "data": {"testResultHistory": []}}
        with self.assertRaises(ContractError) as raised:
            initialize_create(None, "commissioning_package", create)
        self.assertEqual(raised.exception.code, "IMMUTABLE_FIELD")

    def test_commands_cannot_rewrite_unrelated_package_data(self):
        with self.assertRaises(ContractError) as raised:
            check_guard(None, "commissioning_test_result_ready", {}, {"testResultRefs": []}, "party", {}, "submit_test_result")
        self.assertEqual(raised.exception.code, "COMMAND_FIELD_NOT_ALLOWED")

    def test_handover_scope_and_warranty_dates_are_explicit_contract_inputs(self):
        handover = self.schemas["HandoverPackageData"]["properties"]
        warranty_schema = self.schemas["WarrantyClaimData"]
        warranty = warranty_schema["properties"]
        self.assertEqual(handover["acceptedScope"]["$ref"], "#/components/schemas/HandoverScope")
        self.assertTrue(handover["warrantyStartAt"].get("readOnly"))
        self.assertNotIn("warrantyStartAt", next(t for t in self.machines["handover_package"]["transitions"] if t["command"] == "record_final_handover")["payload_fields"])
        self.assertIn("warrantyPeriodRef", warranty_schema["required"])
        self.assertIn("defectScope", warranty_schema["required"])
        self.assertIn("closureRef", next(t for t in self.machines["warranty_claim"]["transitions"] if t["command"] == "close_warranty_claim")["required_payload_fields"])

    def test_contract_profiles_are_typed_and_cannot_silently_disable_gates(self):
        commissioning = self.schemas["CommissioningProfileRule"]
        for field in ("requiredPrecommissioningItemIds", "requiredTestProcedureRefs", "requiredIntegratedTestRefs",
                      "requiresMaterialReadiness", "requiresEquipmentReadiness", "requiresCalibration",
                      "requiresUtilities", "requiresSafetyPermit", "requiresTestWitness"):
            self.assertIn(field, commissioning["required"])
        handover = self.schemas["HandoverProfileRule"]
        self.assertIn("requiredDocumentSets", handover["required"])
        self.assertIn("warrantyTriggerOnPartialHandover", handover["required"])
        warranty = self.schemas["WarrantyPeriodRule"]
        self.assertEqual(warranty["properties"]["closeAuthorityActorGroup"]["enum"], ["SUP", "OWN"])
        self.assertIn("responseDueHours", warranty["required"])

    def test_warranty_close_and_reinspection_references_are_exact_typed_links(self):
        closure_types = self.schemas["WarrantyClaimData"]["properties"]["closureRef"]["properties"]["objectType"]["enum"]
        self.assertEqual(closure_types, ["Decision", "Issue"])
        correction_refs = self.schemas["Inspection"]["properties"]["correctiveActionRefs"]
        self.assertTrue(correction_refs["uniqueItems"])
        self.assertEqual(correction_refs["items"]["$ref"], "#/components/schemas/DomainRef")


if __name__ == "__main__":
    unittest.main()
