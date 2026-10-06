import copy
import json
import unittest
from pathlib import Path

from scripts.validate_product_configuration import validate_change_record, validate_project_config

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


class ProductConfigurationContractTests(unittest.TestCase):
    def setUp(self):
        self.config = load('app/reference/project_configuration_pack_example_v1.json')
        self.change = load('app/reference/product_change_record_example_v1.json')

    def test_reference_examples_are_valid(self):
        self.assertTrue(validate_project_config(self.config))
        self.assertTrue(validate_change_record(self.change))

    def test_unknown_root_key_fails_closed(self):
        config = copy.deepcopy(self.config)
        config['unexpected'] = True
        with self.assertRaisesRegex(AssertionError, 'unknown root fields'):
            validate_project_config(config)

    def test_active_authority_cannot_widen_actor_group(self):
        config = copy.deepcopy(self.config)
        config['authorityBindings'][0]['actorGroups'] = ['SUP', 'ADM']
        with self.assertRaisesRegex(AssertionError, 'widens actor groups'):
            validate_project_config(config)

    def test_active_authority_must_exist_in_runtime_matrix(self):
        config = copy.deepcopy(self.config)
        config['authorityBindings'][0]['authorityCode'] = 'future.unimplemented'
        with self.assertRaisesRegex(AssertionError, 'unimplemented authority policy'):
            validate_project_config(config)

    def test_planned_authority_may_prepare_future_product_binding(self):
        config = copy.deepcopy(self.config)
        config['authorityBindings'][-1]['authorityCode'] = 'future.product.authority'
        config['authorityBindings'][-1]['implementationStatus'] = 'planned'
        self.assertTrue(validate_project_config(config))

    def test_change_references_known_acceptance_scenarios(self):
        change = copy.deepcopy(self.change)
        change['acceptanceScenarioIds'] = ['AC-NOT-REAL-99']
        with self.assertRaisesRegex(AssertionError, 'unknown acceptance scenario'):
            validate_change_record(change)


if __name__ == '__main__':
    unittest.main()
