from copy import deepcopy
import json
import unittest
from pathlib import Path

from app.reference.engine import uid
from app.reference.validation import ContractError
from tests.fixtures import AT, Fixture

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


class SafetyExecutionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.machines = load('app/schema/state_machines_v1.json')['machines']
        cls.policies = load('app/schema/authority_matrix_v1.json')['policies']
        cls.schemas = load('app/schema/domain_schemas_v2.json')['components']['schemas']
        cls.registers = {x['register_id']: x for x in load('app/schema/register_projection_map_v2.json')['registers']}
        cls.config = load('app/reference/project_configuration_pack_example_v1.json')
        cls.execution = load('app/schema/safety_execution_contract_v1.json')

    def transition(self, machine, command, from_state=None):
        values = [t for t in self.machines[machine]['transitions'] if t['command'] == command]
        if from_state is not None:
            values = [t for t in values if t['from'] == from_state]
        self.assertTrue(values, (machine, command, from_state))
        return values[0]

    def set_permit_state(self, fixture, permit, state='active', work_authorized=True, readiness=None):
        current = fixture.engine.get('WorkItem', permit['id'])
        current['status'] = state
        current['data']['workAuthorized'] = work_authorized
        if readiness is not None:
            current['data']['readiness'] = deepcopy(readiness)
        key = ('WorkItem', permit['id'])
        fixture.engine._records[key] = deepcopy(current)
        fixture.engine._history[key + (current['version'],)] = deepcopy(current)
        return current

    def test_three_safety_machines_are_explicit(self):
        expected = {
            'safety_permit': ('SafetyPermit', 'draft'),
            'safety_stop_order': ('SafetyStopOrder', 'issued'),
            'safety_equipment_inspection': ('SafetyEquipmentInspection', 'due'),
        }
        for name, (subtype, initial) in expected.items():
            self.assertIn(name, self.machines)
            self.assertEqual(self.machines[name]['object_type'], 'WorkItem')
            self.assertEqual(self.machines[name]['subtype'], subtype)
            self.assertEqual(self.machines[name]['initial'], initial)

    def test_permit_authorized_is_not_active_or_work_authorized(self):
        authorize = self.transition('safety_permit', 'authorize', 'authorization_pending')
        activate = self.transition('safety_permit', 'activate', 'authorized')
        self.assertEqual(authorize['to'], 'authorized')
        self.assertEqual(activate['to'], 'active')
        self.assertIn('safety_work_authorized', activate['guards'])
        self.assertNotIn('workAuthorized', authorize['payload_fields'])

    def test_stop_lift_is_explicit_human_chief_supervisor_authority(self):
        lift = self.transition('safety_stop_order', 'lift_stop', 'verification')
        self.assertEqual(lift['authority'], 'safety.stop_lift')
        self.assertIn('safety_resume_gate_satisfied', lift['guards'])
        policy = self.policies['safety.stop_lift']
        self.assertEqual(policy['actor_groups'], ['SUP'])
        self.assertEqual(policy['role_codes'], ['chief_supervisor'])
        self.assertTrue(policy['official'])

    def test_contractor_can_self_stop_but_not_self_resume(self):
        self_stop = self.transition('safety_permit', 'self_suspend', 'active')
        self.assertEqual(self.policies[self_stop['authority']]['actor_groups'], ['CON'])
        approve_resume = self.transition('safety_permit', 'approve_resume', 'resume_review')
        self.assertEqual(self.policies[approve_resume['authority']]['actor_groups'], ['SUP'])

    def test_system_only_derives_expiry_and_never_stop_lift(self):
        permit_expiry = self.policies['safety.permit.expire']
        equipment_expiry = self.policies['safety.equipment.expire']
        self.assertEqual(permit_expiry['actor_groups'], ['SYSTEM'])
        self.assertFalse(permit_expiry['official'])
        self.assertEqual(equipment_expiry['actor_groups'], ['SYSTEM'])
        self.assertFalse(equipment_expiry['official'])
        self.assertNotIn('SYSTEM', self.policies['safety.stop_lift']['actor_groups'])
        self.assertNotIn('SYSTEM', self.policies['safety.resume.approve']['actor_groups'])

    def test_safety_workitem_data_is_typed(self):
        bindings = {
            x['if']['properties']['subtype']['const']: x['then']['properties']['data']['$ref']
            for x in self.schemas['WorkItem']['allOf']
            if x.get('if', {}).get('properties', {}).get('subtype', {}).get('const')
        }
        self.assertEqual(bindings['SafetyPermit'], '#/components/schemas/SafetyPermitData')
        self.assertEqual(bindings['SafetyStopOrder'], '#/components/schemas/SafetyStopOrderData')
        self.assertEqual(bindings['SafetyEquipmentInspection'], '#/components/schemas/SafetyEquipmentInspectionData')
        permit = self.schemas['SafetyPermitData']['properties']
        self.assertTrue({'workAuthorized', 'readiness', 'blockedReasons', 'stopOrderRefs'} <= set(permit))
        self.assertTrue(permit['workAuthorized']['readOnly'])
        self.assertTrue(permit['authorizedAt']['readOnly'])
        stop = self.schemas['SafetyStopOrderData']['properties']
        self.assertTrue({'affectedPermitRefs', 'resumeGate', 'resumeVerificationRefs'} <= set(stop))
        equipment = self.schemas['SafetyEquipmentInspectionData']['properties']
        self.assertTrue({'equipmentAvailable', 'certificateRefs', 'calibrationRefs', 'blockedReasons'} <= set(equipment))
        self.assertTrue(equipment['equipmentAvailable']['readOnly'])

    def test_safety_registers_expose_domain_commands_not_raw_patch(self):
        reg18 = self.registers['18']
        reg19 = self.registers['19']
        self.assertFalse(reg18['raw_status_patch'])
        self.assertIn('safety_permit:activate', reg18['allowed_commands'])
        self.assertIn('safety_stop_order:lift_stop', reg18['allowed_commands'])
        self.assertIn('work_authorized', reg18['calculated_fields'])
        self.assertEqual(reg19['mode'], 'actionable')
        self.assertIn('safety_equipment_inspection:pass', reg19['allowed_commands'])
        self.assertFalse(reg19['raw_status_patch'])

    def test_server_derived_work_authorization_cannot_be_injected_on_create(self):
        fixture = Fixture()
        with self.assertRaisesRegex(ContractError, 'server-derived'):
            fixture.create('safety_permit', {'title': '고위험 작업허가', 'data': {'workAuthorized': False}}, actor='CON')
        permit = fixture.create('safety_permit', {'title': '고위험 작업허가', 'data': {}}, actor='CON')
        self.assertEqual(permit['status'], 'draft')
        self.assertFalse(permit['data']['workAuthorized'])

    def test_formal_stop_is_issued_at_creation_and_requires_evidence(self):
        fixture = Fixture()
        permit = fixture.create('safety_permit', {'title': '고위험 작업허가', 'data': {}}, actor='CON')
        self.set_permit_state(fixture, permit)
        data = {
            'stopOrderNo': 'STOP-001',
            'stopScopeType': 'permit',
            'stopReason': 'immediate hazard',
            'observedAt': AT,
            'effectiveAt': AT,
            'affectedPermitRefs': [fixture.ref('WorkItem', permit['id'])],
        }
        with self.assertRaisesRegex(ContractError, 'hazard evidence'):
            fixture.create('safety_stop_order', {'title': '즉시 작업중지', 'data': data, 'evidenceIds': []}, actor='SUP')
        stop = fixture.create('safety_stop_order', {'title': '즉시 작업중지', 'data': data, 'evidenceIds': [fixture.evidence]}, actor='SUP')
        affected = fixture.engine.get('WorkItem', permit['id'])
        self.assertEqual(stop['status'], 'issued')
        self.assertEqual(affected['status'], 'suspended')
        self.assertFalse(affected['data']['workAuthorized'])
        self.assertEqual(affected['data']['suspensionReason'], 'immediate hazard')
        self.assertIn({'objectType': 'WorkItem', 'objectId': stop['id'], 'version': 1}, affected['data']['stopOrderRefs'])
        self.assertTrue(self.execution['issue_stop_package']['atomic'])
        self.assertTrue(self.execution['issue_stop_package']['rollback_on_failure'])

    def test_issue_stop_rejects_stale_permit_ref_before_any_package_write(self):
        fixture = Fixture()
        first = fixture.create('safety_permit', {'title': '첫 번째 Permit', 'data': {}}, actor='CON')
        second = fixture.create('safety_permit', {'title': '두 번째 Permit', 'data': {}}, actor='CON')
        self.set_permit_state(fixture, first)
        self.set_permit_state(fixture, second)
        first_ref = fixture.ref('WorkItem', first['id'])
        stale_second_ref = fixture.ref('WorkItem', second['id'])
        second_current = fixture.engine.get('WorkItem', second['id'])
        second_current['version'] += 1
        second_current['updatedAt'] = fixture.engine.at()
        fixture.engine._save('WorkItem', second_current)
        first_before = fixture.engine.get('WorkItem', first['id'])
        stop_id = uid()
        data = {
            'stopOrderNo': 'STOP-STALE',
            'stopScopeType': 'permit',
            'stopReason': 'stale reference probe',
            'observedAt': AT,
            'effectiveAt': AT,
            'affectedPermitRefs': [first_ref, stale_second_ref],
        }
        with self.assertRaisesRegex(ContractError, second['id']):
            fixture.create('safety_stop_order', {'title': '원자성 검증', 'data': data, 'evidenceIds': [fixture.evidence]}, actor='SUP', oid=stop_id)
        self.assertEqual(fixture.engine.get('WorkItem', first['id']), first_before)
        self.assertNotIn(('WorkItem', stop_id), fixture.engine._records)

    def test_project_config_can_activate_stop_lift_only_after_product_policy_exists(self):
        binding = next(x for x in self.config['authorityBindings'] if x['authorityCode'] == 'safety.stop_lift')
        self.assertEqual(binding['implementationStatus'], 'active')
        self.assertIn('safety.stop_lift', self.policies)
        self.assertTrue(set(binding['actorGroups']) <= set(self.policies['safety.stop_lift']['actor_groups']))
        self.assertTrue(set(binding['roleCodes']) <= set(self.policies['safety.stop_lift']['role_codes']))


if __name__ == '__main__':
    unittest.main()
