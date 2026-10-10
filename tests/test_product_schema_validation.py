"""Regression cases for #58; real Product examples are the test fixtures."""
import copy
import json
import unittest
from pathlib import Path

from scripts.product_schema_validation import SchemaError, ValidationError, validate_schema
from scripts.validate_product_configuration import validate_change_record, validate_project_config

ROOT = Path(__file__).resolve().parents[1]


class ProductSchemaKeywordTests(unittest.TestCase):
    def test_json_booleans_are_not_numbers(self):
        for kind in ('integer', 'number'):
            with self.subTest(kind=kind), self.assertRaises(ValidationError):
                validate_schema(True, {'type': kind})
        self.assertTrue(validate_schema(1.0, {'type': 'integer'}))

    def test_const_and_unique_items_use_json_equality(self):
        with self.assertRaises(ValidationError):
            validate_schema(1, {'const': True})
        self.assertTrue(validate_schema([True, 1], {'uniqueItems': True}))
        with self.assertRaises(ValidationError):
            validate_schema([1, 1.0], {'uniqueItems': True})

    def test_nested_constraints_and_error_paths(self):
        schema = {'type': 'object', 'properties': {'items': {'type': 'array', 'minItems': 1, 'items': {'type': 'integer', 'minimum': 0}}}}
        for value, path in [({'items': []}, '$/items'), ({'items': [-1]}, '$/items/0'), ({'items': ['1']}, '$/items/0')]:
            with self.subTest(value=value), self.assertRaises(ValidationError) as caught:
                validate_schema(value, schema)
            self.assertIn(path, str(caught.exception))

    def test_one_of_exactly_one_match(self):
        schema = {'oneOf': [{'required': ['value']}, {'required': ['fixedAt']}]}
        self.assertTrue(validate_schema({'value': 1}, schema))
        for value in ({}, {'value': 1, 'fixedAt': 'x'}):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_schema(value, schema)

    def test_conditionals(self):
        schema = {'allOf': [{'if': {'properties': {'migration': {'const': True}}, 'required': ['migration']}, 'then': {'required': ['plan']}, 'else': {'properties': {'plan': False}}}]}
        self.assertTrue(validate_schema({'migration': True, 'plan': 'p'}, schema))
        self.assertTrue(validate_schema({'migration': False}, schema))
        for value in ({'migration': True}, {'migration': False, 'plan': 'p'}):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_schema(value, schema)

    def test_unknown_keywords_fail_even_in_unused_branch(self):
        for schema in ({'properties': {'unused': {'minLenght': 1}}}, {'if': False, 'then': {'maxLength': 5}}, {'format': 'unimplemented'}):
            with self.subTest(schema=schema), self.assertRaises(SchemaError):
                validate_schema({}, schema)

    def test_non_finite_numbers_are_rejected(self):
        for value in (float('nan'), float('inf'), float('-inf')):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_schema(value, {'type': 'number'})

    def test_date_time_requires_valid_calendar_and_offset(self):
        schema = {'type': 'string', 'format': 'date-time'}
        self.assertTrue(validate_schema('2026-10-06T11:00:00+07:00', schema))
        for value in ('2026-02-30T11:00:00Z', '2026-10-06T11:00:00', '2026-10-06 11:00:00Z'):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_schema(value, schema)


class ProductConfigurationSchemaRegressionTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'app/reference/project_configuration_pack_example_v1.json').read_text())
        self.change = json.loads((ROOT / 'app/reference/product_change_record_example_v1.json').read_text())

    def test_seven_reported_invalid_inputs(self):
        cases = [
            (lambda x: x['mediaPolicy'].__setitem__('retentionDays', -1), '$/mediaPolicy/retentionDays'),
            (lambda x: x['ownerReporting']['priorities'][0].pop('recipientRoleCodes'), '$/ownerReporting/priorities/0/recipientRoleCodes'),
            (lambda x: x['ownerReporting']['priorities'][0].__setitem__('recipientRoleCodes', []), '$/ownerReporting/priorities/0/recipientRoleCodes'),
            (lambda x: x['deadlineRules'][0].__setitem__('value', -24), '$/deadlineRules/0/value'),
            (lambda x: x.__setitem__('configVersion', True), '$/configVersion'),
            (lambda x: x['mediaPolicy'].__setitem__('unknownNestedPolicy', True), '$/mediaPolicy/unknownNestedPolicy'),
            (lambda x: x['roleAssignments'][0].pop('roleCode'), '$/roleAssignments/0/roleCode'),
        ]
        for mutate, path in cases:
            value = copy.deepcopy(self.config)
            mutate(value)
            with self.subTest(path=path), self.assertRaises(ValidationError) as caught:
                validate_project_config(value)
            self.assertIn(path, str(caught.exception))

    def test_other_nested_schema_constraints(self):
        mutations = [
            lambda x: x['mediaPolicy'].__setitem__('enabled', 'true'),
            lambda x: x['mediaPolicy']['autoRetry'].__setitem__('maxAttempts', 1.5),
            lambda x: x['mediaPolicy']['autoRetry'].__setitem__('backoffSeconds', [True]),
            lambda x: x['mediaPolicy']['allowedModes'].append(x['mediaPolicy']['allowedModes'][0]),
            lambda x: x['qualificationRules'][0].__setitem__('minimumRank', -1),
            lambda x: x['deadlineRules'][0].__setitem__('source', 'unknown'),
            lambda x: x['ownerReporting']['periodicCadences'][0].__setitem__('cadence', 'unknown'),
            lambda x: x['organizations'][0].__setitem__('unknown', True),
            lambda x: x['roleAssignments'][0].__setitem__('roleCode', ''),
            lambda x: x.__setitem__('acceptanceScenarioIds', []),
        ]
        for i, mutate in enumerate(mutations):
            value = copy.deepcopy(self.config)
            mutate(value)
            with self.subTest(case=i), self.assertRaises(ValidationError):
                validate_project_config(value)

    def test_change_record_schema_is_also_enforced(self):
        mutations = [
            lambda x: x.__setitem__('migrationRequired', 'false'),
            lambda x: x.__setitem__('reason', ''),
            lambda x: x.__setitem__('baselineTo', 'not-a-version'),
            lambda x: x.__setitem__('impactedContracts', []),
            lambda x: x.__setitem__('impactedContracts', ['same', 'same']),
            lambda x: x.__setitem__('acceptanceScenarioIds', []),
            lambda x: x.__setitem__('impactedRegisters', ['bad']),
        ]
        for i, mutate in enumerate(mutations):
            value = copy.deepcopy(self.change)
            mutate(value)
            with self.subTest(case=i), self.assertRaises(ValidationError):
                validate_change_record(value)
        value = copy.deepcopy(self.change)
        value['migrationRequired'] = True
        value.pop('migrationPlanRef', None)
        with self.assertRaises(ValidationError):
            validate_change_record(value)

    def test_actual_schemas_have_no_unsupported_keywords(self):
        self.assertTrue(validate_project_config(self.config))
        self.assertTrue(validate_change_record(self.change))

    def test_approved_pcr_2026_002_is_validated_against_existing_record_schema(self):
        approved = json.loads((ROOT / 'app/reference/product_change_record_pcr_2026_002.json').read_text())
        self.assertEqual(approved['changeId'], 'PCR-2026-002')
        self.assertEqual(approved['decision'], 'approved')
        self.assertEqual(approved['baselineFrom'], '1.0')
        self.assertEqual(approved['baselineTo'], '1.1')
        self.assertEqual(approved['changeClass'], 'C2')
        self.assertEqual(approved['effectiveFrom'], '2026-10-10T00:00:00+07:00')
        self.assertTrue(validate_change_record(approved))


if __name__ == '__main__':
    unittest.main()
