"""Product input-schema tests only; not persistence or API acceptance."""
from copy import deepcopy
import json
from pathlib import Path
import unittest
from uuid import uuid4

from app.reference.validation import ContractError, validate

ROOT = Path(__file__).resolve().parents[1]


class ScheduleSourceImportSchemaTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads((ROOT / 'app/schema/schedule_source_import_contract_v1.json').read_text())
        self.schemas = json.loads((ROOT / 'app/schema/domain_schemas_v2.json').read_text())['components']['schemas']
        self.schemas.update(self.contract['schemas'])
        new_id = lambda: str(uuid4())
        self.package = dict(
            roleAssignmentId=new_id(), clientObjectId=new_id(), title='공정 원본',
            scope=dict(packageId=new_id(), locationId=new_id(), discipline='ARCH', responsibleOrganizationId=new_id()),
            sourceEvidenceRef=dict(objectType='Evidence', objectId=new_id(), version=1),
            inputMode='normalized_json', parserVersion='doul-normalized-json-v1',
            schedule=dict(scheduleNo='BL-01', scheduleKind='baseline', revision='B0', sourceFileRef=new_id(),
                          sourceFormat='json', sourceFileHash='a'*64, sourceFileVersion='B0'),
            activities=[dict(clientObjectId=new_id(), data=dict(activityId='A1', wbsPath='1.0', activityName='주공정', critical=True, percentComplete=0))],
            criticalActivityId='A1',
        )

    def check(self, value):
        validate(value, self.schemas['ScheduleSourceImportPackage'], self.schemas)

    def rejected(self, value):
        with self.assertRaises(ContractError):
            self.check(value)

    def test_valid_typed_package(self):
        self.check(self.package)
        value = deepcopy(self.package)
        value['schedule']['scheduleKind'] = 'progress_update'
        value['schedule']['baselineScheduleRef'] = dict(objectType='InformationItem', objectId=str(uuid4()), version=7)
        self.check(value)  # Semantic effective/state validation belongs to Backend acceptance.

    def test_server_owned_identity_and_state_cannot_be_injected(self):
        for field in ['status', 'projectId', 'version', 'expectedVersion']:
            value = deepcopy(self.package); value[field] = 1
            self.rejected(value)
        for field in ['activityCount', 'criticalPathRef', 'importedAt', 'variance', 'approvalRef']:
            value = deepcopy(self.package); value['schedule'][field] = 1
            self.rejected(value)
        for field in ['sourceScheduleRef', 'predecessorRefs', 'successorRefs']:
            value = deepcopy(self.package); value['activities'][0]['data'][field] = []
            self.rejected(value)

    def test_original_activity_logic_is_portable_string_ids(self):
        value = deepcopy(self.package)
        value['activities'][0]['predecessorActivityIds'] = ['A0']
        self.check(value)  # Dangling ID rejection is an explicit application acceptance gate.
        value['activities'][0]['predecessorActivityIds'] = [dict(objectId=str(uuid4()))]
        self.rejected(value)

    def test_empty_and_badly_typed_activities_rejected(self):
        value = deepcopy(self.package); value['activities'] = []; self.rejected(value)
        for field, bad in [('percentComplete', '100'), ('percentComplete', 101), ('critical', 'true'), ('remainingDuration', -1)]:
            value = deepcopy(self.package); value['activities'][0]['data'][field] = bad; self.rejected(value)

    def test_unsupported_parser_or_kind_rejected(self):
        for field in ['inputMode', 'parserVersion']:
            value = deepcopy(self.package); value[field] = 'xer-auto'; self.rejected(value)
        value = deepcopy(self.package); value['schedule']['scheduleKind'] = 'lookahead'; self.rejected(value)

    def test_exact_version_reference_required(self):
        value = deepcopy(self.package); del value['sourceEvidenceRef']['version']; self.rejected(value)
        value = deepcopy(self.package); value['sourceEvidenceRef']['version'] = '1'; self.rejected(value)
        value = deepcopy(self.package); value['sourceEvidenceRef']['objectType'] = 'InformationItem'; self.rejected(value)
        value = deepcopy(self.package); value['schedule']['sourceFileHash'] = 'fake'; self.rejected(value)


if __name__ == '__main__':
    unittest.main()
