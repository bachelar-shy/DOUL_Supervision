"""Validate DOUL Product project-configuration and change-record examples without external dependencies."""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.product_schema_validation import validate_schema

ALLOWED_ACTORS = {'SUP', 'CON', 'OWN', 'DES', 'ADM'}
ALLOWED_PRIORITIES = {'P1', 'P2', 'P3', 'P4'}
ALLOWED_MEDIA_MODES = {'photo', 'keyframes', 'adaptive', 'every_frame', 'audio'}
ALLOWED_TRANSFER = {'forbidden', 'approved_only', 'allowed_under_contract'}


def load(path: str):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def parse_datetime(value: str):
    text = value[:-1] + '+00:00' if value.endswith('Z') else value
    parsed = datetime.fromisoformat(text)
    require(parsed.tzinfo is not None, 'datetime must include timezone: ' + value)
    return parsed


def validate_project_config(instance):
    schema = load('app/schema/project_configuration_contract_v1.json')
    require(isinstance(instance, dict), 'project config must be an object')
    required = set(schema['required'])
    allowed = set(schema['properties'])
    require(required <= set(instance), 'project config missing required root fields')
    require(set(instance) <= allowed, 'project config contains unknown root fields: ' + str(set(instance) - allowed))
    validate_schema(instance, schema)
    require(instance['schemaVersion'] == '1.0', 'unsupported project config schemaVersion')
    require(isinstance(instance['configVersion'], int) and instance['configVersion'] >= 1, 'configVersion must be positive integer')
    require(re.fullmatch(r'1\.[0-9]+', instance['baselineVersion']) is not None, 'baselineVersion must be v1.x')
    parse_datetime(instance['effectiveFrom'])
    ZoneInfo(instance['timezone'])

    organizations = instance['organizations']
    org_ids = [x['organizationId'] for x in organizations]
    require(len(org_ids) == len(set(org_ids)) and org_ids, 'organization IDs must be unique and non-empty')
    org_actor = {}
    for org in organizations:
        require(org['actorGroup'] in ALLOWED_ACTORS, 'invalid organization actor group')
        org_actor[org['organizationId']] = org['actorGroup']

    scopes = instance['scopes']
    discipline_ids, package_ids, location_ids = map(set, (scopes['disciplines'], scopes['packages'], scopes['locations']))
    for assignment in instance['roleAssignments']:
        require(assignment['organizationId'] in org_actor, 'role assignment references unknown organization')
        require(assignment['actorGroup'] == org_actor[assignment['organizationId']], 'role assignment actor group conflicts with organization')
        require(assignment['actorGroup'] in ALLOWED_ACTORS, 'invalid role assignment actor group')
        require(set(assignment.get('disciplineIds', [])) <= discipline_ids, 'role assignment discipline outside project scopes')
        require(set(assignment.get('packageIds', [])) <= package_ids, 'role assignment package outside project scopes')
        require(set(assignment.get('locationIds', [])) <= location_ids, 'role assignment location outside project scopes')

    authority = load('app/schema/authority_matrix_v1.json')['policies']
    for binding in instance['authorityBindings']:
        require(set(binding['actorGroups']) <= ALLOWED_ACTORS, 'authority binding contains non-human/unknown actor group')
        require(binding['roleCodes'], 'authority binding requires role codes')
        require(binding['implementationStatus'] in {'planned', 'active'}, 'invalid authority implementation status')
        if binding['implementationStatus'] == 'active':
            require(binding['authorityCode'] in authority, 'active authority binding references unimplemented authority policy')
            policy = authority[binding['authorityCode']]
            require(set(binding['actorGroups']) <= set(policy['actor_groups']), 'active authority binding widens actor groups')
            if policy['role_codes']:
                require(set(binding['roleCodes']) <= set(policy['role_codes']), 'active authority binding widens role codes')

    for rule in instance['deadlineRules']:
        has_value = 'value' in rule
        has_fixed = 'fixedAt' in rule
        require(has_value != has_fixed, 'deadline rule requires exactly one of value/fixedAt')
        if has_fixed:
            require(rule['calculation'] == 'fixed_datetime', 'fixedAt requires fixed_datetime calculation')
            parse_datetime(rule['fixedAt'])
        else:
            require(rule['calculation'] != 'fixed_datetime', 'fixed_datetime requires fixedAt')
        if rule.get('timezone'):
            ZoneInfo(rule['timezone'])

    priorities = instance['ownerReporting']['priorities']
    priority_codes = [x['priority'] for x in priorities]
    require(set(priority_codes) == ALLOWED_PRIORITIES and len(priority_codes) == 4, 'owner reporting requires exactly P1-P4')
    require(len(priority_codes) == len(set(priority_codes)), 'owner reporting priorities must be unique')

    form_ids = {x['id'] for x in load('app/forms/form_catalog.json')['forms']}
    require(set(instance['forms']['applicableFormIds']) <= form_ids, 'project config references unknown DOUL form')

    media = instance['mediaPolicy']
    require(set(media['allowedModes']) <= ALLOWED_MEDIA_MODES, 'unknown media analysis mode')
    require(media['externalTransferPolicy'] in ALLOWED_TRANSFER, 'unknown external transfer policy')
    require(media['autoRetry']['maxAttempts'] >= 0, 'negative retry count')
    require(all(x >= 0 for x in media['autoRetry']['backoffSeconds']), 'negative retry backoff')
    if media['enabled']:
        require(media['allowedModes'], 'enabled media policy requires at least one mode')

    scenario_ids = {x['id'] for x in load('app/schema/implementation_acceptance_catalog_v1.json')['scenarios']}
    require(set(instance['acceptanceScenarioIds']) <= scenario_ids, 'project config references unknown acceptance scenario')
    return True


