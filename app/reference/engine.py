"""Dependency-free, in-memory command execution for the supervision contracts.

The runner is a reference for DB/API implementations, not a deployed service.
The application must supply an authenticated party ID; role IDs are resolved from
trusted storage, never accepted as caller-provided authority objects. Transactions,
locks, authentication, durable files and media workers need production adapters.
"""
from copy import deepcopy
from datetime import datetime, timezone
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
        return deepcopy(source[key])

    def resolve(self, reference, project_id=None):
        record = self.get(reference['objectType'], reference['objectId'], reference['version'])
        if project_id:
            require(record['projectId'] == project_id, 'PROJECT_MISMATCH', 'Reference belongs to another project')
        return record

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
        validate(record,self.schemas[kind],self.schemas)
        self._save(kind,record)
        self._record_machines[(kind,object_id)]=machine
        result=self._event(record,'create:'+machine,party_id,role_id,key,request,None)
        self._remember(project_id,party_id,'create:'+machine,key,request,result)
        return result

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
        require(set(transition.get('required_payload_fields',[]))<=set(payload),'COMMAND_FIELD_REQUIRED','Required command fields are missing')
        proposed=deepcopy(record)
        target=proposed.setdefault('data',{}) if kind=='WorkItem' else proposed['report'] if machine=='report' else proposed
        for field,value in payload.items():
            destination=proposed if kind=='WorkItem' and field in self.schemas[kind]['properties'] else target
            destination[field]=deepcopy(value)
        if machine=='issue':
            for field in ['inspectionIds','actionIds']:
                if field in payload:require(set(record[field])<=set(payload[field]), 'HISTORY_REMOVAL_DENIED', 'Retain all previous inspections and actions')
        proposed['evidenceIds']=list(dict.fromkeys(proposed.get('evidenceIds',[])+evidence_ids))
        validate(proposed,self.schemas[kind],self.schemas)
        role=self.authorize(proposed,transition['authority'],party_id,role_id)
        self._common(proposed,role,allow_stale_baseline=machine=='inspection' and command in ['receive','return'])
        if transition['required_evidence']:
            require(bool(proposed.get('evidenceIds')),'EVIDENCE_REQUIRED','Transition requires preserved evidence')
        for guard in transition['guards']:
            if guard not in ['assignment_authorized','expected_version_matches','requirement_versions_current','evidence_provenance_valid','drawing_revision_current','upstream_hold_points_released']:
                self._guard(guard,proposed,payload,party_id)
        if machine=='report' and command=='acknowledge':require(party_id in record['report']['recipients'], 'RECIPIENT_MISMATCH', 'Only an issued recipient may acknowledge')
        self._effects(machine,command,proposed,party_id,role_id)
        proposed.update(status=transition['to'],version=record['version']+1,updatedAt=self.at())
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
        return {**record.get('data',{}), **record}

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
        }
        if name in checks:checks[name](r)
        else:
            require(name in predicates,'GUARD_UNIMPLEMENTED',name)
            require(predicates[name](),name.upper(),name)

    def _effects(self, machine, command, record, party_id, role_id):
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
