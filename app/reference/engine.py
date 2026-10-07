"""Dependency-free, in-memory command execution for the supervision contracts.

The runner is a reference for DB/API implementations, not a deployed service.
The application must supply an authenticated party ID; role IDs are resolved from
trusted storage, never accepted as caller-provided authority objects. Transactions,
locks, authentication, durable files and media workers need production adapters.
"""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_EVEN, ROUND_HALF_UP, ROUND_UP
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from .validation import ContractError, instant, require, validate

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT/path).read_text())


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def uid():
    return str(uuid4())


class Engine:
    def __init__(self, now=None):
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.machines = load('schema/state_machines_v1.json')['machines']
        self.machine_bindings = load('reference/machine_bindings_v1.json')['machines']
        self.policies = load('schema/authority_matrix_v1.json')['policies']
        self.schemas = load('schema/domain_schemas_v2.json')['components']['schemas']
        self._records = {}
        self._history = {}
        self._audit = []
        self._idempotency = {}
        self._record_machines = {}
        self._notifications = {}
        self._escalation_keys = set()

    def at(self):
        value = self.now()
        require(value.tzinfo is not None, 'CLOCK_INVALID', 'Clock must have timezone')
        return value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')

    def bootstrap(self, kind, data):
        """Trusted migration/fixture adapter; never expose as HTTP CRUD."""
        value = deepcopy(data)
        value.setdefault('version', 1)
        value.setdefault('createdAt', self.at())
        value.setdefault('updatedAt', self.at())
        value.setdefault('createdBy', value.get('partyId', value['id']))
        validate(value, self.schemas[kind], self.schemas)
        key = kind, value['id']
        require(key not in self._records, 'OBJECT_EXISTS', str(key))
        self._save(kind, value)
        return deepcopy(value)

    def _save(self, kind, value):
        require(not any(i==value['id'] and k!=kind for k,i in self._records), 'IDENTITY_COLLISION', 'Identifiers must be globally unique')
        key = kind, value['id']
        self._records[key] = deepcopy(value)
        self._history[key + (value['version'],)] = deepcopy(value)

    def get(self, kind, object_id, version=None):
        source = self._history if version is not None else self._records
        key = (kind, object_id, version) if version is not None else (kind, object_id)
        require(key in source, 'OBJECT_NOT_FOUND', str(key))
        value=deepcopy(source[key])
        if version is None and kind=='WorkItem' and value.get('subtype')=='SafetyEquipmentInspection':
            if value.get('data',{}).get('equipmentAvailable') is True and not self._equipment_documents_current(value):
                value['data']['equipmentAvailable']=False
        return value

    def resolve(self, reference, project_id=None):
        record = self.get(reference['objectType'], reference['objectId'], reference['version'])
        if project_id:
            require(record['projectId'] == project_id, 'PROJECT_MISMATCH', 'Reference belongs to another project')
        return record

    def _current_reference(self, reference, project_id, *, object_type=None, subtype=None):
        require(isinstance(reference, dict), 'REFERENCE_INVALID', 'Domain reference must be an object')
        if object_type is not None:
            require(reference.get('objectType') == object_type, 'REFERENCE_TYPE_INVALID', object_type)
        resolved = self.resolve(reference, project_id)
        current = self.get(reference['objectType'], reference['objectId'])
        require(current['version'] == reference['version'], 'REFERENCE_STALE', reference['objectId'])
        if subtype is not None:
            require(resolved.get('subtype') == subtype, 'REFERENCE_TYPE_INVALID', subtype)
        return current

    def _scope(self, values, target, location=False):
        if '*' in values:
            return True
        if target in values:
            return True
        if location and target:
            seen = set()
            while target and target not in seen:
                seen.add(target)
                parent = self._records.get(('Location', target), {}).get('parentId')
                if parent in values:
                    return True
                target = parent
        return False

    def authorize(self, record, authority, party_id, role_id, *, qualification=None):
        require(authority in self.policies, 'NOT_AUTHORIZED', 'Unknown authority')
        role = self.get('RoleAssignment', role_id)
        policy = self.policies[authority]
        require(role['partyId'] == party_id, 'NOT_AUTHORIZED', 'Role does not belong to authenticated party')
        require(role['projectId'] == record['projectId'], 'PROJECT_MISMATCH', 'Project assignment mismatch')
        require(role['active'] and instant(role['validFrom']) <= instant(self.at()) < instant(role['validTo']), 'ASSIGNMENT_EXPIRED', 'Inactive or out of deployment period')
        require(role['actorGroup'] in policy['actor_groups'] and authority in role['authorityCodes'], 'NOT_AUTHORIZED', authority)
        require(not policy['role_codes'] or role['roleCode'] in policy['role_codes'], 'NOT_AUTHORIZED', 'Role code cannot perform this duty')
        if policy['official']:
            require(role['actorGroup'] not in ['AI','SYSTEM','INTEGRATION'], 'NONHUMAN_OFFICIAL_DENIED', 'Human official authority required')
        for dimension, field, needed in [('disciplines','discipline',policy['discipline_scope_required']),('packageIds','packageId',policy['package_scope_required']),('locationIds','locationId',policy['location_scope_required'])]:
            if needed:
                require(self._scope(role[dimension], record.get(field), dimension == 'locationIds'), 'SCOPE_MISMATCH', field)
        if policy['contractor_organization_scope'] and role['actorGroup'] == 'CON':
            require(record.get('responsibleOrganizationId') == role['organizationId'], 'ORGANIZATION_MISMATCH', 'Contractor can act only on its assigned work')
        if qualification is True or (qualification is None and policy['qualification_required']):
            self._qualified(record, role)
        # Technical approvals cannot be made by a commercial owner assignment.
        if authority == 'approve_target':
            target=self.resolve(record['targetRef'],record['projectId'])
            for dimension,field in [('disciplines','discipline'),('packageIds','packageId'),('locationIds','locationId')]:
                require(self._scope(role[dimension],target.get(field),dimension=='locationIds'),'SCOPE_MISMATCH','Approval target '+field)
            if record.get('approvalKind') == 'technical':
                require(role['actorGroup']=='SUP', 'NOT_AUTHORIZED', 'Technical approval requires supervisor')
                self._qualified(target, role)
            else:
                require(role['actorGroup']=='OWN', 'NOT_AUTHORIZED', 'Commercial approval requires owner')
        return role

    def _qualified(self, record, role):
        minimum = record.get('minimumQualificationRank')
        require(isinstance(minimum, int) and not isinstance(minimum, bool) and 1 <= minimum <= 3, 'QUALIFICATION_RULE_MISSING', 'Project must define required qualification rank')
        project=self.get('Project',record['projectId'])
        rules=[r['minimumRank'] for r in project.get('qualificationRules',[]) if r['discipline'] in [record.get('discipline'),'*']]
        require(bool(rules),'QUALIFICATION_RULE_MISSING','Trusted project classification must define the discipline qualification rule')
        minimum=min([minimum]+rules)
        eligible = []
        for qualification_id in role['qualificationIds']:
            q = self.get('Qualification', qualification_id)
            if q['partyId']==role['partyId'] and q['projectId']==record['projectId'] and q['verified'] and not q['revoked'] and q['rank'] <= minimum and self._scope(q['disciplines'],record.get('discipline')) and instant(q['validFrom']) <= instant(self.at()) < instant(q['validTo']):
                eligible.append(q)
        require(bool(eligible), 'QUALIFICATION_INVALID', 'Verified, current qualification in required discipline/rank is required')
        return eligible

    def authorize_read(self, record, party_id, role_id):
        """Apply the same visibility rules to records and frozen document sources."""
        if record.get('formId'):
            role=self.get('RoleAssignment',role_id)
            sources=record['sourcePayload']['sources']
            require(bool(sources),'NOT_FOUND','Document has no readable source')
            for source in sources:
                require(source['record']['projectId']==record['projectId'],'PROJECT_MISMATCH','Document source project mismatch')
                role=self.authorize_read(source['record'],party_id,role_id)
            return role
        role=self.authorize(record,'render_document',party_id,role_id)
        if record.get('subtype')=='Report':
            require(role['actorGroup'] in ['SUP','ADM'] or record['status'] not in ['draft','review'], 'NOT_FOUND','Internal report unavailable')
            if role['actorGroup']=='OWN':
                require(party_id in record['report']['recipients'],'NOT_FOUND','Report unavailable to this recipient')
        if self._record_machines.get(('AnalysisRun',record['id']))=='analysis_run':
            require(role['actorGroup'] in ['SUP','ADM'],'NOT_FOUND','Internal analysis run unavailable')
        if record.get('source') in ['ai','supervisor'] and record.get('status') in ['candidate','under_review']:
            require(role['actorGroup'] in ['SUP','ADM'],'NOT_FOUND','Internal observation unavailable')
        return role

    def _common(self, record, role, *, allow_stale_baseline=False):
        requirements = record.get('requirementRefs', [])
        for check in record.get('checkResults', []):
            require(check['requirementRef'] in requirements, 'REQUIREMENT_STALE', 'Check must use the inspection baseline')
        for reference in ([] if allow_stale_baseline else requirements):
            r = self.resolve(reference, record['projectId'])
            current = self.get('Requirement', r['id'])
            require(reference['objectType']=='Requirement' and current['version']==reference['version'] and r['status']=='active', 'REQUIREMENT_STALE', r['id'])
            require(instant(r['effectiveFrom']) <= instant(self.at()) and ('effectiveTo' not in r or instant(self.at()) < instant(r['effectiveTo'])), 'REQUIREMENT_STALE', 'Requirement outside effective period')
        if record.get('drawingRef') and not allow_stale_baseline:
            drawing = self.resolve(record['drawingRef'],record['projectId'])
            current = self.get('InformationItem',drawing['id'])
            require(drawing.get('subtype')=='Drawing' and drawing.get('status')=='approved' and current['version']==drawing['version'], 'DRAWING_STALE', drawing['id'])
        for evidence_id in record.get('evidenceIds', []):
            self._evidence_access(evidence_id, record, role)
        for check in record.get('checkResults', []):
            for evidence_id in check['evidenceIds']:
                self._evidence_access(evidence_id, record, role)
        for grounding in record.get('grounding',[])+record.get('verificationGrounding',[]):self._evidence_access(grounding['evidenceId'],record,role)
        for evidence_id in record.get('sourceEvidenceIds',[]):self._evidence_access(evidence_id,record,role)
        for inspection_id in record.get('upstreamInspectionIds', []):
            inspection = self.get('Inspection', inspection_id)
            require(inspection['projectId']==record['projectId'] and inspection.get('nextWorkAllowed') is True, 'HOLD_NOT_RELEASED', inspection_id)

    def _evidence_access(self, evidence_id, record, role):
            evidence = self.get('Evidence', evidence_id)
            require(evidence['projectId']==record['projectId'], 'EVIDENCE_INVALID', 'Cross-project evidence')
            for field,scope in [('discipline','disciplines'),('packageId','packageIds'),('locationId','locationIds')]:
                require(self._scope(role[scope], evidence.get(field), field=='locationId'), 'EVIDENCE_INVALID', 'Evidence outside assigned scope')
            if role['actorGroup']=='CON':
                require(evidence.get('responsibleOrganizationId')==role['organizationId'], 'EVIDENCE_INVALID', 'Evidence outside contractor organization')
            if evidence['sourceType']=='derived':
                self._check_derivation(evidence)

    def create(self, machine, object_id, project_id, payload, party_id, role_id, key):
        require(machine in self.machines, 'MACHINE_UNKNOWN', machine)
        require('sourceImport' not in payload.get('metadata',{}), 'IMMUTABLE_FIELD', 'Source import provenance is server-managed')
        require(not set(payload)&{'id','projectId','version','createdAt','updatedAt','createdBy','status'}, 'IMMUTABLE_FIELD', 'Server-managed fields cannot be supplied')
        kind = self.machines[machine]['object_type']
        request = dict(machine=machine,id=object_id,projectId=project_id,payload=payload,role=role_id)
        record = dict(deepcopy(payload),id=object_id,projectId=project_id,version=1,createdAt=self.at(),updatedAt=self.at(),createdBy=party_id,status=self.machines[machine]['initial'])
        if self.machines[machine]['subtype']:
            record['subtype']=self.machines[machine]['subtype']
        authority = self.machine_bindings[machine]['create_authority']
        validate(record,self.schemas[kind],self.schemas)
        if kind=='WorkItem':require(not set(record['data']) & set(record), 'IMMUTABLE_FIELD', 'WorkItem data cannot shadow identity or state')
        role = self.authorize(record,authority,party_id,role_id)
        cached = self._replay(project_id,party_id,'create:'+machine,key,request)
        if cached is not None:return cached
        require((kind,object_id) not in self._records,'OBJECT_EXISTS',object_id)
        if machine=='analysis_run':
            self._analysis_inspection_context(record)
        self._common(record,role)
        if machine=='inspection':
            require(record['nextWorkAllowed'] is False and not set(record)&{'resultStatus','acceptanceDocumentId','approvalId'}, 'IMMUTABLE_FIELD', 'Inspection starts unreleased without result')
            require(bool(record.get('requirementRefs')) and bool(record.get('drawingRef')), 'INSPECTION_PACKAGE_COMPLETE', 'Inspection needs a requirement baseline and drawing')
            if record.get('relatedIssueId'):
                issue=self.get('Issue',record['relatedIssueId'])
                self._verification_link(record,issue)
        if machine=='issue':
            require(record['correctionCycle']==0 and not set(record)&{'closedBy','closureEvidenceIds'}, 'IMMUTABLE_FIELD', 'Issue starts in correction cycle zero')
            require(bool(record['observationIds']), 'OBSERVATION_REQUIRED', 'Official issue needs a verified observation')
            for oid in record['observationIds']:
                observation=self.get('Observation',oid)
                require(observation['projectId']==project_id and observation['status']=='confirmed', 'OBSERVATION_UNVERIFIED', oid)
                self.authorize(observation,'confirm_observation',party_id,role_id)
                require(any(g['channel']!='speech' and g['claimSupport']=='observed' for g in observation['grounding']+observation.get('verificationGrounding',[])), 'CLAIM_UNCORROBORATED', 'An oral allegation alone cannot become an official defect finding')
        if machine=='observation':
            require(not set(record)&{'confirmedBy','confirmedAt','verificationGrounding'}, 'IMMUTABLE_FIELD', 'Confirmation is a human command')
            require((role['actorGroup']=='AI') == (record['source']=='ai'), 'SOURCE_ACTOR_MISMATCH', 'AI source cannot be impersonated or concealed')
            self._observation_grounded(record)
        if machine=='approval':
            require(record['requestedBy']==party_id,'REQUESTER_MISMATCH','Requester must be authenticated party')
            self.resolve(record['targetRef'],project_id)
        if machine=='action' and record.get('relatedIssueId'):
            issue=self.get('Issue',record['relatedIssueId'])
            require(issue['projectId']==project_id and record.get('responsibleOrganizationId')==issue.get('responsibleOrganizationId'), 'ACTION_SCOPE_MISMATCH','Action belongs to the issue contractor')
            require('correctionCycle' not in record or record['correctionCycle']==issue['correctionCycle'],'ACTION_SCOPE_MISMATCH','Action belongs to current correction cycle')
            record['correctionCycle']=issue['correctionCycle']
        if machine=='safety_permit':
            for field in ['workAuthorized','receivedAt','reviewStartedAt','authorizedAt','activatedAt','suspendedAt','resumeRequestAt','completedAt']:
                require(field not in record['data'], 'IMMUTABLE_FIELD', field+' is server-derived')
            record['data']['workAuthorized']=False
        if machine=='safety_stop_order':
            for field in ['acknowledgedAt','resumeRequestAt','resumeGate','liftedAt','closedAt']:
                require(field not in record['data'], 'IMMUTABLE_FIELD', field+' is server-derived')
            require(bool(record.get('evidenceIds')), 'EVIDENCE_REQUIRED', 'A formal stop order requires preserved hazard evidence')
        if machine=='safety_equipment_inspection':
            for field in ['equipmentAvailable','requestedAt']:
                require(field not in record['data'], 'IMMUTABLE_FIELD', field+' is server-derived')
            record['data']['equipmentAvailable']=False
        if machine in ['schedule_baseline','schedule_progress']:
            schedule=record['schedule']
            expected_kind='baseline' if machine=='schedule_baseline' else 'progress_update'
            require(schedule.get('scheduleKind')==expected_kind,'SCHEDULE_KIND_INVALID',expected_kind)
            require(schedule.get('revision')==record.get('revision'),'SCHEDULE_REVISION_MISMATCH','InformationItem and Schedule revisions must match')
            for field in ['importedAt','submittedAt','reviewedAt','acceptedAt','effectiveAt','frozenAt','supersedesRef']:
                require(field not in schedule,'IMMUTABLE_FIELD',field+' is server-derived')
            require('variance' not in schedule,'IMMUTABLE_FIELD','Schedule variance is server-derived')
            if machine=='schedule_baseline':
                require(not any(field in schedule for field in ['approvalRef','ownerDecisionRef','actualsVerified','forecastVerified','criticalPathReviewed','varianceExplained']),'IMMUTABLE_FIELD','Baseline decisions and verification fields are command-derived')
            else:
                require(not any(field in schedule for field in ['approvalRef','ownerDecisionRef','actualsVerified','forecastVerified','criticalPathReviewed','varianceExplained']),'IMMUTABLE_FIELD','Progress verification fields are supervisor-derived')
            schedule['importedAt']=self.at()
            if machine=='schedule_progress':schedule['submittedAt']=self.at()
        if machine=='delay_event':
            for field in ['notifiedAt','assessmentStartedAt','impactAnalysisStartedAt','mitigationStartedAt','monitoringStartedAt','resolvedAt','transferredAt','closedAt']:
                require(field not in record['data'],'IMMUTABLE_FIELD',field+' is server-derived')
            require('reviewedAt' not in record['data'].get('impactAnalysis',{}),'IMMUTABLE_FIELD','Impact analysis reviewedAt is server-derived')
        if machine=='recovery_plan':
            for field in ['requestedAt','submittedAt','reviewedAt','acceptedAt','activatedAt','monitoringStartedAt','completedAt','effectivenessResult']:
                require(field not in record['data'],'IMMUTABLE_FIELD',field+' is server-derived')
            record['data']['requestedAt']=self.at()
        if machine=='contract_notice':
            for field in ['dueCalculationConfirmed','timeBarRisk','timeBarRiskAt','submittedAt','acknowledgedAt','preservedAt','closedAt']:
                require(field not in record['data'],'IMMUTABLE_FIELD',field+' is server-derived')
            record['data']['dueCalculationConfirmed']=False
            record['data']['timeBarRisk']=False
        if machine=='claim':
            for field in ['decisionOutcome','submittedAt','receivedAt','reviewedAt','decisionAt','settledAt','closedAt']:
                require(field not in record['data'],'IMMUTABLE_FIELD',field+' is server-derived')
        if machine=='eot_request':
            for field in ['decisionOutcome','baselineRevisionBasisRef','submittedAt','receivedAt','timeImpactReviewedAt','entitlementReviewedAt','decisionAt','baselineUpdateRequestedAt','closedAt']:
                require(field not in record['data'],'IMMUTABLE_FIELD',field+' is server-derived')
        if machine=='contract_boq':
            boq=record['boq']
            for field in ['supersedesRef','ownerDecisionRef','submittedAt','reviewedAt','approvedAt','effectiveAt']:
                require(field not in boq,'IMMUTABLE_FIELD',field+' is server-derived or command-controlled')
            boq.setdefault('revision',record['revision'])
            require(boq['revision']==record['revision'],'BOQ_REVISION_MISMATCH','InformationItem and ContractBOQ revisions must match')
        if machine=='quantity_measurement':
            data=record['data']
            for field in ['eligibilityStatus','paymentEligible','blockedReasons','cumulativeVerifiedQuantity','blockedQuantity','submittedAt','receivedAt','fieldVerifiedAt','technicallyReviewedAt','verifiedAt']:
                require(field not in data,'IMMUTABLE_FIELD',field+' is server-derived')
            data.update(eligibilityStatus='pending',paymentEligible=False,blockedReasons=[])
        if machine=='payment_claim':
            data=record['data']
            for field in ['verifiedGrossAmount','eligibleVariationAmount','unapprovedVariationAmount','recommendedNetAmount','ownerApprovedAmount','paidAmount','unpaidBalance','blockedReasons','recommendationSnapshot','calculationTrace','paymentRecords','paymentAmount','supersedesPaymentRecordId','correctionReason','approvalRef','decisionRefs','recommendationRef','recordedBy','cumulativeCertifiedAmount','cumulativePaidAmount','paymentReference','externalSystemRef','paidAt','submittedAt','receivedAt','reviewedAt','recommendedAt','ownerDecidedAt','paymentRecordedAt','closedAt']:
                require(field not in data,'IMMUTABLE_FIELD',field+' is command-controlled or server-derived')
            data.update(paymentRecords=[],paidAmount='0')
        validate(record,self.schemas[kind],self.schemas)
        if machine=='schedule_progress':self._schedule_progress_submission_complete(self._fields(record))
        if machine=='delay_event':self._delay_event_create_ready(self._fields(record))
        if machine=='recovery_plan':self._recovery_request_ready(self._fields(record))
        if machine=='contract_notice':self._contract_notice_identify_ready(self._fields(record))
        if machine=='safety_stop_order':
            return self._create_safety_stop_order(record,request,party_id,role_id,key)
        self._save(kind,record)
        self._record_machines[(kind,object_id)]=machine
        result=self._event(record,'create:'+machine,party_id,role_id,key,request,None)
        self._remember(project_id,party_id,'create:'+machine,key,request,result)
        return result

    def _create_safety_stop_order(self, record, request, party_id, role_id, key):
        stop_ref={'objectType':'WorkItem','objectId':record['id'],'version':record['version']}
        now=self.at()
        permit_updates=[]
        seen=set()
        for reference in record['data']['affectedPermitRefs']:
            permit=self._current_reference(reference,record['projectId'],object_type='WorkItem',subtype='SafetyPermit')
            require(permit['id'] not in seen,'REFERENCE_DUPLICATE',permit['id'])
            seen.add(permit['id'])
            updated=deepcopy(permit)
            updated['data'].setdefault('stopOrderRefs',[]).append(deepcopy(stop_ref))
            updated['data']['workAuthorized']=False
            if updated['status'] in ['authorized','active']:
                updated['status']='suspended'
                updated['data']['suspendedAt']=now
                updated['data']['suspensionReason']=record['data']['stopReason']
            updated['version']=permit['version']+1
            updated['updatedAt']=now
            validate(updated,self.schemas['WorkItem'],self.schemas)
            permit_updates.append((permit,updated))

        snapshot=(
            deepcopy(self._records),
            deepcopy(self._history),
            deepcopy(self._audit),
            deepcopy(self._idempotency),
            deepcopy(self._record_machines),
        )
        try:
            self._save('WorkItem',record)
            self._record_machines[('WorkItem',record['id'])]='safety_stop_order'
            result=self._event(record,'create:safety_stop_order',party_id,role_id,key,request,None)
            for before,updated in permit_updates:
                self._save('WorkItem',updated)
                self._event(updated,'safety_stop_order:issue_stop',party_id,role_id,key,request,before)
            self._remember(record['projectId'],party_id,'create:safety_stop_order',key,request,result)
            return result
        except Exception:
            self._records,self._history,self._audit,self._idempotency,self._record_machines=snapshot
            raise

    def execute(self, machine, object_id, command, expected_version, payload, evidence_ids, party_id, role_id, key):
        require(machine in self.machines,'MACHINE_UNKNOWN',machine)
        kind=self.machines[machine]['object_type'];record=self.get(kind,object_id)
        require(self._record_machines.get((kind,object_id))==machine,'MACHINE_MISMATCH','Object subtype/machine mismatch')
        request=dict(machine=machine,id=object_id,command=command,expectedVersion=expected_version,payload=payload,evidenceIds=evidence_ids,role=role_id)
        all_options=[t for t in self.machines[machine]['transitions'] if t['command']==command]
        require(bool(all_options),'TRANSITION_INVALID',command)
        self.authorize(record,all_options[0]['authority'],party_id,role_id)
        cached=self._replay(record['projectId'],party_id,machine+':'+command,key,request)
        if cached is not None:return cached
        if record['version']!=expected_version:
            raise ContractError('VERSION_CONFLICT',f'Expected {expected_version}; current {record["version"]}',current_version=record['version'])
        options=[t for t in self.machines[machine]['transitions'] if t['from']==record['status'] and t['command']==command]
        require(len(options)==1,'TRANSITION_INVALID',f'{machine}/{record["status"]}/{command}')
        transition=options[0]
        require(not set(payload)-set(transition['payload_fields']),'COMMAND_FIELD_INVALID','Only command-specific fields are writable')
        if machine=='delay_event' and command=='start_mitigation' and isinstance(payload.get('impactAnalysis'),dict):
            require('reviewedAt' not in payload['impactAnalysis'],'IMMUTABLE_FIELD','Impact analysis reviewedAt is server-derived')
        require(set(transition.get('required_payload_fields',[]))<=set(payload),'COMMAND_FIELD_REQUIRED','Required command fields are missing')
        if record.get('metadata',{}).get('sourceImport'):
            source_contract=load('schema/schedule_source_import_contract_v1.json')
            for field in source_contract['immutability']['source_content_fields']:
                if field in payload:
                    require(payload[field]==record['schedule'].get(field), 'IMMUTABLE_FIELD', 'Imported source content requires a new source package: '+field)
        proposed=deepcopy(record)
        target=proposed.setdefault('data',{}) if kind=='WorkItem' else proposed['report'] if machine=='report' else proposed['schedule'] if machine in ['schedule_baseline','schedule_progress'] else proposed['boq'] if machine=='contract_boq' else proposed
        for field,value in payload.items():
            if machine in ['schedule_baseline','schedule_progress']:
                if field=='revision':
                    proposed['revision']=deepcopy(value);target['revision']=deepcopy(value);continue
                destination=target if field in self.schemas['ScheduleData']['properties'] else proposed
            elif machine=='contract_boq':
                destination=target if field in self.schemas['ContractBOQData']['properties'] else proposed
            else:
                destination=proposed if kind=='WorkItem' and field in self.schemas[kind]['properties'] else target
            destination[field]=deepcopy(value)
        if machine=='issue':
            for field in ['inspectionIds','actionIds']:
                if field in payload:require(set(record[field])<=set(payload[field]), 'HISTORY_REMOVAL_DENIED', 'Retain all previous inspections and actions')
        proposed['evidenceIds']=list(dict.fromkeys(proposed.get('evidenceIds',[])+evidence_ids))
        validate(proposed,self.schemas[kind],self.schemas)
        role=self.authorize(proposed,transition['authority'],party_id,role_id)
        self._common(proposed,role,allow_stale_baseline=machine=='inspection' and command in ['receive','return'])
        for guard in transition['guards']:
            if guard not in ['assignment_authorized','expected_version_matches','requirement_versions_current','evidence_provenance_valid','drawing_revision_current','upstream_hold_points_released']:
                self._guard(guard,proposed,payload,party_id)
        if machine=='report' and command=='acknowledge':require(party_id in record['report']['recipients'], 'RECIPIENT_MISMATCH', 'Only an issued recipient may acknowledge')
        if transition['required_evidence']:
            require(bool(evidence_ids),'EVIDENCE_REQUIRED','Transition requires current command evidence')
        self._effects(machine,command,proposed,party_id,role_id,evidence_ids,payload)
        proposed.update(status=transition['to'],version=record['version']+1,updatedAt=self.at())
        if machine=='schedule_baseline' and command=='activate_baseline':
            return self._activate_schedule_baseline(record,proposed,request,party_id,role_id,key)
        if machine=='schedule_progress' and command=='freeze_progress':
            return self._freeze_schedule_progress(record,proposed,request,party_id,role_id,key)
        if machine=='contract_boq' and command=='activate_boq':
            return self._activate_contract_boq(record,proposed,request,party_id,role_id,key)
        validate(proposed,self.schemas[kind],self.schemas)
        self._save(kind,proposed)
        result=self._event(proposed,machine+':'+command,party_id,role_id,key,request,record)
        self._remember(record['projectId'],party_id,machine+':'+command,key,request,result)
        return result

    def _replay(self, project_id, party_id, command, key, request):
        require(isinstance(key,str) and bool(key.strip()),'IDEMPOTENCY_REQUIRED','Idempotency key is required')
        request_hash=digest(request)
        cached=self._idempotency.get((project_id,party_id,command,key))
        if cached:
            require(cached[0]==request_hash,'IDEMPOTENCY_CONFLICT','Key reused with different request')
            return deepcopy(cached[1])
        return None

    def _remember(self, project_id, party_id, command, key, request, result):
        self._idempotency[(project_id,party_id,command,key)]=(digest(request),deepcopy(result))

    def _event(self, record, command, party_id, role_id, key, request, before):
        kinds=[k for k,i in self._records if i==record['id']]
        require(len(kinds)==1, 'IDENTITY_COLLISION', 'Identifiers must be globally unique')
        kind=kinds[0]
        event=dict(id=uid(),projectId=record['projectId'],objectRef=dict(objectType=kind,objectId=record['id'],version=record['version']),command=command,actorPartyId=party_id,roleAssignmentId=role_id,at=self.at(),beforeVersion=before['version'] if before else 0,afterVersion=record['version'],idempotencyKey=key,requestHash=digest(request),beforeState=before.get('status','') if before else '',afterState=record.get('status',''))
        validate(event,self.schemas['AuditEvent'],self.schemas);self._audit.append(event)
        return dict(record=deepcopy(record),auditEvent=deepcopy(event))

    def _fields(self, record):
        return {**record.get('data',{}), **record.get('boq',{}), **record}

    def _latest_reinspection(self, issue):
        inspections=[self.get('Inspection',i) for i in issue['inspectionIds']]
        matches=[i for i in inspections if i.get('relatedIssueId')==issue['id'] and i.get('correctionCycle')==issue['correctionCycle']]
        require(bool(matches),'REINSPECTION_REQUIRED','Current correction cycle needs a new inspection')
        return matches[-1]

    def _guard(self, name, record, payload, party_id):
        r=self._fields(record)
        predicates={
            'reason_present':lambda:bool(r.get('reason','').strip()),
            'replacement_present':lambda:bool(r.get('reason','').strip()) and bool(r.get('replacementRef')),
            'self_inspection_complete':lambda:r.get('selfInspectionComplete') is True,
            'inspection_package_complete':lambda:r.get('selfInspectionComplete') is True and all(r.get('precheck',{}).get(x) is True for x in ['drawing','material','test','previous','change']) and bool(r.get('evidenceIds')) and bool(r.get('requirementRefs')) and bool(r.get('drawingRef')),
            'measurement_results_complete':lambda:self._checks_complete(r),
            'all_checks_pass':lambda:bool(r.get('checkResults')) and all(c['result'] in ['pass','not_applicable'] for c in r['checkResults']) and any(c['result']=='pass' for c in r['checkResults']),
            'conditional_allowed':lambda:not r.get('holdPoint') and bool(r.get('conditions')),
            'failure_identified':lambda:any(c['result']=='fail' for c in r.get('checkResults',[])) and bool(r.get('failureReason')),
            'conditions_resolved':lambda:bool(r.get('evidenceIds')),
            'closure_evidence_valid':lambda:self._closure_evidence_valid(r,payload),
            'rfi_response_present':lambda:bool(r.get('response')) and bool(r.get('responseInformationRefs')),
            'change_routed_if_required':lambda:not r.get('changeRequired') or any(x.get('objectType')=='WorkItem' and self.resolve(x,r['projectId']).get('subtype')=='ChangeRequest' for x in r.get('references',[])),
            'impact_complete':lambda:all(x in r.get('impact',{}) for x in ['quality','schedule','cost','permit']),
            'independent_approver':lambda:r.get('requestedBy')!=party_id,
            'approval_expired':lambda:bool(r.get('expiresAt')) and instant(self.at())>=instant(r['expiresAt']),
            'action_evidence_present':lambda:bool(r.get('evidenceIds')) and all(bool(r.get(k)) for k in ['correction','rootCause','preventiveAction']),
            'decision_present':lambda:r.get('decision') in ['approved','rejected','returned'] and bool(r.get('decisionReason')) and bool(r.get('decisionAt')),
            'decision_action_linked':lambda:bool(r.get('actionIds')),
            'report_package_complete':lambda:all(r.get('report',{}).get(x) not in [None,'',[]] for x in ['sourceDomainRefs','recipients','facts','impact','recommendation']),
            'report_due_defined':lambda:bool(r.get('report',{}).get('dueAt')) and bool(r.get('report',{}).get('receiptDueAt')),
            'report_followup_linked':lambda:r.get('report',{}).get('informationOnly') is True or bool(r.get('report',{}).get('actionIds')) or bool(r.get('report',{}).get('decisionIds')),
            'change_verified':lambda:bool(r.get('evidenceIds')),
        }
        checks={
            'observation_grounded':self._observation_grounded,
            'acceptance_signed':self._acceptance_signed,
            'failure_record_signed':self._failure_signed,
            'hold_approval_valid':self._hold_approval_valid,
            'corrective_action_submitted':self._corrective_action_submitted,
            'new_reinspection_linked':self._new_reinspection_linked,
            'reinspection_passed':self._reinspection_passed,
            'reinspection_failed':self._reinspection_failed,
            'approval_target_current':self._approval_target_current,
            'owner_decision_approved':self._owner_decision_approved,
            'approved_information_present':self._approved_information_present,
            'change_approval_valid':self._change_approval_valid,
            'linked_actions_closed':self._linked_actions_closed,
            'report_followup_closed':self._report_followup_closed,
            'analysis_sources_ready':self._analysis_sources_ready,
            'analysis_outputs_grounded':self._analysis_outputs_grounded,
            'action_issue_match':self._action_issue_match,
            'current_actions_verified':self._current_actions_verified,
            'decision_package_complete':self._decision_package_complete,
            'rfi_package_complete':self._rfi_package_complete,
            'permit_submission_complete':self._permit_submission_complete,
            'permit_safety_review_complete':self._permit_safety_review_complete,
            'permit_prestart_verified':self._permit_prestart_verified,
            'permit_authorization_ready':self._permit_authorization_ready,
            'safety_work_authorized':self._safety_work_authorized,
            'safety_suspend_reason_present':self._safety_suspend_reason_present,
            'stop_resume_request_ready':self._stop_resume_request_ready,
            'safety_resume_gate_satisfied':self._safety_resume_gate_satisfied,
            'safety_completion_ready':self._safety_completion_ready,
            'permit_expired':self._permit_expired,
            'stop_correction_started':self._stop_correction_started,
            'stop_resume_verification_ready':self._stop_resume_verification_ready,
            'stop_close_ready':self._stop_close_ready,
            'equipment_inspection_request_complete':self._equipment_inspection_request_complete,
            'equipment_schedule_present':self._equipment_schedule_present,
            'equipment_result_present':self._equipment_result_present,
            'equipment_pass_ready':self._equipment_pass_ready,
            'equipment_fail_ready':self._equipment_fail_ready,
            'equipment_restricted_ready':self._equipment_restricted_ready,
            'equipment_reinspection_ready':self._equipment_reinspection_ready,
            'equipment_expired':self._equipment_expired,
            'schedule_baseline_submission_complete':self._schedule_baseline_submission_complete,
            'schedule_baseline_completeness_passed':self._schedule_baseline_completeness_passed,
            'schedule_baseline_review_passed':self._schedule_baseline_review_passed,
            'schedule_baseline_approval_ready':self._schedule_baseline_approval_ready,
            'schedule_baseline_activation_ready':self._schedule_baseline_activation_ready,
            'schedule_replacement_effective':self._schedule_replacement_effective,
            'schedule_progress_submission_complete':self._schedule_progress_submission_complete,
            'schedule_progress_completeness_passed':self._schedule_progress_completeness_passed,
            'schedule_progress_verification_passed':self._schedule_progress_verification_passed,
            'schedule_progress_freeze_ready':self._schedule_progress_freeze_ready,
            'schedule_replacement_frozen':self._schedule_replacement_frozen,
            'delay_notification_ready':self._delay_notification_ready,
            'delay_assessment_ready':self._delay_assessment_ready,
            'delay_impact_scope_ready':self._delay_impact_scope_ready,
            'delay_mitigation_ready':self._delay_mitigation_ready,
            'delay_monitoring_ready':self._delay_monitoring_ready,
            'delay_resolution_ready':self._delay_resolution_ready,
            'delay_contract_transfer_ready':self._delay_contract_transfer_ready,
            'delay_close_ready':self._delay_close_ready,
            'recovery_submission_complete':self._recovery_submission_complete,
            'recovery_completeness_passed':self._recovery_completeness_passed,
            'recovery_decision_required':self._recovery_decision_required,
            'recovery_acceptance_ready':self._recovery_acceptance_ready,
            'recovery_decision_approved':self._recovery_decision_approved,
            'recovery_activation_ready':self._recovery_activation_ready,
            'recovery_monitoring_ready':self._recovery_monitoring_ready,
            'recovery_effective_evidence':self._recovery_effective_evidence,
            'recovery_ineffective_evidence':self._recovery_ineffective_evidence,
            'recovery_completion_ready':self._recovery_completion_ready,
            'contract_notice_due_ready':self._contract_notice_due_ready,
            'contract_notice_submission_ready':self._contract_notice_submission_ready,
            'contract_notice_ack_ready':self._contract_notice_ack_ready,
            'contract_notice_followup_ready':self._contract_notice_followup_ready,
            'contract_notice_preservation_ready':self._contract_notice_preservation_ready,
            'contract_notice_time_bar_risk_ready':self._contract_notice_time_bar_risk_ready,
            'contract_notice_close_ready':self._contract_notice_close_ready,
            'claim_submission_ready':self._claim_submission_ready,
            'claim_receipt_ready':self._claim_receipt_ready,
            'claim_substantiation_request_ready':self._claim_substantiation_request_ready,
            'claim_entitlement_review_ready':self._claim_entitlement_review_ready,
            'claim_quantum_review_ready':self._claim_quantum_review_ready,
            'claim_decision_request_ready':self._claim_decision_request_ready,
            'claim_approved_decision_ready':self._claim_approved_decision_ready,
            'claim_partially_approved_decision_ready':self._claim_partially_approved_decision_ready,
            'claim_rejected_decision_ready':self._claim_rejected_decision_ready,
            'claim_disputed_decision_ready':self._claim_disputed_decision_ready,
            'claim_settlement_ready':self._claim_settlement_ready,
            'claim_close_ready':self._claim_close_ready,
            'eot_submission_ready':self._eot_submission_ready,
            'eot_receipt_ready':self._eot_receipt_ready,
            'eot_time_review_ready':self._eot_time_review_ready,
            'eot_entitlement_review_ready':self._eot_entitlement_review_ready,
            'eot_decision_request_ready':self._eot_decision_request_ready,
            'eot_approved_decision_ready':self._eot_approved_decision_ready,
            'eot_partially_approved_decision_ready':self._eot_partially_approved_decision_ready,
            'eot_rejected_decision_ready':self._eot_rejected_decision_ready,
            'eot_disputed_decision_ready':self._eot_disputed_decision_ready,
            'eot_baseline_update_ready':self._eot_baseline_update_ready,
            'eot_baseline_revision_confirmed':self._eot_baseline_revision_confirmed,
            'eot_rejected_close_ready':self._eot_rejected_close_ready,
            'boq_submission_ready':self._boq_submission_ready,
            'boq_review_ready':self._boq_review_ready,
            'boq_decision_request_ready':self._boq_decision_request_ready,
            'boq_approved_decision_ready':self._boq_approved_decision_ready,
            'boq_rejected_decision_ready':self._boq_rejected_decision_ready,
            'boq_activation_ready':self._boq_activation_ready,
            'measurement_submission_ready':self._measurement_submission_ready,
            'measurement_receipt_ready':self._measurement_receipt_ready,
            'measurement_field_review_ready':self._measurement_field_review_ready,
            'measurement_technical_review_ready':self._measurement_technical_review_ready,
            'measurement_verification_ready':self._measurement_verification_ready,
            'measurement_dispute_ready':self._measurement_dispute_ready,
            'measurement_resolution_ready':self._measurement_resolution_ready,
            'measurement_supersede_ready':self._measurement_supersede_ready,
            'payment_claim_submission_ready':self._payment_claim_submission_ready,
            'payment_claim_receipt_ready':self._payment_claim_receipt_ready,
            'payment_quantity_review_ready':self._payment_quantity_review_ready,
            'payment_valuation_review_ready':self._payment_valuation_review_ready,
            'payment_recommendation_prepare_ready':self._payment_recommendation_prepare_ready,
            'payment_recommendation_ready':self._payment_recommendation_ready,
            'payment_owner_review_ready':self._payment_owner_review_ready,
            'payment_owner_approval_ready':self._payment_owner_approval_ready,
            'payment_owner_adjustment_ready':self._payment_owner_adjustment_ready,
            'payment_owner_rejection_ready':self._payment_owner_rejection_ready,
            'payment_record_ready':self._payment_record_ready,
            'payment_correction_ready':self._payment_correction_ready,
            'payment_cancellation_ready':self._payment_cancellation_ready,
            'payment_close_ready':self._payment_close_ready,
            'payment_supersede_ready':self._payment_supersede_ready,
        }
        if name in checks:checks[name](r)
        else:
            require(name in predicates,'GUARD_UNIMPLEMENTED',name)
            require(predicates[name](),name.upper(),name)

    def _effects(self, machine, command, record, party_id, role_id, evidence_ids=None, payload=None):
        if machine=='observation' and command=='confirm':record.update(confirmedBy=party_id,confirmedAt=self.at())
        if machine=='inspection':
            result={'pass':'pass','fail':'fail','conditional':'conditional','hold':'hold'}.get(command)
            if result:record['resultStatus']=result
            if command=='release_next_work':record['nextWorkAllowed']=True
            if command=='record_failure':record['nextWorkAllowed']=False
        if machine=='issue' and command=='close':record.update(closedBy=party_id)
        if machine=='issue' and command=='reject_reinspection':record['correctionCycle']+=1
        if machine=='approval' and command=='approve':record.update(approvedBy=party_id,approvedAt=self.at())
        if machine=='report':
            if command=='issue':record['report']['issuedAt']=self.at()
            if command=='acknowledge':record['report'].update(acknowledgedAt=self.at(),acknowledgedBy=party_id)
            if command=='verify':record['report']['verifiedAt']=self.at()
        if machine=='safety_permit':
            data=record['data']
            if command=='receive_permit':data['receivedAt']=self.at()
            if command=='accept_for_safety_review':data['reviewStartedAt']=self.at()
            if command=='authorize':data['authorizedAt']=self.at()
            if command in ['activate','approve_resume']:
                data['workAuthorized']=True
                data['activatedAt']=self.at()
            if command in ['suspend','self_suspend']:data['suspendedAt']=self.at()
            if command=='request_resume':data['resumeRequestAt']=self.at()
            if command in ['suspend','self_suspend','request_resume','return_resume','expire','cancel','complete_work']:
                data['workAuthorized']=False
            if command=='complete_work':data['completedAt']=self.at()
        if machine=='safety_stop_order':
            data=record['data']
            if command=='acknowledge_stop':data['acknowledgedAt']=self.at()
            if command=='request_resume':data['resumeRequestAt']=self.at()
            if command in ['request_resume','start_resume_verification','return_resume','lift_stop']:
                data['resumeGate']=self._derive_stop_resume_gate(record)
            if command=='lift_stop':data['liftedAt']=self.at()
            if command=='close_stop':data['closedAt']=self.at()
        if machine=='safety_equipment_inspection':
            if command in ['request_inspection','request_reinspection']:record['data']['requestedAt']=self.at()
            if command=='pass':record['data']['equipmentAvailable']=True
            if command in ['fail','restrict','require_reinspection','expire']:
                record['data']['equipmentAvailable']=False
        if machine=='schedule_baseline':
            schedule=record['schedule']
            if command in ['submit_baseline','resubmit_baseline']:schedule['submittedAt']=self.at()
            if command in ['start_baseline_review','request_baseline_decision']:schedule['reviewedAt']=self.at()
            if command=='approve_baseline':schedule['acceptedAt']=self.at()
            if command=='activate_baseline':schedule['effectiveAt']=self.at()
        if machine=='schedule_progress':
            schedule=record['schedule']
            if command=='resubmit_progress':schedule['submittedAt']=self.at()
            if command in ['start_progress_verification','accept_progress_for_reporting']:schedule['reviewedAt']=self.at()
            if command=='accept_progress_for_reporting':
                schedule['acceptedAt']=self.at();schedule['variance']=self._derive_schedule_variance(record)
            if command=='freeze_progress':schedule['frozenAt']=self.at()
        if machine=='delay_event':
            data=record['data'];stamp=self.at()
            field={'notify':'notifiedAt','start_assessment':'assessmentStartedAt','start_impact_analysis':'impactAnalysisStartedAt','start_mitigation':'mitigationStartedAt','monitor':'monitoringStartedAt','resolve_event':'resolvedAt','transfer_contract_track':'transferredAt','close_delay_event':'closedAt'}.get(command)
            if field:data[field]=stamp
            if command=='start_mitigation' and data.get('impactAnalysis') is not None:data['impactAnalysis']['reviewedAt']=stamp
        if machine=='recovery_plan':
            data=record['data'];stamp=self.at()
            field={'submit_recovery':'submittedAt','start_recovery_review':'reviewedAt','request_recovery_decision':'reviewedAt','accept_recovery':'acceptedAt','activate_recovery':'activatedAt','start_recovery_monitoring':'monitoringStartedAt','complete_recovery':'completedAt'}.get(command)
            if field:data[field]=stamp
            if command=='mark_recovery_effective':data['effectivenessResult']='effective'
            if command=='mark_recovery_ineffective':data['effectivenessResult']='ineffective'
        if machine=='contract_notice':
            data=record['data'];stamp=self.at()
            if command=='calculate_notice_due':data['dueCalculationConfirmed']=True
            if command=='submit_notice':data['submittedAt']=stamp
            if command=='record_acknowledgement':data['acknowledgedAt']=stamp
            if command=='preserve_rights_record':data['preservedAt']=stamp
            if command=='flag_time_bar_risk':data.update(timeBarRisk=True,timeBarRiskAt=stamp)
            if command=='close_notice':data['closedAt']=stamp
        if machine=='claim':
            data=record['data'];stamp=self.at()
            if command=='submit_claim':data['submittedAt']=stamp
            if command=='receive_claim':data['receivedAt']=stamp
            if command in ['start_entitlement_review','start_quantum_review','request_claim_decision']:data['reviewedAt']=stamp
            outcomes={'approve_claim':'approved','partially_approve_claim':'partially_approved','reject_claim':'rejected','dispute_claim':'disputed'}
            if command in outcomes:data.update(decisionOutcome=outcomes[command],decisionAt=stamp)
            if command=='record_claim_settlement':data['settledAt']=stamp
            if command=='close_claim':data['closedAt']=stamp
        if machine=='eot_request':
            data=record['data'];stamp=self.at()
            if command=='submit_eot':data['submittedAt']=stamp
            if command=='receive_eot':data['receivedAt']=stamp
            if command=='start_time_impact_review':data['timeImpactReviewedAt']=stamp
            if command in ['start_eot_entitlement_review','request_eot_decision']:data['entitlementReviewedAt']=stamp
            outcomes={'approve_eot':'approved','partially_approve_eot':'partially_approved','reject_eot':'rejected','dispute_eot':'disputed','resolve_eot_dispute_approved':'approved','resolve_eot_dispute_partially_approved':'partially_approved','resolve_eot_dispute_rejected':'rejected'}
            if command in outcomes:data.update(decisionOutcome=outcomes[command],decisionAt=stamp)
            if command=='request_baseline_update':
                data['baselineRevisionBasisRef']={'objectType':'WorkItem','objectId':record['id'],'version':record['version']}
                data['baselineUpdateRequestedAt']=stamp
            if command in ['confirm_baseline_update','close_eot']:data['closedAt']=stamp
        if machine=='contract_boq':
            boq=record['boq'];stamp=self.at()
            if command in ['submit_boq','resubmit_boq']:boq['submittedAt']=stamp
            if command in ['start_boq_review','request_boq_decision']:boq['reviewedAt']=stamp
            if command=='approve_boq':boq['approvedAt']=stamp
            if command=='activate_boq':boq['effectiveAt']=stamp
        if machine=='quantity_measurement':
            data=record['data'];stamp=self.at()
            if command in ['submit_measurement','resubmit_measurement']:data['submittedAt']=stamp
            if command=='receive_measurement':data['receivedAt']=stamp
            if command=='start_technical_verification':data['fieldVerifiedAt']=stamp
            if command in ['verify_quantity','mark_measurement_disputed','resolve_measurement']:data['technicallyReviewedAt']=stamp
            if command in ['verify_quantity','resolve_measurement']:
                cumulative=self._decimal_value(data.get('previousCertifiedQuantity','0'))+self._decimal_value(data['verifiedQuantity'])
                blocks=self._measurement_payment_blocks(self._fields(record))
                data['cumulativeVerifiedQuantity']=self._decimal_text(cumulative)
                data['blockedReasons']=blocks
                data['paymentEligible']=not blocks
                data['eligibilityStatus']='eligible' if not blocks else 'blocked'
                data['blockedQuantity']='0' if not blocks else data['verifiedQuantity']
                data['verifiedAt']=stamp
            if command=='mark_measurement_disputed':
                data['eligibilityStatus']='disputed'
                data['paymentEligible']=False
                data['blockedReasons']=['DISPUTED_QUANTITY']
                data['blockedQuantity']=data['disputedQuantity']
        if machine=='payment_claim':
            data=record['data'];stamp=self.at()
            if command in ['submit_payment_claim','resubmit_payment_claim']:data['submittedAt']=stamp
            if command=='receive_payment_claim':data['receivedAt']=stamp
            if command in ['start_quantity_review','start_valuation_review','prepare_recommendation']:data['reviewedAt']=stamp
            if command=='start_valuation_review':
                measurements=self._payment_measurements(self._fields(record),current=False)
                blocks=[]
                for measurement in measurements:
                    md=measurement.get('data',{})
                    if md.get('paymentEligible') is not True:
                        blocks.extend(md.get('blockedReasons') or ['CONTRACT_RULE_NOT_MET'])
                _,unapproved=self._payment_variation_amounts(self._fields(record))
                if unapproved>0:blocks.append('UNAPPROVED_VARIATION')
                data['blockedReasons']=list(dict.fromkeys(blocks))
                data['unapprovedVariationAmount']=self._decimal_text(unapproved)
            if command=='prepare_recommendation':
                _,unapproved=self._payment_variation_amounts(self._fields(record))
                data['unapprovedVariationAmount']=self._decimal_text(unapproved)
                data['calculationTrace']=self._payment_recommendation_calculation(self._fields(record))
            if command=='recommend_payment':
                data['recommendedAt']=stamp
                data['recommendationSnapshot']={
                    'claimBasisRef':{'objectType':'WorkItem','objectId':record['id'],'version':record['version']},
                    'boqRef':deepcopy(data['boqRef']),
                    'measurementRefs':deepcopy(data['quantityMeasurementRefs']),
                    'verifiedGrossAmount':data['verifiedGrossAmount'],
                    'blockedReasons':deepcopy(data.get('blockedReasons',[])),
                    'eligibleVariationAmount':data['eligibleVariationAmount'],
                    'eligibleMaterialOnSiteAmount':data['eligibleMaterialOnSiteAmount'],
                    'retentionAmount':data['retentionAmount'],
                    'advanceRecoveryAmount':data['advanceRecoveryAmount'],
                    'otherDeductionAmount':data['otherDeductionAmount'],
                    'taxAmount':data['taxAmount'],
                    'deductionComponents':deepcopy(data.get('deductionComponents',[])),
                    'recommendedNetAmount':data['recommendedNetAmount'],
                    'currency':data['currency'],
                    'calculationRuleRef':deepcopy(data['calculationRuleRef']),
                    'calculationTrace':deepcopy(data['calculationTrace']),
                    'reviewerPartyId':party_id,
                    'recommendedAt':stamp,
                    **({'reservationComment':data['reservationComment']} if data.get('reservationComment') else {}),
                }
            if command in ['approve_payment','adjust_payment']:
                data['ownerDecidedAt']=stamp
                cumulative=self._decimal_value(data.get('previousCertifiedAmount','0'))+self._decimal_value(data['ownerApprovedAmount'])
                data['cumulativeCertifiedAmount']=self._decimal_text(cumulative)
                boq=self._boq_reference(data['boqRef'],record['projectId'],statuses=['effective','superseded'])
                total=sum((self._decimal_value(line['contractAmount']) for line in boq.get('boq',{}).get('lineItems',[])),Decimal('0'))
                data['remainingContractValue']=self._decimal_text(max(total-cumulative,Decimal('0')))
            if command=='reject_payment':data['ownerDecidedAt']=stamp
            if command in ['record_payment','record_additional_payment','correct_payment_record','cancel_payment_record']:
                payload=payload or {}
                kind='payment' if command in ['record_payment','record_additional_payment'] else 'correction' if command=='correct_payment_record' else 'cancellation'
                amount=self._decimal_value(payload.get('paymentAmount','0'),'PAYMENT_RECORD_READY','paymentAmount') if kind!='cancellation' else Decimal('0')
                item={
                    'recordId':uid(),
                    'kind':kind,
                    'amount':self._decimal_text(amount),
                    'currency':data['currency'],
                    'paidAt':payload['paidAt'],
                    'paymentReference':payload['paymentReference'],
                    'evidenceIds':list(dict.fromkeys(evidence_ids or [])),
                    'recordedBy':party_id,
                    'recordedAt':stamp,
                }
                if payload.get('externalSystemRef'):item['externalSystemRef']=payload['externalSystemRef']
                if payload.get('supersedesPaymentRecordId'):item['supersedesPaymentRecordId']=payload['supersedesPaymentRecordId']
                if payload.get('correctionReason'):item['reason']=payload['correctionReason']
                data.setdefault('paymentRecords',[]).append(item)
                for transient in ['paymentAmount','supersedesPaymentRecordId','correctionReason']:
                    data.pop(transient,None)
                paid=self._payment_active_total(self._fields(record))
                approved=self._decimal_value(data['ownerApprovedAmount'])
                data['paidAmount']=self._decimal_text(paid)
                data['recordedBy']=party_id
                data['paymentRecordedAt']=stamp
                data['paymentReference']=payload['paymentReference']
                data['paidAt']=payload['paidAt']
                if payload.get('externalSystemRef'):data['externalSystemRef']=payload['externalSystemRef']
                else:data.pop('externalSystemRef',None)
                data['unpaidBalance']=self._decimal_text(approved-paid)
                data['cumulativePaidAmount']=self._decimal_text(self._decimal_value(data.get('previousPaidAmount','0'))+paid)
            if command=='close_payment_claim':data['closedAt']=stamp

    def _all_true(self, value, keys):
        return isinstance(value,dict) and all(value.get(key) is True for key in keys)

    def _safety_refs_current(self, record, field, *, object_type=None, subtype=None, allow_empty=True):
        refs=record.get(field)
        if refs is None:return allow_empty
        if not isinstance(refs,list):return False
        if not refs and not allow_empty:return False
        for reference in refs:
            if object_type and reference.get('objectType')!=object_type:return False
            try:resolved=self.resolve(reference,record['projectId'])
            except ContractError:return False
            current=self.get(reference['objectType'],reference['objectId'])
            if current['version']!=reference['version']:return False
            if subtype and resolved.get('subtype')!=subtype:return False
        return True

    def _permit_submission_complete(self,r):
        required=['permitNo','workType','riskLevel','responsiblePartyId','safetyResponsiblePartyId','methodStatementRef','riskAssessmentRef','emergencyPlanRef','validFrom','validTo']
        require(all(r.get(x) not in [None,'',[]] for x in required),'PERMIT_SUBMISSION_COMPLETE','Permit identity, responsible persons, method/risk/emergency references and validity are required')
        require(bool(r.get('responsibleOrganizationId')) and bool(r.get('requirementRefs')),'PERMIT_SUBMISSION_COMPLETE','Permit needs contractor organization and requirement baseline')
        require(isinstance(r.get('equipmentRefs'),list) and isinstance(r.get('personnelQualificationRefs'),list),'PERMIT_SUBMISSION_COMPLETE','Permit needs explicit equipment and qualification lists')
        require(instant(r['validFrom'])<instant(r['validTo']),'PERMIT_SUBMISSION_COMPLETE','Permit validity window is invalid')
        for field in ['methodStatementRef','riskAssessmentRef','emergencyPlanRef']:
            self.resolve(r[field],r['projectId'])
        require(self._safety_refs_current(r,'equipmentRefs',object_type='Asset',subtype='Equipment'),'PERMIT_SUBMISSION_COMPLETE','Equipment references must be current Equipment assets')
        require(self._safety_refs_current(r,'personnelQualificationRefs',object_type='Qualification'),'PERMIT_SUBMISSION_COMPLETE','Qualification references must be current')

    def _permit_safety_review_complete(self,r):
        keys=['methodStatementCurrent','riskAssessmentCurrent','personnelQualified','equipmentReady','controlMeasuresReady','emergencyReady']
        require(r.get('safetyReviewComplete') is True and self._all_true(r.get('readiness'),keys),'PERMIT_SAFETY_REVIEW_COMPLETE','Safety review conditions are incomplete')

    def _permit_prestart_verified(self,r):
        require(r.get('prestartVerified') is True and bool(r.get('prestartVerificationRefs')) and bool(r.get('evidenceIds')),'PERMIT_PRESTART_VERIFIED','Pre-start verification and evidence are required')

    def _permit_authorization_ready(self,r):
        self._permit_safety_review_complete(r)
        self._permit_prestart_verified(r)
        require(instant(r['validFrom'])<instant(r['validTo']),'PERMIT_AUTHORIZATION_READY','Permit validity window is invalid')

    def _linked_stop_orders_clear(self,r):
        for reference in r.get('stopOrderRefs',[]):
            require(reference.get('objectType')=='WorkItem','SAFETY_STOP_OPEN','Stop reference must identify a WorkItem')
            stop=self.get('WorkItem',reference['objectId'])
            require(stop['projectId']==r['projectId'] and stop.get('subtype')=='SafetyStopOrder','SAFETY_STOP_OPEN','Stop reference is invalid')
            require(stop['status'] in ['lifted','closed','cancelled','superseded'],'SAFETY_STOP_OPEN','An active Safety Stop Order blocks work')

    def _safety_work_authorized(self,r):
        readiness=['methodStatementCurrent','riskAssessmentCurrent','personnelQualified','equipmentReady','controlMeasuresReady','emergencyReady','environmentalConditionsReady','noBlockingSafetyIssue']
        require(self._all_true(r.get('readiness'),readiness),'SAFETY_WORK_AUTHORIZED','Safety readiness is incomplete')
        require(not r.get('blockedReasons'),'SAFETY_WORK_AUTHORIZED','Blocking reasons remain')
        require(bool(r.get('validFrom')) and bool(r.get('validTo')) and instant(r['validFrom'])<=instant(self.at())<instant(r['validTo']),'SAFETY_WORK_AUTHORIZED','Permit is outside its valid time window')
        require(self._permit_equipment_ready(r),'SAFETY_WORK_AUTHORIZED','Equipment readiness is not current')
        self._linked_stop_orders_clear(r)

    def _safety_suspend_reason_present(self,r):
        require(bool(r.get('suspensionReason','').strip()),'SAFETY_SUSPEND_REASON_PRESENT','Suspension reason is required')

    def _stop_action_records(self,r):
        records=[]
        seen=set()
        for reference in r.get('correctiveActionRefs',[]):
            action=self._current_reference(reference,r['projectId'],object_type='Action')
            require(action['id'] not in seen,'REFERENCE_DUPLICATE',action['id'])
            seen.add(action['id'])
            records.append(action)
        return records

    def _stop_verification_records(self,r):
        records=[]
        seen=set()
        for reference in r.get('resumeVerificationRefs',[]):
            inspection=self._current_reference(reference,r['projectId'],object_type='Inspection')
            require(inspection['id'] not in seen,'REFERENCE_DUPLICATE',inspection['id'])
            seen.add(inspection['id'])
            records.append(inspection)
        return records

    def _affected_stop_permits(self,r):
        records=[]
        seen=set()
        for reference in r.get('affectedPermitRefs',[]):
            require(reference.get('objectType')=='WorkItem','SAFETY_PERMIT_REQUIRED','Affected permit must be a WorkItem')
            permit=self.get('WorkItem',reference['objectId'])
            require(permit['projectId']==r['projectId'] and permit.get('subtype')=='SafetyPermit','SAFETY_PERMIT_REQUIRED','Affected permit is invalid')
            require(permit['id'] not in seen,'REFERENCE_DUPLICATE',permit['id'])
            seen.add(permit['id'])
            records.append(permit)
        return records

    def _stop_owner_reports_satisfied(self,r):
        allowed={'issued','acknowledged','followup','verified','closed'}
        for reference in r.get('ownerReportRefs',[]):
            report=self._current_reference(reference,r['projectId'],object_type='InformationItem',subtype='Report')
            if report['status'] not in allowed:
                return False
        return True

    def _derive_stop_resume_gate(self,r):
        r=self._fields(r)
        actions=self._stop_action_records(r)
        verifications=self._stop_verification_records(r)
        permits=self._affected_stop_permits(r)
        now=instant(self.at())
        actions_complete=bool(actions) and all(action['status'] in ['verified','closed'] for action in actions)
        reinspection_passed=bool(verifications) and all(
            inspection.get('resultStatus')=='pass' and inspection['status'] in ['passed','completed']
            for inspection in verifications
        )
        permit_valid=bool(permits)
        if permit_valid:
            for permit in permits:
                data=permit['data']
                permit_valid = permit_valid and permit['status']=='suspended'
                permit_valid = permit_valid and bool(data.get('validFrom')) and bool(data.get('validTo'))
                if permit_valid:
                    permit_valid = instant(data['validFrom'])<=now<instant(data['validTo'])
        readiness_fields=['methodStatementCurrent','riskAssessmentCurrent','equipmentReady','personnelQualified','controlMeasuresReady','environmentalConditionsReady']
        readiness={field:bool(permits) and all(permit['data'].get('readiness',{}).get(field) is True for permit in permits) for field in readiness_fields}
        return {
            'causeIdentified':bool(actions) and all(bool(action.get('rootCause','').strip()) for action in actions),
            'correctiveActionComplete':actions_complete,
            'correctiveEvidencePresent':bool(r.get('resumeRequestAt')) and bool(r.get('evidenceIds')),
            'issueActionsVerified':actions_complete,
            'reinspectionPassed':reinspection_passed,
            'permitValid':permit_valid,
            'methodStatementCurrent':readiness['methodStatementCurrent'],
            'riskAssessmentCurrent':readiness['riskAssessmentCurrent'],
            'equipmentReady':readiness['equipmentReady'] and all(self._permit_equipment_ready(permit) for permit in permits),
            'personnelQualified':readiness['personnelQualified'],
            'controlMeasuresReady':readiness['controlMeasuresReady'],
            'environmentalConditionsReady':readiness['environmentalConditionsReady'],
            'reportingObligationsSatisfied':self._stop_owner_reports_satisfied(r),
        }

    def _stop_resume_request_ready(self,r):
        require(bool(r.get('evidenceIds')),'STOP_RESUME_REQUEST_READY','Resume request needs corrective evidence')
        if r.get('subtype')=='SafetyStopOrder':
            actions=self._stop_action_records(r)
            require(bool(actions),'STOP_RESUME_REQUEST_READY','Stop resume requires corrective action references')
            require(all(action['status'] in ['verified','closed'] for action in actions),'STOP_RESUME_REQUEST_READY','Corrective actions must be verified before resume request')

    def _resume_gate_complete(self,gate):
        keys=['causeIdentified','correctiveActionComplete','correctiveEvidencePresent','issueActionsVerified','reinspectionPassed','permitValid','methodStatementCurrent','riskAssessmentCurrent','equipmentReady','personnelQualified','controlMeasuresReady','environmentalConditionsReady','reportingObligationsSatisfied']
        return self._all_true(gate,keys)

    def _safety_resume_gate_satisfied(self,r):
        if r.get('subtype')=='SafetyStopOrder':
            derived=self._derive_stop_resume_gate(r)
            require(self._resume_gate_complete(derived),'SAFETY_RESUME_GATE_SATISFIED','Stop resume gate is incomplete')
            return
        self._safety_work_authorized(r)

    def _safety_completion_ready(self,r):
        require(r.get('completionConfirmed') is True and bool(r.get('evidenceIds')),'SAFETY_COMPLETION_READY','Permit completion requires confirmation and evidence')
        self._linked_stop_orders_clear(r)

    def _permit_expired(self,r):
        require(bool(r.get('validTo')) and instant(self.at())>=instant(r['validTo']),'PERMIT_EXPIRED','Permit has not expired')

    def _stop_correction_started(self,r):
        actions=self._stop_action_records(r)
        require(bool(actions),'STOP_CORRECTION_STARTED','Stop correction requires corrective action references')
        require(all(action['status']!='cancelled' for action in actions),'STOP_CORRECTION_STARTED','Cancelled corrective actions cannot start correction')

    def _stop_resume_verification_ready(self,r):
        inspections=self._stop_verification_records(r)
        require(bool(inspections),'STOP_RESUME_VERIFICATION_READY','Resume verification evidence references are required')
        require(all(inspection.get('resultStatus')=='pass' and inspection['status'] in ['passed','completed'] for inspection in inspections),'STOP_RESUME_VERIFICATION_READY','Resume verification must reference passed inspections')

    def _stop_close_ready(self,r):
        require(bool(r.get('liftedAt')) and not r.get('blockedReasons'),'STOP_CLOSE_READY','Lifted stop with no unresolved blocker is required before close')

    def _equipment_inspection_request_complete(self,r):
        require(bool(r.get('equipmentRef')) and bool(r.get('inspectionKind')),'EQUIPMENT_INSPECTION_REQUEST_COMPLETE','Equipment inspection request is incomplete')
        self._current_reference(r['equipmentRef'],r['projectId'],object_type='Asset',subtype='Equipment')

    def _equipment_document_records(self,r,field,*,required,calibration):
        refs=r.get(field,[])
        if required:
            require(bool(refs),'EQUIPMENT_DOCUMENT_INVALID',field+' is required for this equipment')
        records=[]
        now=instant(self.at())
        for reference in refs:
            document=self._current_reference(reference,r['projectId'],object_type='InformationItem',subtype='Certificate')
            require(document.get('status')=='approved','EQUIPMENT_DOCUMENT_INVALID','Safety certificate/calibration must be approved')
            if calibration:
                require(document.get('certificateKind')=='calibration','EQUIPMENT_DOCUMENT_INVALID','Calibration reference must identify a calibration certificate')
            else:
                require(document.get('certificateKind') in ['safety','inspection','other'],'EQUIPMENT_DOCUMENT_INVALID','Certificate reference must identify a non-calibration certificate')
            require(bool(document.get('validFrom')) and bool(document.get('validTo')),'EQUIPMENT_DOCUMENT_INVALID','Certificate validity period is required')
            require(instant(document['validFrom'])<=now<instant(document['validTo']),'EQUIPMENT_DOCUMENT_INVALID','Certificate or calibration is expired or not yet valid')
            records.append(document)
        return records

    def _require_equipment_documents_current(self,r):
        r=self._fields(r)
        equipment=self._current_reference(r['equipmentRef'],r['projectId'],object_type='Asset',subtype='Equipment')
        self._equipment_document_records(
            r,
            'certificateRefs',
            required=equipment.get('certificateRequired',True),
            calibration=False,
        )
        self._equipment_document_records(
            r,
            'calibrationRefs',
            required=equipment.get('calibrationRequired',False),
            calibration=True,
        )
        now=instant(self.at())
        if r.get('validFrom'):
            require(instant(r['validFrom'])<=now,'EQUIPMENT_DOCUMENT_INVALID','Equipment inspection is not yet valid')
        if r.get('validTo'):
            require(now<instant(r['validTo']),'EQUIPMENT_DOCUMENT_INVALID','Equipment inspection validity has expired')
        return True

    def _equipment_documents_current(self,r):
        try:
            return self._require_equipment_documents_current(r)
        except ContractError:
            return False

    def _permit_equipment_ready(self,r):
        r=self._fields(r)
        for reference in r.get('equipmentRefs',[]):
            equipment=self._current_reference(reference,r['projectId'],object_type='Asset',subtype='Equipment')
            inspections=[]
            for sequence,((kind,object_id),record) in enumerate(self._records.items()):
                if kind!='WorkItem' or record.get('subtype')!='SafetyEquipmentInspection' or record['projectId']!=r['projectId']:
                    continue
                target=record.get('data',{}).get('equipmentRef',{})
                if target.get('objectId')!=equipment['id']:
                    continue
                current=self.get('WorkItem',object_id)
                inspections.append((current.get('createdAt',''),sequence,current))
            if not inspections:
                return False
            current_inspection=max(inspections,key=lambda item:(item[0],item[1]))[2]
            if current_inspection.get('status')!='passed' or current_inspection.get('data',{}).get('equipmentAvailable') is not True:
                return False
        return True

    def _equipment_schedule_present(self,r):
        require(bool(r.get('scheduledAt')),'EQUIPMENT_SCHEDULE_PRESENT','Equipment inspection schedule is required')

    def _equipment_result_present(self,r):
        require(bool(r.get('inspectedAt')) and bool(r.get('resultSummary','').strip()) and bool(r.get('evidenceIds')),'EQUIPMENT_RESULT_PRESENT','Equipment result needs inspection time, summary and evidence')

    def _equipment_pass_ready(self,r):
        require(bool(r.get('resultSummary','').strip()) and r.get('preUseCheckComplete') is True and not r.get('blockedReasons'),'EQUIPMENT_PASS_READY','Passed equipment must complete pre-use check with no blockers')
        self._require_equipment_documents_current(r)

    def _equipment_fail_ready(self,r):
        require(bool(r.get('failureReason','').strip()),'EQUIPMENT_FAIL_READY','Failed equipment requires failure reason')

    def _equipment_restricted_ready(self,r):
        require(bool(r.get('restrictionConditions')),'EQUIPMENT_RESTRICTED_READY','Restricted equipment requires explicit conditions')

    def _equipment_reinspection_ready(self,r):
        require(bool(r.get('correctiveActionRefs')) and bool(r.get('reason','').strip()),'EQUIPMENT_REINSPECTION_READY','Reinspection requires corrective actions and reason')

    def _equipment_expired(self,r):
        require(bool(r.get('validTo')) and instant(self.at())>=instant(r['validTo']),'EQUIPMENT_EXPIRED','Equipment inspection has not expired')

    def _schedule_scope_key(self, record):
        return record.get('projectId'),record.get('packageId'),record.get('discipline')

    def _current_schedule_reference(self, reference, project_id, *, kind=None, statuses=None):
        schedule=self._current_reference(reference,project_id,object_type='InformationItem',subtype='Schedule')
        data=schedule.get('schedule',{})
        if kind is not None:require(data.get('scheduleKind')==kind,'SCHEDULE_KIND_INVALID',kind)
        if statuses is not None:require(schedule.get('status') in statuses,'SCHEDULE_STATUS_INVALID',schedule.get('status',''))
        return schedule

    def _schedule_file_preserved(self, record):
        schedule=record.get('schedule',{})
        return bool(schedule.get('sourceFileRef')) and schedule['sourceFileRef'] in record.get('fileIds',[]) and bool(schedule.get('sourceFileHash'))

    def _schedule_quality_keys(self):
        return ['contractDatesAligned','wbsComplete','activityIdsUnique','calendarsDefined','logicComplete','openEndsIdentified','constraintsReviewed','durationOutliersReviewed','criticalPathComputable','floatOutliersReviewed','interfacesReviewed','sourceFilePreserved']

    def _schedule_critical_path_ready(self,r):
        reference=r.get('schedule',{}).get('criticalPathRef')
        require(bool(reference),'SCHEDULE_CRITICAL_PATH_INVALID','Critical path reference is required')
        activity=self._current_reference(reference,r['projectId'],object_type='WorkItem',subtype='ScheduleActivity')
        source=activity.get('data',{}).get('sourceScheduleRef')
        require(bool(source) and source.get('objectType')=='InformationItem' and source.get('objectId')==r['id'],'SCHEDULE_CRITICAL_PATH_INVALID','Critical path must belong to this Schedule object')
        require(self._schedule_scope_key(activity)==self._schedule_scope_key(r),'SCHEDULE_CRITICAL_PATH_INVALID','Critical path activity scope mismatch')
        return activity

    def _schedule_baseline_submission_complete(self,r):
        schedule=r.get('schedule',{})
        require(schedule.get('scheduleKind')=='baseline','SCHEDULE_BASELINE_SUBMISSION_COMPLETE','Baseline Schedule kind required')
        require(schedule.get('revision')==r.get('revision'),'SCHEDULE_BASELINE_SUBMISSION_COMPLETE','Schedule revision must match InformationItem revision')
        required=['scheduleNo','sourceFileRef','sourceFormat','sourceFileHash','sourceFileVersion','projectStartAt','contractualCompletionAt','calendars','wbsVersion','milestoneSet','criticalPathRef','activityCount','scheduleQualitySummary']
        require(all(schedule.get(x) not in [None,'',[]] for x in required),'SCHEDULE_BASELINE_SUBMISSION_COMPLETE','Baseline package is incomplete')
        require(self._schedule_file_preserved(r),'SCHEDULE_BASELINE_SUBMISSION_COMPLETE','Original schedule source file must be preserved')
        require(instant(schedule['projectStartAt'])<instant(schedule['contractualCompletionAt']),'SCHEDULE_BASELINE_SUBMISSION_COMPLETE','Contract dates are invalid')
        require(schedule.get('activityCount',0)>0,'SCHEDULE_BASELINE_SUBMISSION_COMPLETE','Baseline needs activities')
        self._schedule_critical_path_ready(r)

    def _schedule_baseline_completeness_passed(self,r):
        self._schedule_baseline_submission_complete(r)
        quality=r['schedule'].get('scheduleQualitySummary',{})
        require(all(k in quality for k in self._schedule_quality_keys()),'SCHEDULE_BASELINE_COMPLETENESS_PASSED','Baseline quality checklist is incomplete')

    def _schedule_baseline_review_passed(self,r):
        self._schedule_baseline_completeness_passed(r)
        quality=r['schedule']['scheduleQualitySummary']
        require(all(quality.get(k) is True for k in self._schedule_quality_keys()),'SCHEDULE_BASELINE_REVIEW_PASSED','Baseline quality review has unresolved checks')

    def _approved_schedule_authority_ref(self, r, *, require_current_target=False):
        schedule=r.get('schedule',{})
        refs=[schedule.get('approvalRef'),schedule.get('ownerDecisionRef')]
        for reference in refs:
            if not reference:continue
            obj=self._current_reference(reference,r['projectId'])
            if reference['objectType']=='Approval' and obj.get('status')=='approved':
                target=obj.get('targetRef')
                if target and target.get('objectType')=='InformationItem' and target.get('objectId')==r['id']:
                    if not require_current_target or target.get('version')==r['version']:return obj
                    if target.get('version')==r['version']-1:return obj
            if reference['objectType']=='Decision' and obj.get('decision')=='approved' and obj.get('status') in ['decided','executing','verified','closed']:
                target=obj.get('targetRef')
                if target and target.get('objectType')=='InformationItem' and target.get('objectId')==r['id']:
                    if not require_current_target or target.get('version')==r['version']:return obj
                    if target.get('version')==r['version']-1:return obj
        return None

    def _schedule_baseline_approval_ready(self,r):
        self._schedule_baseline_review_passed(r)
        require(self._approved_schedule_authority_ref(r,require_current_target=True) is not None,'SCHEDULE_BASELINE_APPROVAL_READY','Exact Schedule version needs approved Approval or Owner Decision')

    def _effective_baselines(self,r,exclude_id=None):
        key=self._schedule_scope_key(r);values=[]
        for (kind,oid),record in self._records.items():
            if kind!='InformationItem' or oid==exclude_id:continue
            if self._record_machines.get((kind,oid))!='schedule_baseline':continue
            if record.get('status')=='effective' and self._schedule_scope_key(record)==key:values.append(record)
        return values

    def _approved_schedule_revision_basis(self, reference, project_id):
        if not reference:return False
        try:obj=self.resolve(reference,project_id)
        except ContractError:return False
        if reference['objectType']=='Decision':return obj.get('decision')=='approved' and obj.get('status') in ['decided','executing','verified','closed']
        if reference['objectType']=='Approval':return obj.get('status')=='approved'
        if reference['objectType']=='WorkItem':
            return obj.get('subtype') in ['ChangeRequest','Variation','EOTRequest'] and obj.get('status') in ['approved','accepted','effective','decided','closed','completed']
        return False

    def _schedule_baseline_activation_ready(self,r):
        require(self._approved_schedule_authority_ref(r) is not None,'SCHEDULE_BASELINE_ACTIVATION_READY','Approved Schedule authority reference is required')
        prior=self._effective_baselines(r,exclude_id=r['id'])
        require(len(prior)<=1,'SCHEDULE_BASELINE_ACTIVATION_READY','Multiple effective baselines exist in one scope')
        if prior:require(self._approved_schedule_revision_basis(r['schedule'].get('revisionBasisRef'),r['projectId']),'SCHEDULE_BASELINE_ACTIVATION_READY','Baseline revision needs an approved revision basis')

    def _schedule_replacement_effective(self,r):
        replacement=r.get('schedule',{}).get('replacementRef') or r.get('replacementRef')
        require(bool(replacement),'SCHEDULE_REPLACEMENT_EFFECTIVE','Replacement Schedule reference required')
        self._current_schedule_reference(replacement,r['projectId'],kind='baseline',statuses=['effective'])

    def _schedule_progress_submission_complete(self,r):
        schedule=r.get('schedule',{})
        require(schedule.get('scheduleKind')=='progress_update','SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Progress Schedule kind required')
        require(schedule.get('revision')==r.get('revision'),'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Schedule revision must match InformationItem revision')
        required=['scheduleNo','sourceFileRef','sourceFormat','sourceFileHash','sourceFileVersion','dataDate','forecastCompletionAt','activityCount','baselineScheduleRef']
        require(all(schedule.get(x) not in [None,'',[]] for x in required),'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Progress update is incomplete')
        require(self._schedule_file_preserved(r),'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Original progress schedule file must be preserved')
        require(instant(schedule['dataDate'])<=instant(self.at()),'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Data Date cannot be in the future')
        baseline=self._current_schedule_reference(schedule['baselineScheduleRef'],r['projectId'],kind='baseline',statuses=['effective'])
        require(self._schedule_scope_key(baseline)==self._schedule_scope_key(r),'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Baseline scope mismatch')
        previous_ref=schedule.get('previousScheduleRef')
        frozen=[]
        for (kind,oid),record in self._records.items():
            if kind=='InformationItem' and oid!=r['id'] and self._record_machines.get((kind,oid))=='schedule_progress' and record.get('status')=='frozen' and self._schedule_scope_key(record)==self._schedule_scope_key(r):frozen.append(record)
        if previous_ref:
            previous=self._current_schedule_reference(previous_ref,r['projectId'],kind='progress_update',statuses=['frozen'])
            require(self._schedule_scope_key(previous)==self._schedule_scope_key(r),'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Previous update scope mismatch')
            prior_date=instant(previous['schedule']['dataDate']);current_date=instant(schedule['dataDate'])
            require(current_date>=prior_date,'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Data Date cannot move backward')
            if current_date==prior_date:
                require(bool(schedule.get('correctionReason')) and schedule.get('correctionOfRef')==previous_ref,'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','Same Data Date requires explicit correction linkage')
        else:
            require(not frozen,'SCHEDULE_PROGRESS_SUBMISSION_COMPLETE','A later progress update must reference the current frozen snapshot')

    def _schedule_progress_completeness_passed(self,r):
        self._schedule_progress_submission_complete(r)
        require(bool(r['schedule'].get('milestoneSet')) and bool(r['schedule'].get('criticalPathRef')),'SCHEDULE_PROGRESS_COMPLETENESS_PASSED','Milestones and critical path are required')
        self._schedule_critical_path_ready(r)

    def _schedule_progress_verification_passed(self,r):
        self._schedule_progress_completeness_passed(r)
        schedule=r['schedule']
        require(all(schedule.get(k) is True for k in ['actualsVerified','forecastVerified','criticalPathReviewed','varianceExplained']),'SCHEDULE_PROGRESS_VERIFICATION_PASSED','Progress verification is incomplete')
        require(bool(r.get('evidenceIds')),'SCHEDULE_PROGRESS_VERIFICATION_PASSED','Verified progress needs preserved evidence')

    def _schedule_progress_freeze_ready(self,r):
        self._schedule_progress_verification_passed(r)
        require(bool(r['schedule'].get('acceptedAt')),'SCHEDULE_PROGRESS_FREEZE_READY','Progress must be accepted before freeze')

    def _schedule_replacement_frozen(self,r):
        reference=r.get('schedule',{}).get('replacementRef')
        require(bool(reference),'SCHEDULE_REPLACEMENT_FROZEN','Replacement progress reference required')
        self._current_schedule_reference(reference,r['projectId'],kind='progress_update',statuses=['frozen'])

    def _derive_schedule_variance(self,record):
        schedule=record['schedule'];baseline=self.resolve(schedule['baselineScheduleRef'],record['projectId'])
        planned=baseline['schedule'].get('contractualCompletionAt');forecast=schedule.get('forecastCompletionAt')
        result={}
        if planned and forecast:result['forecastCompletionVarianceDays']=(instant(forecast)-instant(planned)).total_seconds()/86400
        return result

    def _delay_event_create_ready(self,r):
        require(bool(r.get('evidenceIds')),'DELAY_EVENT_CREATE_READY','Delay Event requires preserved evidence')
        baseline=self._current_schedule_reference(r['baselineScheduleRef'],r['projectId'],kind='baseline',statuses=['effective'])
        current=self._current_reference(r['currentScheduleRef'],r['projectId'],object_type='InformationItem',subtype='Schedule')
        require(current.get('schedule',{}).get('scheduleKind') in ['baseline','progress_update'],'DELAY_EVENT_CREATE_READY','Delay current Schedule must be baseline or progress update')
        require(current.get('status') in ['effective','accepted_for_reporting','frozen'],'DELAY_EVENT_CREATE_READY','Delay current Schedule must be verified/current')
        require(self._schedule_scope_key(baseline)==self._schedule_scope_key(r)==self._schedule_scope_key(current),'DELAY_EVENT_CREATE_READY','Delay Schedule scope mismatch')

    def _delay_notification_ready(self,r):
        self._delay_event_create_ready(r)

    def _delay_assessment_ready(self,r):
        self._delay_event_create_ready(r)
        require(bool(r.get('assignedPartyId')) and bool(r.get('causeCategory')),'DELAY_ASSESSMENT_READY','Delay assessment owner and factual cause are required')

    def _delay_impact_scope_ready(self,r):
        self._delay_assessment_ready(r)
        require(bool(r.get('affectedActivityRefs')) or bool(r.get('affectedMilestoneIds')),'DELAY_IMPACT_SCOPE_READY','Delay impact scope is required')
        require(r.get('currentForecastImpactDays') is not None or r.get('totalFloatImpact') is not None,'DELAY_IMPACT_SCOPE_READY','Preliminary schedule impact is required')

    def _delay_mitigation_ready(self,r):
        analysis=r.get('impactAnalysis')
        require(isinstance(analysis,dict),'DELAY_MITIGATION_READY','Impact analysis is required')
        self._current_schedule_reference(analysis['baselineScheduleRef'],r['projectId'],kind='baseline')
        self._current_reference(analysis['scheduleRef'],r['projectId'],object_type='InformationItem',subtype='Schedule')
        require(bool(r.get('mitigationActionRefs')) or bool(r.get('recoveryPlanRefs')),'DELAY_MITIGATION_READY','Mitigation Action or Recovery Plan linkage is required')

    def _delay_monitoring_ready(self,r):
        self._delay_mitigation_ready(r)

    def _delay_resolution_ready(self,r):
        require(bool(r.get('resolutionSummary','').strip()) and bool(r.get('eventEndAt')) and bool(r.get('evidenceIds')),'DELAY_RESOLUTION_READY','Delay resolution needs end date, evidence and summary')

    def _delay_contract_transfer_ready(self,r):
        refs=list(r.get('contractNoticeRefs',[]))+list(r.get('claimRefs',[]))
        if r.get('eotDecisionRef'):refs.append(r['eotDecisionRef'])
        require(bool(refs),'DELAY_CONTRACT_TRANSFER_READY','Contract Notice, Claim or EOT decision reference required')
        for reference in refs:self.resolve(reference,r['projectId'])

    def _delay_close_ready(self,r):
        require(bool(r.get('closureSummary','').strip()),'DELAY_CLOSE_READY','Delay closure summary is required')
        if r.get('status')=='transferred' or r.get('transferredAt'):self._delay_contract_transfer_ready(r)

    def _recovery_request_ready(self,r):
        refs=r.get('triggerDelayEventRefs',[])
        require(bool(refs),'RECOVERY_REQUEST_READY','Recovery Plan needs at least one Delay Event')
        for reference in refs:
            event=self._current_reference(reference,r['projectId'],object_type='WorkItem',subtype='DelayEvent')
            require(event.get('status') not in ['cancelled','closed'],'RECOVERY_REQUEST_READY','Closed/cancelled Delay Event cannot initiate a new Recovery Plan')

    def _recovery_schedule_ready(self,r):
        reference=r.get('recoveryScheduleRef')
        require(bool(reference),'RECOVERY_SUBMISSION_COMPLETE','Recovery Schedule exact version is required')
        schedule=self.resolve(reference,r['projectId'])
        require(reference.get('objectType')=='InformationItem' and schedule.get('subtype')=='Schedule' and schedule.get('schedule',{}).get('scheduleKind')=='recovery','RECOVERY_SUBMISSION_COMPLETE','Recovery Schedule snapshot required')
        current=self.get('InformationItem',reference['objectId'])
        require(current['version']==reference['version'],'RECOVERY_SUBMISSION_COMPLETE','Recovery Schedule reference is stale')
        require(self._schedule_scope_key(current)==self._schedule_scope_key(r),'RECOVERY_SUBMISSION_COMPLETE','Recovery Schedule scope mismatch')

    def _recovery_submission_complete(self,r):
        self._recovery_request_ready(r)
        required=['recoveryPlanNo','targetCompletionAt','currentForecastCompletionAt','proposedForecastCompletionAt','strategy','qualityImpact','safetyImpact','costImpact','contractImpact','monitoringPeriod','monitoringKpis']
        require(all(r.get(x) not in [None,'',[]] for x in required),'RECOVERY_SUBMISSION_COMPLETE','Recovery Plan package is incomplete')
        require(r.get('qualityStandardsRelaxed') is False and r.get('safetyStandardsRelaxed') is False,'RECOVERY_SUBMISSION_COMPLETE','Recovery cannot relax quality or safety standards')
        self._recovery_schedule_ready(r)

    def _recovery_completeness_passed(self,r):
        self._recovery_submission_complete(r)

    def _recovery_decision_required(self,r):
        self._recovery_submission_complete(r)
        require(r.get('ownerDecisionRequired') is True,'RECOVERY_DECISION_REQUIRED','Recovery does not require Owner decision')

    def _recovery_acceptance_ready(self,r):
        self._recovery_submission_complete(r)
        require(r.get('ownerDecisionRequired') is not True,'RECOVERY_ACCEPTANCE_READY','Owner decision is required before acceptance')

    def _recovery_decision_approved(self,r):
        self._recovery_submission_complete(r)
        require(r.get('ownerDecisionRequired') is True,'RECOVERY_DECISION_APPROVED','Owner decision flag is required')
        expected_target={'objectType':'WorkItem','objectId':r['id'],'version':r['version']}
        decisions=[]
        for reference in r.get('decisionRefs',[]):
            decision=self._current_reference(reference,r['projectId'],object_type='Decision')
            if (
                decision.get('targetRef')==expected_target
                and all(decision.get(field)==r.get(field) for field in ['packageId','locationId','discipline'])
                and decision.get('decision')=='approved'
                and decision.get('status') in ['decided','executing','verified','closed']
            ):
                decisions.append(decision)
        require(bool(decisions),'RECOVERY_DECISION_APPROVED','Approved Owner Decision for the exact current Recovery Plan version required')

    def _recovery_activation_ready(self,r):
        require(bool(r.get('acceptedAt')),'RECOVERY_ACTIVATION_READY','Recovery Plan must be accepted before activation')
        self._recovery_schedule_ready(r)
        require(r.get('qualityStandardsRelaxed') is False and r.get('safetyStandardsRelaxed') is False,'RECOVERY_ACTIVATION_READY','Recovery cannot relax quality or safety standards')

    def _recovery_monitoring_ready(self,r):
        require(bool(r.get('monitoringKpis')) and bool(r.get('monitoringPeriod')),'RECOVERY_MONITORING_READY','Recovery monitoring KPI and period are required')

    def _recovery_effective_evidence(self,r):
        require(bool(r.get('effectivenessSummary','').strip()) and bool(r.get('evidenceIds')),'RECOVERY_EFFECTIVE_EVIDENCE','Recovery effectiveness needs evidence and summary')

    def _recovery_ineffective_evidence(self,r):
        require(bool(r.get('effectivenessSummary','').strip()) and bool(r.get('evidenceIds')),'RECOVERY_INEFFECTIVE_EVIDENCE','Recovery ineffectiveness needs evidence and summary')
        require(bool(r.get('followupPlanRef')) or bool(r.get('contractTrackRefs')),'RECOVERY_INEFFECTIVE_EVIDENCE','Ineffective Recovery needs follow-up or contract track')

    def _recovery_completion_ready(self,r):
        require(r.get('effectivenessResult') in ['effective','ineffective'] and bool(r.get('effectivenessSummary','').strip()),'RECOVERY_COMPLETION_READY','Recovery effectiveness decision required before completion')
        if r.get('effectivenessResult')=='ineffective':require(bool(r.get('followupPlanRef')) or bool(r.get('contractTrackRefs')),'RECOVERY_COMPLETION_READY','Ineffective Recovery requires a follow-up path')

    def _contract_ref(self, reference, project_id, *, object_type=None, subtype=None, statuses=None):
        require(isinstance(reference,dict),'REFERENCE_INVALID','Contract workflow reference must be an object')
        if object_type is not None:require(reference.get('objectType')==object_type,'REFERENCE_TYPE_INVALID',object_type)
        obj=self.resolve(reference,project_id)
        if subtype is not None:require(obj.get('subtype')==subtype,'REFERENCE_TYPE_INVALID',subtype)
        if statuses is not None:require(obj.get('status') in statuses,'REFERENCE_STATUS_INVALID',obj.get('status',''))
        return obj

    def _contract_refs(self, references, project_id, *, object_type=None, subtype=None, statuses=None, allow_empty=False):
        require(isinstance(references,list) and (allow_empty or bool(references)),'REFERENCE_REQUIRED','Contract workflow references are required')
        require(len({(x.get('objectType'),x.get('objectId'),x.get('version')) for x in references})==len(references),'REFERENCE_DUPLICATE','Contract workflow references must be unique')
        return [self._contract_ref(x,project_id,object_type=object_type,subtype=subtype,statuses=statuses) for x in references]

    def _contract_notice_identify_ready(self,r):
        required=['noticeNo','eventRef','clauseRef','contractRuleRef','awareAt','eventAt','senderPartyId','recipientPartyId','subject']
        require(all(r.get(x) not in [None,'',[]] for x in required),'CONTRACT_NOTICE_IDENTIFY_READY','Notice trigger, clause, rule, parties, dates and subject are required')
        self._contract_ref(r['eventRef'],r['projectId'],object_type='WorkItem')
        self._contract_ref(r['clauseRef'],r['projectId'],object_type='Requirement')
        self._contract_ref(r['contractRuleRef'],r['projectId'],object_type='Requirement')
        require(instant(r['eventAt'])<=instant(r['awareAt']),'CONTRACT_NOTICE_IDENTIFY_READY','Awareness date cannot precede event date')

    def _contract_notice_due_ready(self,r):
        self._contract_notice_identify_ready(r)
        require(bool(r.get('noticeDueAt')),'CONTRACT_NOTICE_DUE_READY','Human-confirmed notice due date is required')
        require(instant(r['awareAt'])<=instant(r['noticeDueAt']),'CONTRACT_NOTICE_DUE_READY','Notice due date cannot precede awareness date')

    def _contract_notice_submission_ready(self,r):
        self._contract_notice_due_ready(r)
        require(r.get('dueCalculationConfirmed') is True,'CONTRACT_NOTICE_SUBMISSION_READY','Official notice due date needs human confirmation')
        require(bool(r.get('evidenceIds')),'CONTRACT_NOTICE_SUBMISSION_READY','Notice submission needs preserved current evidence')

    def _contract_notice_ack_ready(self,r):
        require(bool(r.get('acknowledgementRef')),'CONTRACT_NOTICE_ACK_READY','Acknowledgement exact reference is required')
        self._contract_ref(r['acknowledgementRef'],r['projectId'])
        require(bool(r.get('evidenceIds')),'CONTRACT_NOTICE_ACK_READY','Acknowledgement receipt evidence is required')

    def _contract_notice_followup_ready(self,r):
        require(bool(r.get('followupDueAt')),'CONTRACT_NOTICE_FOLLOWUP_READY','Follow-up due date is required')
        if r.get('acknowledgedAt'):require(instant(r['acknowledgedAt'])<=instant(r['followupDueAt']),'CONTRACT_NOTICE_FOLLOWUP_READY','Follow-up due date cannot precede acknowledgement')

    def _contract_notice_preservation_ready(self,r):
        refs=r.get('continuingRecordRefs')
        self._contract_refs(refs,r['projectId'])
        require(bool(r.get('evidenceIds')),'CONTRACT_NOTICE_PRESERVATION_READY','Rights-preservation record needs current evidence')

    def _contract_notice_time_bar_risk_ready(self,r):
        require(bool(r.get('noticeDueAt')),'CONTRACT_NOTICE_TIME_BAR_RISK_READY','Notice due date is required')
        require(instant(self.at())>instant(r['noticeDueAt']),'CONTRACT_NOTICE_TIME_BAR_RISK_READY','Notice deadline has not elapsed')
        require(r.get('timeBarRisk') is not True,'CONTRACT_NOTICE_TIME_BAR_RISK_READY','Time-bar risk is already recorded')

    def _contract_notice_close_ready(self,r):
        refs=r.get('downstreamCaseRefs')
        require(isinstance(refs,list),'CONTRACT_NOTICE_CLOSE_READY','Downstream case references must be explicitly recorded, including an empty list')
        self._contract_refs(refs,r['projectId'],allow_empty=True)

    def _claim_submission_ready(self,r):
        required=['claimNo','noticeRefs','eventRefs','clauseRefs','claimType','reliefRequested','entitlementBasis','chronology']
        require(all(r.get(x) not in [None,'',[]] for x in required),'CLAIM_SUBMISSION_READY','Claim notice, event, clause, relief, entitlement basis and chronology are required')
        self._contract_refs(r['noticeRefs'],r['projectId'],object_type='WorkItem',subtype='ContractNotice',statuses=['submitted','acknowledged','followup_required','preserved','closed'])
        self._contract_refs(r['eventRefs'],r['projectId'],object_type='WorkItem')
        self._contract_refs(r['clauseRefs'],r['projectId'],object_type='Requirement')
        if r.get('evidenceRefs') is not None:self._contract_refs(r['evidenceRefs'],r['projectId'],object_type='Evidence',allow_empty=True)
        if r.get('claimType') in ['cost','time_and_cost']:
            require(isinstance(r.get('amountClaimed'),(int,float)) and bool(r.get('currency')),'CLAIM_SUBMISSION_READY','Cost claim needs claimed amount and currency')
        if r.get('claimType') in ['time','time_and_cost']:
            require(bool(r.get('timeImpactRef')),'CLAIM_SUBMISSION_READY','Time claim needs exact time-impact reference')
            self._contract_ref(r['timeImpactRef'],r['projectId'])
        if r.get('costImpactRef'):self._contract_ref(r['costImpactRef'],r['projectId'])

    def _claim_receipt_ready(self,r):
        self._claim_submission_ready(r)

    def _claim_substantiation_request_ready(self,r):
        require(isinstance(r.get('substantiationRequirements'),list) and bool(r['substantiationRequirements']),'CLAIM_SUBSTANTIATION_REQUEST_READY','Missing substantiation items must be explicit')

    def _claim_entitlement_review_ready(self,r):
        require(bool(r.get('entitlementAssessment','').strip()),'CLAIM_ENTITLEMENT_REVIEW_READY','Entitlement assessment is required')

    def _claim_quantum_review_ready(self,r):
        require(bool(r.get('recommendation','').strip()),'CLAIM_QUANTUM_REVIEW_READY','Claim recommendation is required')
        if r.get('claimType') in ['cost','time_and_cost']:
            require(isinstance(r.get('amountAssessed'),(int,float)),'CLAIM_QUANTUM_REVIEW_READY','Cost claim needs assessed amount')

    def _claim_decision_request_ready(self,r):
        self._claim_quantum_review_ready(r)

    def _contract_owner_decision(self,r,expected):
        decision=self._contract_ref(r.get('decisionRef'),r['projectId'],object_type='Decision',statuses=['decided','executing','verified','closed'])
        target=decision.get('targetRef')
        require(target=={'objectType':'WorkItem','objectId':r['id'],'version':r['version']},'CONTRACT_DECISION_TARGET_INVALID','Owner Decision must target the exact contract-track version')
        require(decision.get('decision')==expected,'CONTRACT_DECISION_OUTCOME_INVALID','Owner Decision outcome does not match contract-track command')
        return decision

    def _claim_approved_decision_ready(self,r):
        self._contract_owner_decision(r,'approved')
        if r.get('claimType') in ['cost','time_and_cost']:
            require(isinstance(r.get('amountApproved'),(int,float)),'CLAIM_APPROVED_DECISION_READY','Approved cost claim needs approved amount')
            require(r['amountApproved']<=r['amountClaimed'],'CLAIM_APPROVED_DECISION_READY','Approved amount cannot exceed claimed amount')

    def _claim_partially_approved_decision_ready(self,r):
        self._claim_approved_decision_ready(r)
        require(r.get('disputedItems') is not None,'CLAIM_PARTIALLY_APPROVED_DECISION_READY','Partial approval must preserve disputed items')
        if r.get('claimType') in ['cost','time_and_cost']:require(r['amountApproved']<r['amountClaimed'],'CLAIM_PARTIALLY_APPROVED_DECISION_READY','Partial approval must remain below claimed amount')

    def _claim_rejected_decision_ready(self,r):
        self._contract_owner_decision(r,'rejected')

    def _claim_disputed_decision_ready(self,r):
        self._contract_owner_decision(r,'returned')
        require(isinstance(r.get('disputedItems'),list) and bool(r['disputedItems']),'CLAIM_DISPUTED_DECISION_READY','Disputed claim items are required')

    def _claim_settlement_ready(self,r):
        require(bool(r.get('settlementRef')),'CLAIM_SETTLEMENT_READY','Settlement exact reference is required')
        self._contract_ref(r['settlementRef'],r['projectId'])
        if r.get('implementationRefs') is not None:self._contract_refs(r['implementationRefs'],r['projectId'],allow_empty=True)

    def _claim_close_ready(self,r):
        refs=r.get('implementationRefs')
        require(isinstance(refs,list),'CLAIM_CLOSE_READY','Implementation references must be explicitly recorded, including an empty list')
        if r.get('status') in ['approved','partially_approved','settled']:require(bool(refs),'CLAIM_CLOSE_READY','Approved or settled claim needs implementation references before close')
        self._contract_refs(refs,r['projectId'],allow_empty=True)

    def _eot_submission_ready(self,r):
        required=['eotNo','delayEventRefs','noticeRefs','baselineScheduleRef','impactAnalysisRefs','daysClaimed']
        require(all(r.get(x) not in [None,'',[]] for x in required),'EOT_SUBMISSION_READY','EOT delay, notice, baseline, impact and claimed days are required')
        self._contract_refs(r['delayEventRefs'],r['projectId'],object_type='WorkItem',subtype='DelayEvent')
        self._contract_refs(r['noticeRefs'],r['projectId'],object_type='WorkItem',subtype='ContractNotice',statuses=['submitted','acknowledged','followup_required','preserved','closed'])
        baseline=self._contract_ref(r['baselineScheduleRef'],r['projectId'],object_type='InformationItem',subtype='Schedule',statuses=['effective'])
        require(baseline.get('schedule',{}).get('scheduleKind')=='baseline','EOT_SUBMISSION_READY','EOT must reference an effective contractual Baseline')
        self._contract_refs(r['impactAnalysisRefs'],r['projectId'])
        require(isinstance(r.get('daysClaimed'),(int,float)) and r['daysClaimed']>0,'EOT_SUBMISSION_READY','EOT claimed days must be greater than zero')

    def _eot_receipt_ready(self,r):
        self._eot_submission_ready(r)

    def _eot_time_review_ready(self,r):
        require(bool(r.get('timeImpactAssessment','').strip()),'EOT_TIME_REVIEW_READY','Time-impact assessment is required')
        require(isinstance(r.get('daysAssessed'),(int,float)) and r['daysAssessed']>=0,'EOT_TIME_REVIEW_READY','Assessed days are required')
        require(bool(r.get('assessedCompletionDate')),'EOT_TIME_REVIEW_READY','Assessed completion date is required')

    def _eot_entitlement_review_ready(self,r):
        require(bool(r.get('entitlementAssessment','').strip()),'EOT_ENTITLEMENT_REVIEW_READY','EOT entitlement assessment is required')

    def _eot_decision_request_ready(self,r):
        require(bool(r.get('recommendation','').strip()),'EOT_DECISION_REQUEST_READY','EOT recommendation is required')

    def _eot_approved_decision_ready(self,r):
        self._contract_owner_decision(r,'approved')
        require(isinstance(r.get('daysApproved'),(int,float)) and r['daysApproved']>0,'EOT_APPROVED_DECISION_READY','Approved EOT days are required')
        require(r['daysApproved']<=r['daysClaimed'],'EOT_APPROVED_DECISION_READY','Approved EOT days cannot exceed claimed days')
        require(bool(r.get('revisedCompletionDate')),'EOT_APPROVED_DECISION_READY','Revised contractual completion date is required')
        require(r['daysApproved']==r['daysClaimed'],'EOT_APPROVED_DECISION_READY','Full approval must equal claimed EOT days')

    def _eot_partially_approved_decision_ready(self,r):
        self._contract_owner_decision(r,'approved')
        require(isinstance(r.get('daysApproved'),(int,float)) and 0<r['daysApproved']<r['daysClaimed'],'EOT_PARTIALLY_APPROVED_DECISION_READY','Partial approval must be greater than zero and below claimed EOT days')
        require(bool(r.get('revisedCompletionDate')),'EOT_PARTIALLY_APPROVED_DECISION_READY','Revised contractual completion date is required')

    def _eot_rejected_decision_ready(self,r):
        self._contract_owner_decision(r,'rejected')

    def _eot_disputed_decision_ready(self,r):
        self._contract_owner_decision(r,'returned')
        require(bool(r.get('disputeReason','').strip()),'EOT_DISPUTED_DECISION_READY','EOT dispute reason is required')

    def _eot_baseline_update_ready(self,r):
        require(r.get('decisionOutcome') in ['approved','partially_approved'],'EOT_BASELINE_UPDATE_READY','Only approved EOT may request Baseline revision')
        require(isinstance(r.get('daysApproved'),(int,float)) and r['daysApproved']>0 and bool(r.get('revisedCompletionDate')),'EOT_BASELINE_UPDATE_READY','Approved days and revised completion date are required')

    def _eot_baseline_revision_confirmed(self,r):
        basis=r.get('baselineRevisionBasisRef')
        require(bool(basis),'EOT_BASELINE_REVISION_CONFIRMED','Approved EOT exact-version basis is required')
        approved=self.resolve(basis,r['projectId'])
        require(basis.get('objectType')=='WorkItem' and approved.get('subtype')=='EOTRequest' and approved.get('status') in ['approved','partially_approved'],'EOT_BASELINE_REVISION_CONFIRMED','Baseline revision basis must be an approved historical EOT version')
        reference=r.get('baselineRevisionRef')
        baseline=self._contract_ref(reference,r['projectId'],object_type='InformationItem',subtype='Schedule',statuses=['effective'])
        schedule=baseline.get('schedule',{})
        require(schedule.get('scheduleKind')=='baseline','EOT_BASELINE_REVISION_CONFIRMED','Baseline revision must be contractual Baseline')
        require(reference.get('objectId')!=r['baselineScheduleRef'].get('objectId'),'EOT_BASELINE_REVISION_CONFIRMED','EOT approval requires a new Baseline record, not mutation of the existing Baseline')
        require(schedule.get('revisionBasisRef')==basis,'EOT_BASELINE_REVISION_CONFIRMED','Baseline revision must cite the exact approved EOT version')
        require(schedule.get('contractualCompletionAt')==r.get('revisedCompletionDate'),'EOT_BASELINE_REVISION_CONFIRMED','Baseline contractual completion must match approved EOT decision')


    def _decimal_value(self,value,code='DECIMAL_INVALID',label='value'):
        require(isinstance(value,str) and bool(value.strip()),code,label+' must be a canonical decimal string')
        try:number=Decimal(value)
        except (InvalidOperation,ValueError):raise ContractError(code,label+' is not a valid decimal')
        require(number.is_finite() and number>=0,code,label+' must be non-negative and finite')
        return number

    def _decimal_text(self,value):
        text=format(value,'f')
        if '.' in text:text=text.rstrip('0').rstrip('.')
        return text or '0'

    def _boq_reference(self,reference,project_id,*,current=False,statuses=None):
        if current:
            boq=self._current_reference(reference,project_id,object_type='InformationItem',subtype='ContractBOQ')
        else:
            boq=self._contract_ref(reference,project_id,object_type='InformationItem',subtype='ContractBOQ')
        if statuses is not None:require(boq.get('status') in statuses,'BOQ_STATUS_INVALID','ContractBOQ status is not eligible')
        return boq

    def _boq_line(self,boq,item_id):
        lines=boq.get('boq',{}).get('lineItems',[])
        matches=[line for line in lines if line.get('boqItemId')==item_id]
        require(len(matches)==1,'BOQ_ITEM_NOT_FOUND',item_id)
        return matches[0]

    def _boq_submission_ready(self,r):
        required=['boqNo','revision','currency','contractRef','effectiveFrom','sourceFileRefs','lineItems','measurementRulesRef','roundingRule']
        require(all(r.get(x) not in [None,'',[]] for x in required),'BOQ_SUBMISSION_READY','ContractBOQ identity, contract basis, source, line items and rules are required')
        require(r.get('boq',{}).get('revision')==r.get('revision'),'BOQ_REVISION_MISMATCH','InformationItem and ContractBOQ revisions must match')
        contract=self._current_reference(r['contractRef'],r['projectId'],object_type='Requirement')
        require(contract.get('status')=='active','BOQ_SUBMISSION_READY','Contract basis must be current and active')
        rule=self._current_reference(r['measurementRulesRef'],r['projectId'],object_type='Requirement')
        require(rule.get('status')=='active','BOQ_SUBMISSION_READY','Measurement rule must be current and active')
        self._contract_refs(r['sourceFileRefs'],r['projectId'])
        lines=r['lineItems']
        require(len({x['boqItemId'] for x in lines})==len(lines),'BOQ_SUBMISSION_READY','BOQ item identifiers must be unique')
        require(len({x['itemNo'] for x in lines})==len(lines),'BOQ_SUBMISSION_READY','BOQ item numbers must be unique')
        for line in lines:
            self._decimal_value(line['contractQuantity'],'BOQ_SUBMISSION_READY','contractQuantity')
            self._decimal_value(line['unitRate'],'BOQ_SUBMISSION_READY','unitRate')
            self._decimal_value(line['contractAmount'],'BOQ_SUBMISSION_READY','contractAmount')
            measurement_rule=self._current_reference(line['measurementRuleRef'],r['projectId'],object_type='Requirement')
            require(measurement_rule.get('status')=='active','BOQ_SUBMISSION_READY','BOQ line measurement rule must be active')
        for reference in r.get('revisionBasisRefs',[]):self.resolve(reference,r['projectId'])

    def _boq_review_ready(self,r):
        self._boq_submission_ready(r)

    def _boq_decision_request_ready(self,r):
        self._boq_submission_ready(r)

    def _boq_owner_decision(self,r,expected):
        decision=self._contract_ref(r.get('ownerDecisionRef'),r['projectId'],object_type='Decision',statuses=['decided','executing','verified','closed'])
        target=decision.get('targetRef')
        require(target=={'objectType':'InformationItem','objectId':r['id'],'version':r['version']},'BOQ_DECISION_TARGET_INVALID','Owner Decision must target the exact current ContractBOQ version')
        require(all(decision.get(field)==r.get(field) for field in ['packageId','locationId','discipline']),'BOQ_DECISION_TARGET_INVALID','Owner Decision scope must match ContractBOQ scope')
        require(decision.get('decision')==expected,'BOQ_DECISION_OUTCOME_INVALID','Owner Decision outcome does not match ContractBOQ command')
        return decision

    def _boq_approved_decision_ready(self,r):
        self._boq_owner_decision(r,'approved')

    def _boq_rejected_decision_ready(self,r):
        self._boq_owner_decision(r,'rejected')

    def _boq_activation_ready(self,r):
        decision=self._contract_ref(r.get('ownerDecisionRef'),r['projectId'],object_type='Decision',statuses=['decided','executing','verified','closed'])
        require(decision.get('decision')=='approved','BOQ_ACTIVATION_READY','ContractBOQ activation requires an approved Owner Decision')
        require(decision.get('targetRef')=={'objectType':'InformationItem','objectId':r['id'],'version':r['version']-1},'BOQ_ACTIVATION_READY','Owner Decision must target the immediately preceding decision-pending ContractBOQ version')
        require(bool(r.get('approvedAt')),'BOQ_ACTIVATION_READY','ContractBOQ needs recorded Owner approval before activation')
        require(instant(r['effectiveFrom'])<=instant(self.at()),'BOQ_ACTIVATION_READY','ContractBOQ effective date has not started')

    def _measurement_package_ready(self,r,*,active_boq=False):
        required=['periodStart','periodEnd','measuredAt','boqRef','boqItemRef','claimedQuantity','unit','measurementMethod','previousCertifiedQuantity']
        require(all(r.get(x) not in [None,'',[]] for x in required),'MEASUREMENT_SUBMISSION_READY','Measurement period, BOQ item, quantity, unit and method are required')
        require(instant(r['periodStart'])<=instant(r['periodEnd']),'MEASUREMENT_SUBMISSION_READY','Measurement period is invalid')
        boq=self._boq_reference(r['boqRef'],r['projectId'],current=active_boq,statuses=['effective'] if active_boq else ['effective','superseded'])
        item_ref=r['boqItemRef']
        require(item_ref.get('boqRef')==r['boqRef'],'MEASUREMENT_SUBMISSION_READY','BOQ item reference must use the exact Measurement BOQ version')
        line=self._boq_line(boq,item_ref.get('boqItemId'))
        require(line.get('unit')==r.get('unit'),'UNIT_MISMATCH','Measurement unit must match ContractBOQ')
        self._decimal_value(r['claimedQuantity'],'MEASUREMENT_SUBMISSION_READY','claimedQuantity')
        self._decimal_value(r['previousCertifiedQuantity'],'MEASUREMENT_SUBMISSION_READY','previousCertifiedQuantity')
        for field in ['drawingRefs','inspectionRefs','testRefs','materialLotRefs','changeRefs','variationRefs']:
            refs=r.get(field,[])
            require(isinstance(refs,list),'MEASUREMENT_SUBMISSION_READY',field+' must be a reference list')
            if refs:self._contract_refs(refs,r['projectId'])
        for reference in r.get('variationRefs',[]):
            variation=self._contract_ref(reference,r['projectId'],object_type='WorkItem',subtype='Variation')
            require(variation.get('status') not in ['cancelled','withdrawn','superseded'],'MEASUREMENT_SUBMISSION_READY','Variation reference is not active')
        return boq,line

    def _measurement_submission_ready(self,r):
        self._measurement_package_ready(r,active_boq=True)
        require(bool(r.get('evidenceIds')),'MEASUREMENT_SUBMISSION_READY','Quantity Measurement needs preserved source evidence')

    def _measurement_receipt_ready(self,r):
        self._measurement_package_ready(r)

    def _measurement_field_review_ready(self,r):
        self._measurement_package_ready(r)

    def _measurement_technical_review_ready(self,r):
        self._measurement_package_ready(r)
        require(bool(r.get('evidenceIds')),'MEASUREMENT_TECHNICAL_REVIEW_READY','Technical verification needs measurement evidence')

    def _measurement_payment_blocks(self,r):
        blocks=[]
        boq,line=self._measurement_package_ready(r)
        if not r.get('evidenceIds'):blocks.append('EVIDENCE_INCOMPLETE')
        for reference in r.get('inspectionRefs',[]):
            inspection=self._contract_ref(reference,r['projectId'],object_type='Inspection')
            if not (inspection.get('resultStatus')=='pass' and inspection.get('nextWorkAllowed') is True):
                blocks.append('INSPECTION_NOT_ACCEPTED')
            issue_id=inspection.get('relatedIssueId')
            if issue_id:
                try:issue=self.get('Issue',issue_id)
                except ContractError:issue=None
                if issue and issue.get('subtype')=='NCR' and issue.get('status') not in ['closed','cancelled','superseded']:
                    blocks.append('BLOCKING_NCR')
        accepted={'accepted','approved','passed','completed','closed','verified','released'}
        for reference in r.get('testRefs',[]):
            test=self._contract_ref(reference,r['projectId'])
            status=test.get('status')
            if status in ['failed','rejected']:blocks.append('TEST_FAILED')
            elif status not in accepted:blocks.append('TEST_PENDING')
        for reference in r.get('materialLotRefs',[]):
            material=self._contract_ref(reference,r['projectId'])
            if material.get('status') not in accepted:blocks.append('MATERIAL_NOT_ACCEPTED')
        approved_variation=False
        for reference in r.get('variationRefs',[]):
            variation=self._contract_ref(reference,r['projectId'],object_type='WorkItem',subtype='Variation')
            if variation.get('status')=='approved':approved_variation=True
            else:blocks.append('UNAPPROVED_VARIATION')
        if r.get('verifiedQuantity') is not None:
            cumulative=self._decimal_value(r.get('previousCertifiedQuantity','0'))+self._decimal_value(r['verifiedQuantity'])
            if cumulative>self._decimal_value(line['contractQuantity']) and not approved_variation:
                blocks.append('EXCEEDS_CONTRACT_QUANTITY')
        return list(dict.fromkeys(blocks))

    def _measurement_verification_ready(self,r):
        self._measurement_package_ready(r)
        self._decimal_value(r.get('verifiedQuantity'),'MEASUREMENT_VERIFICATION_READY','verifiedQuantity')
        require(bool(r.get('evidenceIds')),'MEASUREMENT_VERIFICATION_READY','Verified quantity needs current evidence')

    def _measurement_dispute_ready(self,r):
        self._measurement_package_ready(r)
        disputed=self._decimal_value(r.get('disputedQuantity'),'MEASUREMENT_DISPUTE_READY','disputedQuantity')
        require(disputed>0 and bool(r.get('disputeReason','').strip()),'MEASUREMENT_DISPUTE_READY','Disputed quantity and reason are required')
        if r.get('verifiedQuantity') is not None:self._decimal_value(r['verifiedQuantity'],'MEASUREMENT_DISPUTE_READY','verifiedQuantity')
        require(bool(r.get('evidenceIds')),'MEASUREMENT_DISPUTE_READY','Dispute record needs current evidence')

    def _measurement_resolution_ready(self,r):
        self._measurement_package_ready(r)
        self._decimal_value(r.get('verifiedQuantity'),'MEASUREMENT_RESOLUTION_READY','verifiedQuantity')
        resolution=self._contract_ref(r.get('resolutionRef'),r['projectId'])
        require(resolution.get('status') not in ['draft','requested','submitted'],'MEASUREMENT_RESOLUTION_READY','Dispute resolution reference must be decided or final')
        require(bool(r.get('evidenceIds')),'MEASUREMENT_RESOLUTION_READY','Measurement resolution needs current evidence')

    def _measurement_supersede_ready(self,r):
        replacement=self._current_reference(r.get('replacementRef'),r['projectId'],object_type='WorkItem',subtype='QuantityMeasurement')
        require(replacement['id']!=r['id'] and replacement.get('status')=='verified','MEASUREMENT_SUPERSEDE_READY','Replacement Measurement must be a different current verified record')
        require(replacement.get('data',{}).get('boqItemRef')==r.get('boqItemRef'),'MEASUREMENT_SUPERSEDE_READY','Replacement must retain the same exact BOQ item basis')

    def _payment_measurements(self,r,*,current=True):
        refs=r.get('quantityMeasurementRefs')
        require(isinstance(refs,list) and bool(refs),'PAYMENT_CLAIM_SUBMISSION_READY','PaymentClaim needs verified QuantityMeasurement references')
        require(len({(x.get('objectId'),x.get('version')) for x in refs})==len(refs),'REFERENCE_DUPLICATE','PaymentClaim measurement references must be unique')
        result=[]
        for reference in refs:
            measurement=(self._current_reference(reference,r['projectId'],object_type='WorkItem',subtype='QuantityMeasurement') if current
                         else self._contract_ref(reference,r['projectId'],object_type='WorkItem',subtype='QuantityMeasurement'))
            require(measurement.get('status')=='verified','QUANTITY_NOT_VERIFIED','PaymentClaim may use only verified QuantityMeasurement records')
            require(measurement.get('data',{}).get('boqRef')==r.get('boqRef'),'BOQ_VERSION_STALE','PaymentClaim and QuantityMeasurement must use the same exact ContractBOQ version')
            result.append(measurement)
        return result

    def _payment_previous_basis(self,r):
        previous_ref=r.get('previousPaymentClaimRef')
        previous_certified=self._decimal_value(r.get('previousCertifiedAmount','0'),'PAYMENT_CLAIM_SUBMISSION_READY','previousCertifiedAmount')
        previous_paid=self._decimal_value(r.get('previousPaidAmount','0'),'PAYMENT_CLAIM_SUBMISSION_READY','previousPaidAmount')
        if not previous_ref:
            require(previous_certified==0 and previous_paid==0,'PAYMENT_CLAIM_SUBMISSION_READY','First PaymentClaim must start with zero previous certified and paid amounts')
            return None
        previous=self._contract_ref(previous_ref,r['projectId'],object_type='WorkItem',subtype='PaymentClaim',statuses=['payment_recorded','closed'])
        data=previous.get('data',{})
        require(previous_certified==self._decimal_value(data.get('cumulativeCertifiedAmount','0')),'PAYMENT_CLAIM_SUBMISSION_READY','Previous certified amount must match the exact prior PaymentClaim')
        require(previous_paid==self._decimal_value(data.get('cumulativePaidAmount','0')),'PAYMENT_CLAIM_SUBMISSION_READY','Previous paid amount must match the exact prior PaymentClaim')
        require(data.get('currency')==r.get('currency'),'PAYMENT_CLAIM_SUBMISSION_READY','PaymentClaim currency cannot change across cumulative chain')
        return previous

    def _payment_duplicate_guard(self,r):
        current_measurements={x['objectId'] for x in r.get('quantityMeasurementRefs',[])}
        for (kind,object_id),record in self._records.items():
            if kind!='WorkItem' or object_id==r['id'] or record.get('subtype')!='PaymentClaim' or record['projectId']!=r['projectId']:
                continue
            if record.get('status') in ['draft','withdrawn','rejected','superseded','cancelled']:continue
            used={x.get('objectId') for x in record.get('data',{}).get('quantityMeasurementRefs',[])}
            require(not (current_measurements & used),'DUPLICATE_CLAIM','A verified QuantityMeasurement is already included in another active PaymentClaim')

    def _payment_claim_package_ready(self,r,*,active_boq=False,check_duplicate=False):
        required=['periodStart','periodEnd','contractRef','boqRef','currency','quantityMeasurementRefs','claimedGrossAmount','previousCertifiedAmount','previousPaidAmount']
        require(all(r.get(x) not in [None,'',[]] for x in required),'PAYMENT_CLAIM_SUBMISSION_READY','Payment period, contract, BOQ, measurements and claimed amount are required')
        require(instant(r['periodStart'])<=instant(r['periodEnd']),'PAYMENT_CLAIM_SUBMISSION_READY','Payment period is invalid')
        boq=self._boq_reference(r['boqRef'],r['projectId'],current=active_boq,statuses=['effective'] if active_boq else ['effective','superseded'])
        require(boq.get('boq',{}).get('currency')==r.get('currency'),'PAYMENT_CLAIM_SUBMISSION_READY','PaymentClaim currency must match ContractBOQ')
        contract=self._contract_ref(r['contractRef'],r['projectId'])
        require(contract.get('status') not in ['expired','cancelled','withdrawn'],'PAYMENT_CLAIM_SUBMISSION_READY','Contract basis is not valid')
        self._decimal_value(r['claimedGrossAmount'],'PAYMENT_CLAIM_SUBMISSION_READY','claimedGrossAmount')
        self._payment_measurements(r,current=active_boq)
        self._payment_previous_basis(r)
        if check_duplicate:self._payment_duplicate_guard(r)
        return boq

    def _payment_variation_amounts(self,r):
        eligible=Decimal('0');unapproved=Decimal('0')
        for component in r.get('variationComponents',[]):
            variation=self._contract_ref(component['variationRef'],r['projectId'],object_type='WorkItem',subtype='Variation')
            claimed=self._decimal_value(component['claimedAmount'],'PAYMENT_VARIATION_INVALID','variation claimedAmount')
            accepted=self._decimal_value(component['eligibleAmount'],'PAYMENT_VARIATION_INVALID','variation eligibleAmount')
            require(component.get('currency')==r.get('currency'),'PAYMENT_VARIATION_INVALID','Variation currency must match PaymentClaim')
            if variation.get('status')=='approved':
                require(accepted<=claimed,'PAYMENT_VARIATION_INVALID','Eligible Variation amount cannot exceed claimed amount')
                eligible+=accepted
            else:
                require(accepted==0,'UNAPPROVED_VARIATION','Unapproved Variation must have zero eligible amount')
                unapproved+=claimed
        return eligible,unapproved

    def _payment_claim_submission_ready(self,r):
        self._payment_claim_package_ready(r,active_boq=True,check_duplicate=True)
        require(bool(r.get('evidenceIds')),'PAYMENT_CLAIM_SUBMISSION_READY','PaymentClaim submission needs preserved evidence')
        self._payment_variation_amounts(r)

    def _payment_claim_receipt_ready(self,r):
        self._payment_claim_package_ready(r,check_duplicate=True)

    def _payment_quantity_review_ready(self,r):
        self._payment_claim_package_ready(r,check_duplicate=True)

    def _payment_valuation_review_ready(self,r):
        self._payment_claim_package_ready(r,check_duplicate=True)
        verified=self._decimal_value(r.get('verifiedGrossAmount'),'PAYMENT_VALUATION_REVIEW_READY','verifiedGrossAmount')
        claimed=self._decimal_value(r.get('claimedGrossAmount'),'PAYMENT_VALUATION_REVIEW_READY','claimedGrossAmount')
        disputed=self._decimal_value(r.get('disputedAmount'),'PAYMENT_VALUATION_REVIEW_READY','disputedAmount')
        require(verified<=claimed and disputed<=claimed,'PAYMENT_VALUATION_REVIEW_READY','Verified/disputed amount cannot exceed claimed amount')
        require(bool(r.get('evidenceIds')),'PAYMENT_VALUATION_REVIEW_READY','Valuation review needs current evidence')

    def _payment_calculation_rule(self,r):
        code='PAYMENT_RECOMMENDATION_PREPARE_READY'
        rule_record=self._contract_ref(r.get('calculationRuleRef'),r['projectId'],object_type='Requirement',statuses=['active'])
        require(all(rule_record.get(field)==r.get(field) for field in ['packageId','locationId','discipline']),code,'Payment calculation rule scope must match PaymentClaim')
        rule=rule_record.get('applicability',{}).get('paymentCalculationRule')
        require(isinstance(rule,dict),code,'Calculation Requirement must contain paymentCalculationRule')
        allowed={'verifiedGrossAmount','eligibleVariationAmount','eligibleMaterialOnSiteAmount','retentionAmount','advanceRecoveryAmount','otherDeductionAmount','taxAmount'}
        components=[]
        for name in ['baseComponents','addComponents','subtractComponents']:
            values=rule.get(name)
            require(isinstance(values,list) and all(isinstance(x,str) and x in allowed for x in values),code,name+' contains an unsupported component')
            components.extend(values)
        require(len(components)==len(set(components)),code,'Calculation rule components must not overlap')
        require(bool(rule.get('formulaId')),code,'Calculation rule formulaId is required')
        type_map=rule.get('deductionTypeMap')
        require(isinstance(type_map,dict) and all(isinstance(k,str) and k and v in rule['subtractComponents'] for k,v in type_map.items()),code,'Deduction type map is invalid')
        require({'retentionAmount','advanceRecoveryAmount','otherDeductionAmount'}<=set(type_map.values()),code,'Retention, advance recovery and other deduction must reconcile through deduction components')
        rounding=rule.get('rounding')
        require(isinstance(rounding,dict) and bool(rounding.get('id')),code,'Versioned rounding rule is required')
        quantum=self._decimal_value(rounding.get('quantum'),code,'rounding quantum')
        require(quantum>0,code,'Rounding quantum must be positive')
        modes={'half_up':ROUND_HALF_UP,'half_even':ROUND_HALF_EVEN,'down':ROUND_DOWN,'up':ROUND_UP}
        require(rounding.get('mode') in modes,code,'Unsupported rounding mode')
        return rule,modes[rounding['mode']],quantum

    def _payment_recommendation_calculation(self,r):
        code='PAYMENT_RECOMMENDATION_PREPARE_READY'
        for field in ['verifiedGrossAmount','eligibleVariationAmount','eligibleMaterialOnSiteAmount','retentionAmount','advanceRecoveryAmount','otherDeductionAmount','taxAmount','recommendedNetAmount']:
            self._decimal_value(r.get(field),code,field)
        eligible_variation,unapproved=self._payment_variation_amounts(r)
        require(self._decimal_value(r['eligibleVariationAmount'])==eligible_variation,code,'Eligible Variation amount must equal approved Variation components only')
        require(unapproved>=0,code,'Variation calculation failed')
        rule,rounding_mode,quantum=self._payment_calculation_rule(r)
        deduction_totals={field:Decimal('0') for field in ['retentionAmount','advanceRecoveryAmount','otherDeductionAmount']}
        type_map=rule['deductionTypeMap']
        for deduction in r.get('deductionComponents',[]):
            amount=self._decimal_value(deduction['amount'],code,'deduction amount')
            require(deduction.get('currency')==r.get('currency'),code,'Deduction currency must match PaymentClaim')
            self._contract_ref(deduction['contractClauseRef'],r['projectId'],object_type='Requirement')
            if deduction.get('sourceDecisionRef'):
                self._contract_ref(deduction['sourceDecisionRef'],r['projectId'],object_type='Decision')
            deduction_type=deduction.get('type')
            require(deduction_type in type_map,code,'Deduction component type is not mapped by the calculation rule')
            field=type_map[deduction_type]
            if field in deduction_totals: deduction_totals[field]+=amount
        for field,total in deduction_totals.items():
            require(self._decimal_value(r[field],code,field)==total,code,field+' must equal mapped deduction component total')
        base=sum((self._decimal_value(r[field],code,field) for field in rule['baseComponents']),Decimal('0'))
        additions=sum((self._decimal_value(r[field],code,field) for field in rule['addComponents']),Decimal('0'))
        deductions=sum((self._decimal_value(r[field],code,field) for field in rule['subtractComponents']),Decimal('0'))
        pre_round=base+additions-deductions
        require(pre_round>=0,code,'Calculated recommendation cannot be negative')
        rounded=(pre_round/quantum).quantize(Decimal('1'),rounding=rounding_mode)*quantum
        recommended=self._decimal_value(r['recommendedNetAmount'],code,'recommendedNetAmount')
        require(recommended==rounded,code,'Recommended amount must equal the versioned calculation rule result')
        rounding=rule['rounding']
        return {
            'ruleRef':deepcopy(r['calculationRuleRef']),
            'formulaId':rule['formulaId'],
            'baseAmount':self._decimal_text(base),
            'additionAmount':self._decimal_text(additions),
            'deductionAmount':self._decimal_text(deductions),
            'preRoundAmount':self._decimal_text(pre_round),
            'roundedAmount':self._decimal_text(rounded),
            'roundingRuleId':rounding['id'],
            'roundingQuantum':self._decimal_text(quantum),
            'roundingMode':rounding['mode'],
            'deductionTotals':{field:self._decimal_text(value) for field,value in deduction_totals.items()},
        }

    def _payment_recommendation_prepare_ready(self,r):
        self._payment_claim_package_ready(r,check_duplicate=True)
        self._payment_recommendation_calculation(r)

    def _payment_recommendation_ready(self,r):
        self._payment_recommendation_prepare_ready(r)
        require(bool(r.get('evidenceIds')),'PAYMENT_RECOMMENDATION_READY','Payment recommendation needs current evidence')

    def _payment_owner_review_ready(self,r):
        require(isinstance(r.get('recommendationSnapshot'),dict) and bool(r.get('recommendedAt')),'PAYMENT_OWNER_REVIEW_READY','Immutable supervisor recommendation snapshot is required')

    def _payment_owner_decision(self,r,expected):
        refs=r.get('decisionRefs')
        require(isinstance(refs,list) and bool(refs),'PAYMENT_OWNER_DECISION_REQUIRED','Owner Decision exact reference is required')
        matches=[]
        for reference in refs:
            decision=self._contract_ref(reference,r['projectId'],object_type='Decision',statuses=['decided','executing','verified','closed'])
            if (
                decision.get('targetRef')=={'objectType':'WorkItem','objectId':r['id'],'version':r['version']}
                and all(decision.get(field)==r.get(field) for field in ['packageId','locationId','discipline'])
                and decision.get('decision')==expected
            ):
                matches.append(decision)
        require(len(matches)==1,'PAYMENT_OWNER_DECISION_REQUIRED','Exactly one Owner Decision must target the exact current PaymentClaim version and outcome')
        return matches[0]

    def _payment_owner_approval_ready(self,r):
        self._payment_owner_review_ready(r);self._payment_owner_decision(r,'approved')
        approved=self._decimal_value(r.get('ownerApprovedAmount'),'PAYMENT_OWNER_APPROVAL_READY','ownerApprovedAmount')
        recommended=self._decimal_value(r.get('recommendedNetAmount'),'PAYMENT_OWNER_APPROVAL_READY','recommendedNetAmount')
        require(approved==recommended,'PAYMENT_OWNER_APPROVAL_READY','Use Owner adjustment command when approved amount differs from supervisor recommendation')

    def _payment_owner_adjustment_ready(self,r):
        self._payment_owner_review_ready(r);self._payment_owner_decision(r,'approved')
        approved=self._decimal_value(r.get('ownerApprovedAmount'),'PAYMENT_OWNER_ADJUSTMENT_READY','ownerApprovedAmount')
        recommended=self._decimal_value(r.get('recommendedNetAmount'),'PAYMENT_OWNER_ADJUSTMENT_READY','recommendedNetAmount')
        require(approved!=recommended and bool(r.get('adjustmentReason','').strip()),'PAYMENT_OWNER_ADJUSTMENT_READY','Owner adjustment requires a different amount and explicit reason')

    def _payment_owner_rejection_ready(self,r):
        self._payment_owner_review_ready(r);self._payment_owner_decision(r,'rejected')

    def _payment_active_total(self,r):
        records=r.get('paymentRecords') or []
        superseded={x.get('supersedesPaymentRecordId') for x in records if x.get('supersedesPaymentRecordId')}
        return sum((self._decimal_value(x['amount'],'PAYMENT_RECORD_READY','payment record amount') for x in records if x['recordId'] not in superseded and x.get('kind') in ['payment','correction']),Decimal('0'))

    def _payment_record_target(self,r,code):
        target_id=r.get('supersedesPaymentRecordId')
        records=r.get('paymentRecords') or []
        targets=[x for x in records if x.get('recordId')==target_id]
        require(len(targets)==1,code,'Correction/cancellation must target one existing payment record')
        superseded={x.get('supersedesPaymentRecordId') for x in records if x.get('supersedesPaymentRecordId')}
        require(target_id not in superseded,code,'Payment record is already superseded')
        require(targets[0].get('kind') in ['payment','correction'],code,'Cancellation records cannot be corrected or cancelled again')
        return targets[0]

    def _payment_reference_unique(self,r,code):
        reference=r.get('paymentReference','').strip()
        external=r.get('externalSystemRef','').strip()
        require(bool(reference),code,'External payment reference is required')
        for (kind,_),record in self._records.items():
            if kind!='WorkItem' or record.get('projectId')!=r.get('projectId') or record.get('subtype')!='PaymentClaim':continue
            for item in record.get('data',{}).get('paymentRecords',[]):
                require(item.get('paymentReference')!=reference,'PAYMENT_REFERENCE_DUPLICATE','Payment reference is already recorded')
                if external:require(item.get('externalSystemRef')!=external,'PAYMENT_REFERENCE_DUPLICATE','External system reference is already recorded')

    def _payment_record_ready(self,r):
        code='PAYMENT_RECORD_READY'
        approved=self._decimal_value(r.get('ownerApprovedAmount'),code,'ownerApprovedAmount')
        amount=self._decimal_value(r.get('paymentAmount'),code,'paymentAmount')
        require(amount>0,code,'Payment transaction amount must be positive')
        require(self._payment_active_total(r)+amount<=approved,code,'Cumulative active payments cannot exceed Owner approved amount')
        require(bool(r.get('paidAt')) and bool(r.get('paymentReference','').strip()),code,'Actual payment date and external payment reference are required')
        self._payment_reference_unique(r,code)

    def _payment_correction_ready(self,r):
        code='PAYMENT_CORRECTION_READY'
        approved=self._decimal_value(r.get('ownerApprovedAmount'),code,'ownerApprovedAmount')
        target=self._payment_record_target(r,code)
        amount=self._decimal_value(r.get('paymentAmount'),code,'paymentAmount')
        require(amount>0 and bool(r.get('correctionReason','').strip()),code,'Payment correction needs positive amount and reason')
        require(bool(r.get('paidAt')) and bool(r.get('paymentReference','').strip()),code,'Payment correction needs effective date and reference')
        projected=self._payment_active_total(r)-self._decimal_value(target['amount'],code,'target amount')+amount
        require(projected>=0 and projected<=approved,code,'Corrected cumulative payment cannot exceed Owner approved amount')
        self._payment_reference_unique(r,code)

    def _payment_cancellation_ready(self,r):
        code='PAYMENT_CANCELLATION_READY'
        target=self._payment_record_target(r,code)
        require(bool(r.get('correctionReason','').strip()),code,'Payment cancellation needs reason')
        require(bool(r.get('paidAt')) and bool(r.get('paymentReference','').strip()),code,'Payment cancellation needs effective date and reference')
        require(self._payment_active_total(r)-self._decimal_value(target['amount'],code,'target amount')>=0,code,'Payment cancellation total is invalid')
        self._payment_reference_unique(r,code)

    def _payment_close_ready(self,r):
        require(self._decimal_value(r.get('unpaidBalance'),'PAYMENT_CLOSE_READY','unpaidBalance')==0,'PAYMENT_CLOSE_READY','PaymentClaim cannot close while approved amount remains unpaid')
        require(bool(r.get('paymentRecords')),'PAYMENT_CLOSE_READY','At least one preserved Actual Payment Record is required before close')

    def _payment_supersede_ready(self,r):
        replacement=self._current_reference(r.get('replacementRef'),r['projectId'],object_type='WorkItem',subtype='PaymentClaim')
        require(replacement['id']!=r['id'] and replacement.get('status')=='closed','PAYMENT_SUPERSEDE_READY','Replacement PaymentClaim must be a different current closed record')
        for field in ['packageId','locationId','discipline','responsibleOrganizationId']:
            require(replacement.get(field)==r.get(field),'PAYMENT_SUPERSEDE_READY','Replacement PaymentClaim must retain the same work scope')

    def _eot_rejected_close_ready(self,r):
        require(r.get('decisionOutcome')=='rejected','EOT_REJECTED_CLOSE_READY','Only rejected EOT may close without Baseline revision')

    def _effective_contract_boqs(self,record,exclude_id=None):
        contract_id=record.get('boq',{}).get('contractRef',{}).get('objectId')
        scope_fields=['packageId','locationId','discipline','responsibleOrganizationId']
        output=[]
        for (kind,object_id),candidate in self._records.items():
            if kind!='InformationItem' or object_id==exclude_id or candidate.get('subtype')!='ContractBOQ':
                continue
            if candidate.get('projectId')!=record.get('projectId') or candidate.get('status')!='effective':
                continue
            if candidate.get('boq',{}).get('contractRef',{}).get('objectId')!=contract_id:
                continue
            if any(candidate.get(field)!=record.get(field) for field in scope_fields):
                continue
            output.append(self.get('InformationItem',object_id))
        return output

    def _activate_contract_boq(self,before,proposed,request,party_id,role_id,key):
        prior=self._effective_contract_boqs(proposed,exclude_id=proposed['id'])
        require(len(prior)<=1,'BOQ_ACTIVATION_READY','Multiple effective ContractBOQ records exist in one contract scope')
        if prior:
            proposed['boq']['supersedesRef']={'objectType':'InformationItem','objectId':prior[0]['id'],'version':prior[0]['version']}
        validate(proposed,self.schemas['InformationItem'],self.schemas)
        snapshot=(deepcopy(self._records),deepcopy(self._history),deepcopy(self._audit),deepcopy(self._idempotency),deepcopy(self._record_machines))
        try:
            self._save('InformationItem',proposed)
            result=self._event(proposed,'contract_boq:activate_boq',party_id,role_id,key,request,before)
            if prior:
                old=prior[0]
                updated=deepcopy(old)
                updated.update(status='superseded',version=old['version']+1,updatedAt=self.at())
                validate(updated,self.schemas['InformationItem'],self.schemas)
                self._save('InformationItem',updated)
                self._event(updated,'contract_boq:derived_supersede',party_id,role_id,key,request,old)
            self._remember(proposed['projectId'],party_id,'contract_boq:activate_boq',key,request,result)
            return result
        except Exception:
            self._records,self._history,self._audit,self._idempotency,self._record_machines=snapshot
            raise

    def _activate_schedule_baseline(self,before,proposed,request,party_id,role_id,key):
        prior=self._effective_baselines(proposed,exclude_id=proposed['id'])
        require(len(prior)<=1,'SCHEDULE_BASELINE_ACTIVATION_READY','Multiple effective baselines exist in one scope')
        if prior:proposed['schedule']['supersedesRef']={'objectType':'InformationItem','objectId':prior[0]['id'],'version':prior[0]['version']}
        validate(proposed,self.schemas['InformationItem'],self.schemas)
        snapshot=(deepcopy(self._records),deepcopy(self._history),deepcopy(self._audit),deepcopy(self._idempotency),deepcopy(self._record_machines))
        try:
            self._save('InformationItem',proposed)
            result=self._event(proposed,'schedule_baseline:activate_baseline',party_id,role_id,key,request,before)
            if prior:
                old=prior[0];updated=deepcopy(old);updated.update(status='superseded',version=old['version']+1,updatedAt=self.at())
                validate(updated,self.schemas['InformationItem'],self.schemas);self._save('InformationItem',updated)
                self._event(updated,'schedule_baseline:derived_supersede',party_id,role_id,key,request,old)
            self._remember(proposed['projectId'],party_id,'schedule_baseline:activate_baseline',key,request,result)
            return result
        except Exception:
            self._records,self._history,self._audit,self._idempotency,self._record_machines=snapshot
            raise

    def _freeze_schedule_progress(self,before,proposed,request,party_id,role_id,key):
        reference=proposed['schedule'].get('previousScheduleRef');prior=None
        if reference:
            prior=self._current_schedule_reference(reference,proposed['projectId'],kind='progress_update',statuses=['frozen'])
            proposed['schedule']['supersedesRef']={'objectType':'InformationItem','objectId':prior['id'],'version':prior['version']}
        validate(proposed,self.schemas['InformationItem'],self.schemas)
        snapshot=(deepcopy(self._records),deepcopy(self._history),deepcopy(self._audit),deepcopy(self._idempotency),deepcopy(self._record_machines))
        try:
            self._save('InformationItem',proposed)
            result=self._event(proposed,'schedule_progress:freeze_progress',party_id,role_id,key,request,before)
            if prior:
                old=prior;updated=deepcopy(old);updated.update(status='superseded',version=old['version']+1,updatedAt=self.at())
                validate(updated,self.schemas['InformationItem'],self.schemas);self._save('InformationItem',updated)
                self._event(updated,'schedule_progress:derived_supersede',party_id,role_id,key,request,old)
            self._remember(proposed['projectId'],party_id,'schedule_progress:freeze_progress',key,request,result)
            return result
        except Exception:
            self._records,self._history,self._audit,self._idempotency,self._record_machines=snapshot
            raise

    def _checks_complete(self,r):
        checks=r.get('checkResults',[])
        if not checks or len({c['itemId'] for c in checks})!=len(checks):return False
        required={x for ref in r.get('requirementRefs',[]) for x in self.resolve(ref,r['projectId']).get('requiredFields',[])}
        return required<=set(c['itemId'] for c in checks) and all(c['evidenceIds'] and (c['result']!='not_applicable' or bool(c.get('note'))) for c in checks)

    def _observation_grounded(self, record):
        require(bool(record.get('grounding')),'OBSERVATION_GROUNDED','Observation needs source evidence')
        for grounding in record['grounding']:
            evidence=self.get('Evidence',grounding['evidenceId'])
            require(evidence['projectId']==record['projectId'],'EVIDENCE_INVALID','Observation evidence scope')
            if grounding.get('range'):self._range_valid(grounding['range'],evidence)
        if record.get('source')=='ai':
            require(bool(record.get('analysisRunId')),'ANALYSIS_RUN_REQUIRED','AI proposal needs run provenance')
            run=self.get('AnalysisRun',record['analysisRunId'])
            require(run['projectId']==record['projectId'] and run['status']=='succeeded','ANALYSIS_NOT_COMPLETE','AI run must be preserved and completed')
            require(all(g['evidenceId'] in run['sourceEvidenceIds'] or self.get('Evidence',g['evidenceId']).get('originalEvidenceId') in run['sourceEvidenceIds'] for g in record['grounding']),'ANALYSIS_SOURCE_MISMATCH','Grounding outside analysis run')
            require(isinstance(record.get('confidence'),(int,float)) and 0<=record['confidence']<=1,'CONFIDENCE_INVALID','Reference score in [0,1]')

    def _range_valid(self, value, evidence):
        require(0<=value['startMs']<=value['endMs']<=evidence.get('durationMs',0),'MEDIA_RANGE_INVALID','Source range outside original duration')
        if 'frameIndex' in value:require(value['frameIndex']<evidence.get('frameCount',0),'MEDIA_RANGE_INVALID','Frame outside original manifest')
        if 'ptsMs' in value:require(value['startMs']<=value['ptsMs']<=value['endMs'],'MEDIA_RANGE_INVALID','Frame PTS outside range')

    def _check_derivation(self, evidence):
        parent=self.get('Evidence',evidence['originalEvidenceId'])
        require(parent['sourceType']=='original' and parent['projectId']==evidence['projectId'],'DERIVED_PARENT_INVALID','Derived evidence needs same-project original')
        self._range_valid(evidence['sourceRange'],parent)
        run=self.get('AnalysisRun',evidence['derivationRunId'])
        require(run['projectId']==evidence['projectId'] and parent['id'] in run['sourceEvidenceIds'],'DERIVED_RUN_INVALID','Derivation run must reference the original')

    def _signed_doc(self, inspection, expected_result):
        candidates=list(getattr(self,'documents',{}).values())
        if inspection.get('acceptanceDocumentId'):candidates=[d for d in candidates if d['id']==inspection['acceptanceDocumentId']]
        subject=dict(objectType='Inspection',objectId=inspection['id'],version=inspection['version'])
        doc=next((d for d in candidates if d['formId']=='FM-09' and d['status']=='signed' and d.get('primarySourceRef')==subject),None)
        require(doc and doc['projectId']==inspection['projectId'] and doc['status']=='signed','ACCEPTANCE_SIGNED','All required acceptance signatures must be present')
        require([x for x in doc['sourceDomainRefs'] if x['objectType']=='Inspection']==[subject], 'ACCEPTANCE_VERSION_MISMATCH','Acceptance has exactly one inspection subject at the result version')
        data=doc['sourcePayload']['data']
        require(data['inspection']['no']==inspection['id'] and data['result']['status']==expected_result,'ACCEPTANCE_VERSION_MISMATCH','Signed result must identify this inspection')
        require(inspection.get('resultStatus')==expected_result,'INSPECTION_RESULT_MISMATCH','Acceptance must match preserved result')

    def _acceptance_signed(self,r):self._signed_doc(r,'pass')
    def _failure_signed(self,r):self._signed_doc(r,'fail')

    def _hold_approval_valid(self,r):
        if not r.get('holdPoint'):return
        approval=next((a for (k,i),a in self._records.items() if k=='Approval' and a['status']=='approved' and a['targetRef']==dict(objectType='Inspection',objectId=r['id'],version=r['version'])),None)
        require(bool(approval),'HOLD_APPROVAL_VALID','Hold release needs an exact-version approval')
        require(approval['projectId']==r['projectId'] and approval['status']=='approved' and approval['approvalKind']=='technical' and approval['targetRef']==dict(objectType='Inspection',objectId=r['id'],version=r['version']),'HOLD_APPROVAL_VALID','Hold approval must bind the exact result version')
        if approval.get('expiresAt'):require(instant(self.at())<instant(approval['expiresAt']),'HOLD_APPROVAL_VALID','Hold approval expired')

    def _corrective_action_submitted(self,r):
        actions=[self.get('Action',aid) for aid in r.get('actionIds',[])]
        actions=[a for a in actions if a.get('correctionCycle')==r['correctionCycle']]
        require(bool(actions),'CORRECTIVE_ACTION_SUBMITTED','This correction cycle needs its own corrective action')
        for a in actions:
            require(a['projectId']==r['projectId'] and a.get('relatedIssueId')==r['id'] and a['status'] in ['submitted','verified','closed'],'CORRECTIVE_ACTION_SUBMITTED','Action must have submitted evidence')

    def _action_issue_match(self,r):
        require(bool(r.get('actionIds')),'ACTION_ISSUE_MATCH','Linked action required')
        for aid in r['actionIds']:
            a=self.get('Action',aid)
            require(a['projectId']==r['projectId'] and a.get('relatedIssueId')==r['id'] and a.get('responsibleOrganizationId')==r.get('responsibleOrganizationId'),'ACTION_ISSUE_MATCH','Action must belong to the same issue and contractor')

    def _current_actions_verified(self,r):
        self._corrective_action_submitted(r)
        actions=[self.get('Action',aid) for aid in r['actionIds']]
        require(all(a['status'] in ['verified','closed'] for a in actions if a.get('correctionCycle')==r['correctionCycle']),'CURRENT_ACTIONS_VERIFIED','Current cycle corrective actions must be verified')

    def _closure_evidence_valid(self,r,payload):
        closure_ids=payload.get('closureEvidenceIds')
        require(isinstance(closure_ids,list) and bool(closure_ids),'CLOSURE_EVIDENCE_REQUIRED','Issue closure must explicitly select closure evidence')
        require(len(closure_ids)==len(set(closure_ids)),'CLOSURE_EVIDENCE_SCOPE_INVALID','Closure evidence references must be unique')
        actions=[self.get('Action',aid) for aid in r.get('actionIds',[])]
        current_actions=[action for action in actions if action.get('correctionCycle')==r['correctionCycle']]
        action_evidence={
            eid for action in current_actions if action.get('status') in ['verified','closed']
            for eid in action.get('evidenceIds',[])
        }
        reinspection=self._latest_reinspection(r)
        reinspection_evidence=set(reinspection.get('evidenceIds',[]))
        for result in reinspection.get('checkResults',[]):
            reinspection_evidence.update(result.get('evidenceIds',[]))
        selected=set(closure_ids)
        require(bool(selected & action_evidence),'CLOSURE_ACTION_EVIDENCE_REQUIRED','Closure evidence must include current-cycle verified corrective-action evidence')
        require(bool(selected & reinspection_evidence),'CLOSURE_REINSPECTION_EVIDENCE_REQUIRED','Closure evidence must include current-cycle passed-reinspection evidence')
        require(selected <= action_evidence | reinspection_evidence,'CLOSURE_EVIDENCE_SCOPE_INVALID','Closure evidence must come from the current correction cycle')
        for eid in closure_ids:
            evidence=self.get('Evidence',eid)
            require(evidence['projectId']==r['projectId'],'CLOSURE_EVIDENCE_SCOPE_INVALID','Closure evidence belongs to another project')
            for field in ['packageId','locationId','discipline','responsibleOrganizationId']:
                if evidence.get(field) is not None and r.get(field) is not None:
                    require(evidence[field]==r[field],'CLOSURE_EVIDENCE_SCOPE_INVALID','Closure evidence must match the issue work scope')
        return True

    def _decision_package_complete(self,r):
        require(len(r.get('options',[]))>=1 and bool(r.get('impact')) and bool(r.get('recommendation')) and bool(r.get('dueAt')) and bool(r.get('reportId')),'DECISION_PACKAGE_COMPLETE','Decision requires options, impact, recommendation, deadline and issued report')
        report=self.get('InformationItem',r['reportId'])
        require(report['projectId']==r['projectId'] and report.get('subtype')=='Report' and report['status'] in ['issued','acknowledged','followup'],'DECISION_PACKAGE_COMPLETE','Owner decision must link an issued report')

    def _new_reinspection_linked(self,r):
        inspection=self._latest_reinspection(r)
        prior={**r,'inspectionIds':[i for i in r['inspectionIds'] if i!=inspection['id']]}
        self._verification_link(inspection,prior)

    def _verification_link(self, inspection, issue):
        require(inspection['projectId']==issue['projectId'] and inspection.get('correctionCycle')==issue['correctionCycle'], 'REINSPECTION_CYCLE_INVALID','Verification must use the same issue and correction cycle')
        require(all(inspection.get(f)==issue.get(f) for f in ['packageId','locationId','discipline','responsibleOrganizationId']), 'REINSPECTION_CYCLE_INVALID','Verification must use the issue work scope')
        previous=inspection.get('previousInspectionId')
        if not issue['inspectionIds']:
            require(issue['correctionCycle']==0 and previous is None,'REINSPECTION_CYCLE_INVALID','First verification has no invented predecessor')
            return
        require(previous==issue['inspectionIds'][-1] and previous!=inspection['id'],'REINSPECTION_CYCLE_INVALID','Reinspection must retain the immediately preceding inspection')
        original=self.get('Inspection',previous)
        require(original['projectId']==issue['projectId'] and all(original.get(f)==issue.get(f) for f in ['packageId','locationId','discipline','responsibleOrganizationId']) and original.get('relatedIssueId',issue['id'])==issue['id'], 'REINSPECTION_CYCLE_INVALID','Preceding inspection must belong to this issue work scope')

    def _rfi_package_complete(self,r):
        require(bool(r.get('question','').strip()) and bool(r.get('references')) and bool(r.get('dueAt')), 'RFI_PACKAGE_COMPLETE','RFI requires a question, source references and response deadline')
        for reference in r['references']:self.resolve(reference,r['projectId'])

    def _reinspection_passed(self,r):
        inspection=self._latest_reinspection(r)
        require(inspection.get('resultStatus')=='pass' and inspection['status']=='completed' and inspection.get('nextWorkAllowed') is True,'REINSPECTION_PASSED','Signed, released reinspection required before closure')

    def _reinspection_failed(self,r):
        inspection=self._latest_reinspection(r)
        require(inspection.get('resultStatus')=='fail','REINSPECTION_FAILED','Rework requires a recorded failed reinspection')

    def _approval_target_current(self,r):
        reference=r.get('targetRef') or r.get('approvalTargetRef')
        if not reference and r.get('decisionId'):
            decision=self.get('Decision',r['decisionId']);reference=decision.get('targetRef')
        require(bool(reference),'APPROVAL_TARGET_CURRENT','Version-specific approval target required')
        original=self.resolve(reference,r['projectId']);current=self.get(reference['objectType'],reference['objectId'])
        require(original['version']==current['version'],'APPROVAL_TARGET_CURRENT','Approval cannot target a stale object revision')

    def _owner_decision_approved(self,r):
        require(bool(r.get('decisionId')),'OWNER_DECISION_APPROVED','Owner decision required')
        d=self.get('Decision',r['decisionId'])
        require(d['projectId']==r['projectId'] and d['status'] in ['decided','executing','verified','closed'] and d.get('decision')=='approved','OWNER_DECISION_APPROVED','Owner has not approved this change')
        target=d.get('targetRef',{})
        require(target.get('objectType')=='WorkItem' and target.get('objectId')==r['id'], 'OWNER_DECISION_APPROVED', 'Decision belongs to this change')

    def _approved_information_present(self,r):
        require(bool(r.get('revisedInformationRef')),'APPROVED_INFORMATION_PRESENT','Revised information required')
        item=self.resolve(r['revisedInformationRef'],r['projectId'])
        require(item['status']=='approved','APPROVED_INFORMATION_PRESENT','Revised information not approved')
        require(self.get(r['revisedInformationRef']['objectType'],item['id'])['version']==item['version'],'APPROVED_INFORMATION_PRESENT','Revised information must be current')

    def revise_requirement(self, object_id, expected_version, changes, party_id, role_id, key):
        record=self.get('Requirement',object_id)
        self.authorize(record,'manage_requirement_baseline',party_id,role_id)
        request=dict(id=object_id,expectedVersion=expected_version,changes=changes,role=role_id)
        cached=self._replay(record['projectId'],party_id,'requirement:revise',key,request)
        if cached:return cached
        require(record['version']==expected_version,'VERSION_CONFLICT','Requirement version changed')
        allowed={'title','sourceUrl','article','effectiveFrom','effectiveTo','applicability','requiredFields','requiredSignatures','status'}
        require(bool(changes) and not set(changes)-allowed,'IMMUTABLE_FIELD','Only controlled baseline fields may change')
        revised={**record,**deepcopy(changes),'version':record['version']+1,'updatedAt':self.at()}
        validate(revised,self.schemas['Requirement'],self.schemas)
        self._save('Requirement',revised)
        result=self._event(revised,'requirement:revise',party_id,role_id,key,request,record)
        self._remember(record['projectId'],party_id,'requirement:revise',key,request,result)
        return result

    def _change_approval_valid(self,r):
        require(r['status']=='revised_information_issued','CHANGE_APPROVAL_VALID','Approved revision must be issued first')
        self._owner_decision_approved(r);self._approved_information_present(r)

    def _linked_actions_closed(self,r):
        require(bool(r.get('actionIds')),'LINKED_ACTIONS_CLOSED','Action linkage required')
        for aid in r['actionIds']:
            action=self.get('Action',aid)
            require(action['projectId']==r['projectId'] and action.get('decisionId')==r['id'] and action['status']=='closed','LINKED_ACTIONS_CLOSED','Decision actions not verified and closed')

    def _report_followup_closed(self,r):
        report=r['report']
        for aid in report['actionIds']:
            action=self.get('Action',aid)
            require(action['projectId']==r['projectId'] and action.get('reportId')==r['id'] and action['status']=='closed','REPORT_FOLLOWUP_CLOSED','Report action incomplete')
        for did in report['decisionIds']:
            decision=self.get('Decision',did)
            require(decision['projectId']==r['projectId'] and decision.get('reportId')==r['id'] and decision['status']=='closed','REPORT_FOLLOWUP_CLOSED','Report decision incomplete')
        require(report['informationOnly'] or report['actionIds'] or report['decisionIds'],'REPORT_FOLLOWUP_CLOSED','Untracked report cannot close')

    def _analysis_inspection_context(self,r):
        ref=r.get('inspectionRef')
        if not ref:return
        require(ref.get('objectType')=='Inspection','INSPECTION_LINK_INVALID','Analysis inspectionRef must reference Inspection')
        inspection=self.resolve(ref,r['projectId'])
        for eid in r.get('sourceEvidenceIds',[]):
            source=self.get('Evidence',eid)
            require(source['projectId']==r['projectId'],'PROJECT_MISMATCH','Analysis evidence belongs to another project')
            for field in ['packageId','locationId','discipline','responsibleOrganizationId']:
                if source.get(field) is not None and inspection.get(field) is not None:
                    require(source[field]==inspection[field],'ANALYSIS_SCOPE_MISMATCH','Analysis evidence scope must match inspectionRef')

    def _analysis_sources_ready(self,r):
        require(bool(r.get('sourceEvidenceIds')),'ANALYSIS_SOURCES_READY','Analysis needs verified source files')
        self._analysis_inspection_context(r)
        for eid in r['sourceEvidenceIds']:
            e=self.get('Evidence',eid)
            require(e['projectId']==r['projectId'] and e['sourceType']=='original','ANALYSIS_SOURCES_READY','Analysis starts from preserved original')

    def _analysis_outputs_grounded(self,r):
        from .media import validate_analysis_outputs
        validate_analysis_outputs(r,[self.get('Evidence',eid) for eid in r['sourceEvidenceIds']])
        for output in r.get('outputs',[]):
            if output['kind']=='frame':
                evidence=self.get('Evidence',output['derivedEvidenceId'])
                require(evidence.get('originalEvidenceId')==output['sourceEvidenceId'] and evidence.get('derivationRunId')==r['id'] and evidence.get('sourceRange',{}).get('frameIndex')==output['frameIndex'] and evidence['sourceRange'].get('ptsMs')==output['ptsMs'],'DERIVED_RUN_INVALID','Frame result must resolve to the preserved derived file and PTS')

    def add_evidence(self, evidence_id, project_id, payload, content, party_id, role_id, key):
        request=dict(id=evidence_id,payload=payload,hash=hashlib.sha256(content).hexdigest(),role=role_id)
        require(not set(payload)&{'id','projectId','version','createdAt','updatedAt','createdBy','submittedBy','uploadedAt'},'IMMUTABLE_FIELD','Server evidence metadata')
        record=dict(deepcopy(payload),id=evidence_id,projectId=project_id,version=1,createdAt=self.at(),updatedAt=self.at(),createdBy=party_id,submittedBy=party_id,uploadedAt=self.at())
        self.authorize(record,'create_evidence',party_id,role_id)
        cached=self._replay(project_id,party_id,'evidence:create',key,request)
        if cached is not None:return cached
        require(record['fileHash']==hashlib.sha256(content).hexdigest(),'CHECKSUM_MISMATCH','Server hash verification failed')
        source=self.get('Party',record['sourcePartyId']);require(source['projectId']==project_id,'SOURCE_PARTY_INVALID','Source party may be a lab/external reviewer; must retain its identity')
        validate(record,self.schemas['Evidence'],self.schemas)
        if record['sourceType']=='derived':self._check_derivation(record)
        require(('Evidence',evidence_id) not in self._records,'EVIDENCE_IMMUTABLE','Original or derived evidence cannot be overwritten')
        self._save('Evidence',record)
        result=self._event(record,'evidence:create',party_id,role_id,key,request,None);self._remember(project_id,party_id,'evidence:create',key,request,result)
        return result

    def index_media_evidence(self, evidence_id, duration_ms, frame_pts_ms, metadata, party_id, role_id, key):
        """Attach trusted decoder metadata without changing original evidence bytes/provenance."""
        record=self.get('Evidence',evidence_id)
        request=dict(id=evidence_id,durationMs=duration_ms,framePtsMs=frame_pts_ms,metadata=metadata,role=role_id)
        self.authorize(record,'run_analysis',party_id,role_id)
        cached=self._replay(record['projectId'],party_id,'evidence:index-media',key,request)
        if cached is not None:return cached
        require(record['sourceType']=='original' and record['mediaType'] in ['video','audio'],'MEDIA_INDEX_INVALID','Only original video/audio evidence is indexed')
        require(type(duration_ms) is int and 0<duration_ms<=3600000,'MEDIA_INDEX_INVALID','Duration must be a positive millisecond value within the project media limit')
        require(isinstance(metadata,dict),'MEDIA_INDEX_INVALID','Media metadata must be structured')
        require('framePtsMs' not in metadata,'MEDIA_INDEX_INVALID','Frame PTS must use the trusted framePtsMs field')
        proposed=deepcopy(record)
        proposed['durationMs']=duration_ms
        proposed['metadata']={**deepcopy(record.get('metadata',{})),**deepcopy(metadata)}
        if record['mediaType']=='video':
            require(isinstance(frame_pts_ms,list) and bool(frame_pts_ms),'MEDIA_INDEX_INVALID','Video indexing requires the decoder PTS manifest')
            require(all(type(v) is int and 0<=v<=duration_ms for v in frame_pts_ms),'MEDIA_INDEX_INVALID','Frame PTS must stay inside original duration')
            require(all(a<=b for a,b in zip(frame_pts_ms,frame_pts_ms[1:])),'MEDIA_INDEX_INVALID','Frame PTS must preserve decoder order')
            proposed['frameCount']=len(frame_pts_ms)
            proposed['metadata']['framePtsMs']=list(frame_pts_ms)
        else:
            require(frame_pts_ms in [None,[]],'MEDIA_INDEX_INVALID','Audio indexing does not accept video frame PTS')
            proposed.pop('frameCount',None)
            proposed['metadata'].pop('framePtsMs',None)
        proposed['version']=record['version']+1
        proposed['updatedAt']=self.at()
        validate(proposed,self.schemas['Evidence'],self.schemas)
        self._save('Evidence',proposed)
        result=self._event(proposed,'evidence:index-media',party_id,role_id,key,request,record)
        self._remember(record['projectId'],party_id,'evidence:index-media',key,request,result)
        return result

    def projections(self, register_id, party_id, role_id):
        from .projections import calculate,joined_refs
        mapping=load('schema/register_projection_map_v2.json')
        require(register_id in [x['register_id'] for x in mapping['registers']],'REGISTER_UNKNOWN',register_id)
        projection=next(x for x in mapping['registers'] if x['register_id']==register_id)
        output=[];visible={}
        for (kind,oid),record in self._records.items():
            try:
                self.authorize_read(record,party_id,role_id)
            except ContractError:continue
            visible[(kind,oid)]=record
        for (kind,oid),record in visible.items():
            if not any(s['object_type']==kind and (s['subtype'] is None or record.get('subtype',record.get('kind'))==s['subtype']) for s in projection['sources']):continue
            calculated={field:calculate({**rule,'_now':self.at()},record) for field,rule in projection['calculation_rules'].items()}
            related=joined_refs(projection,kind,record,visible)
            output.append(dict(sourceDomainRefs=[dict(objectType=kind,objectId=oid,version=record['version'])]+related,data=deepcopy(record),calculated=calculated,unavailableFields=[field for field,value in calculated.items() if value is None]))
        return output

    def views(self, view_id, party_id, role_id):
        """Deduplicated query views over authoritative projections, with no writes."""
        require(view_id in ['V-01','V-02','V-03','V-04'],'VIEW_UNKNOWN',view_id)
        if view_id=='V-04':registers=['04']
        elif view_id=='V-03':registers=['22']
        else:registers=[p['register_id'] for p in load('schema/register_projection_map_v2.json')['registers'] if p['mode']=='actionable']
        rows={}
        for register in registers:
            for row in self.projections(register,party_id,role_id):
                record=row['data'];ref=row['sourceDomainRefs'][0]
                if view_id in ['V-01','V-02'] and (ref['objectType'] not in ['Issue','WorkItem','Action','Decision','Approval','Inspection','InformationItem'] or record.get('status') in ['closed','completed','cancelled','superseded','withdrawn']):continue
                if view_id=='V-02':
                    due=record.get('dueAt') or record.get('report',{}).get('dueAt')
                    if not due or instant(due)>=instant(self.at()):continue
                if view_id=='V-03' and not (ref['objectType']=='Decision' and record['status'] in ['reported','awaiting_decision','supplement_requested']):continue
                rows[(ref['objectType'],ref['objectId'])]=row
        return list(rows.values())

    @property
    def audit_events(self):return deepcopy(self._audit)

    def run_sla(self, party_id, role_id):
        """Deterministic in-app escalation intents; never auto-decides or sends email."""
        intents=[]
        for (kind,oid),record in self._records.items():
            if kind!='InformationItem' or record.get('subtype')!='Report' or record.get('status') not in ['issued','acknowledged','followup']:continue
            self.authorize(record,'notify_sla',party_id,role_id)
            data=record['report'];deadline=data['receiptDueAt'] if record['status']=='issued' else data['dueAt']
            if instant(self.at())<=instant(deadline):continue
            key=(record['projectId'],oid,record['status'],deadline)
            if key in self._escalation_keys:continue
            self._escalation_keys.add(key)
            intents.append(dict(reportId=oid,projectId=record['projectId'],deadline=deadline,reason='receipt_overdue' if record['status']=='issued' else 'followup_overdue',recipients=list(data['recipients'])))
        return intents