def validate_change_record(instance):
    schema = load('app/schema/product_change_record_contract_v1.json')
    require(isinstance(instance, dict), 'change record must be an object')
    required = set(schema['required'])
    allowed = set(schema['properties'])
    require(required <= set(instance), 'change record missing required fields')
    require(set(instance) <= allowed, 'change record contains unknown fields')
    validate_schema(instance, schema)
    require(re.fullmatch(r'PCR-[0-9]{4}-[0-9]{3,}', instance['changeId']) is not None, 'invalid changeId')
    require(instance['changeClass'] in {'C0', 'C1', 'C2', 'C3'}, 'invalid change class')
    require(instance['compatibility'] in {'no_semantic_change', 'backward_compatible', 'migration_required', 'breaking'}, 'invalid compatibility')
    require(instance['decision'] in {'approved', 'rejected', 'deferred'}, 'invalid change decision')
    parse_datetime(instance['effectiveFrom'])
    if instance['migrationRequired']:
        require(bool(instance.get('migrationPlanRef')), 'migrationRequired requires migrationPlanRef')
    if instance['changeClass'] == 'C3':
        require(instance['compatibility'] in {'migration_required', 'breaking'}, 'C3 must be migration_required or breaking')

    form_ids = {x['id'] for x in load('app/forms/form_catalog.json')['forms']}
    require(set(instance.get('impactedForms', [])) <= form_ids, 'change record references unknown form')
    scenario_ids = {x['id'] for x in load('app/schema/implementation_acceptance_catalog_v1.json')['scenarios']}
    require(set(instance['acceptanceScenarioIds']) <= scenario_ids, 'change record references unknown acceptance scenario')
    return True


def validate_examples():
    validate_project_config(load('app/reference/project_configuration_pack_example_v1.json'))
    validate_change_record(load('app/reference/product_change_record_example_v1.json'))
    return {'projectConfiguration': 'PASS', 'productChangeRecord': 'PASS'}


if __name__ == '__main__':
    try:
        print(json.dumps(validate_examples(), ensure_ascii=False))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc
