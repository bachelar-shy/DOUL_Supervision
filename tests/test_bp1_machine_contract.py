"""B-P1 contract-consumption checks for subtype persistence/API expansion."""
import json
from pathlib import Path
import unittest

from scripts.generate_api import generate


ROOT = Path(__file__).resolve().parents[1]
BP1_WORK_ITEM_SUBTYPES = {
    "SafetyStopOrder",
    "DelayEvent",
    "RecoveryPlan",
    "QuantityMeasurement",
    "FireCompliance",
    "Claim",
    "EOTRequest",
    "RegulatoryPermit",
    "DocumentTransmittal",
    "PersonnelDeployment",
}
BP1_INFORMATION_ITEM_SUBTYPES = {
    "Schedule",
    "ContractBOQ",
    "DailyRecord",
}


class Bp1MachineContractTests(unittest.TestCase):
    def setUp(self):
        self.machine_contract = json.loads(
            (ROOT / "app/schema/state_machines_v1.json").read_text()
        )["machines"]
        self.machine_bindings = json.loads(
            (ROOT / "app/reference/machine_bindings_v1.json").read_text()
        )["machines"]
        self.domain_model = json.loads(
            (ROOT / "app/schema/domain_model_v2.json").read_text()
        )
        self.schemas = json.loads(
            (ROOT / "app/schema/domain_schemas_v2.json").read_text()
        )["components"]["schemas"]

    def test_generated_api_routes_are_derived_from_machine_collections(self):
        api = generate()
        self.assertEqual(set(self.machine_bindings), set(self.machine_contract))
        for name, machine in self.machine_contract.items():
            with self.subTest(machine=name):
                binding = self.machine_bindings[name]
                root = f"/projects/{{projectId}}/{binding['collection']}"
                self.assertIn(root, api["paths"])
                self.assertIn("post", api["paths"][root])
                self.assertIn(root + "/{objectId}", api["paths"])

    def test_bp1_subtype_declarations_are_synchronized(self):
        model = self.domain_model["subtypes"]
        work_schema = set(
            self.schemas["WorkItem"]["properties"]["subtype"]["enum"]
        )
        information_schema = set(
            self.schemas["InformationItem"]["properties"]["subtype"]["enum"]
        )

        self.assertEqual(
            BP1_WORK_ITEM_SUBTYPES - set(model["WorkItem"]),
            set(),
        )
        self.assertEqual(BP1_WORK_ITEM_SUBTYPES - work_schema, set())
        self.assertEqual(
            BP1_INFORMATION_ITEM_SUBTYPES - set(model["InformationItem"]),
            set(),
        )
        self.assertEqual(
            BP1_INFORMATION_ITEM_SUBTYPES - information_schema,
            set(),
        )
        self.assertEqual(
            len(BP1_WORK_ITEM_SUBTYPES | BP1_INFORMATION_ITEM_SUBTYPES),
            13,
        )

    def test_generated_command_api_has_no_physical_delete(self):
        api = generate()
        for path, item in api["paths"].items():
            with self.subTest(path=path):
                self.assertNotIn("delete", item)


if __name__ == "__main__":
    unittest.main()
