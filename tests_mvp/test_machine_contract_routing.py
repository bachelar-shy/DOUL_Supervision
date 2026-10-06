"""Runtime routing must consume the same machine contract as OpenAPI."""
import json
from pathlib import Path
import unittest

from services.api.main import COLLECTIONS


ROOT = Path(__file__).resolve().parents[1]


class MachineContractRoutingTests(unittest.TestCase):
    def test_runtime_collections_are_derived_from_backend_bindings(self):
        bindings = json.loads(
            (ROOT / "app/reference/machine_bindings_v1.json").read_text()
        )["machines"]
        expected = {
            binding["collection"]: name
            for name, binding in bindings.items()
        }
        self.assertEqual(COLLECTIONS, expected)


if __name__ == "__main__":
    unittest.main()
