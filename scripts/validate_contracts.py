"""Fail closed on inconsistent domain/state/authority/API/form declarations."""
import ast
import json
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.reference.engine import load
from scripts.validate_product_configuration import validate_examples as validate_product_configuration_examples


def check(condition,message):
    if not condition:raise AssertionError(message)


def validate_all():
    schemas=load('schema/domain_schemas_v2.json')['components']['schemas']
    machines=load('schema/state_machines_v1.json')['machines'];authority=load('schema/authority_matrix_v1.json');policies=authority['policies']
    mapping=load('schema/register_projection_map_v2.json');catalog=load('schema/register_catalog.json')
    forms=load('forms/form_catalog.json')['forms'];data=load('forms/form_data_schemas_v1.json')['forms'];bindings=load('forms/form_domain_bindings_v2.json')['forms'];templates=load('forms/form_templates_v1.json')['templates']
    check(authority['default']=='deny','Authority must default deny')
    check(set(schemas['RoleAssignment']['properties']['authorityCodes']['items']['enum'])==set(policies),'RoleAssignment authorityCodes enum must match authority policies')
    for name,policy in policies.items():check(not policy['official'] or not set(policy['actor_groups'])&{'AI','SYSTEM','INTEGRATION'},name+' gives nonhuman official authority')
    tree=ast.parse((ROOT/'app/reference/engine.py').read_text());guard_keys=set()
    for node in ast.walk(tree):
        if isinstance(node,ast.Assign) and isinstance(node.value,ast.Dict) and any(isinstance(t,ast.Name) and t.id in ['predicates','checks'] for t in node.targets):
            guard_keys.update(k.value for k in node.value.keys if isinstance(k,ast.Constant))
    machine_bindings=load('reference/machine_bindings_v1.json')['machines']
    check(set(machine_bindings)==set(machines),'Backend machine bindings must match Product machines exactly')
    safety_machines={
        'safety_permit':'SafetyPermit',
        'safety_stop_order':'SafetyStopOrder',
        'safety_equipment_inspection':'SafetyEquipmentInspection',
    }
    check(set(safety_machines)<=set(machines),'Safety execution state machines are required')
    for machine_name,subtype in safety_machines.items():
        check(machines[machine_name]['object_type']=='WorkItem' and machines[machine_name]['subtype']==subtype,machine_name+' binding mismatch')
    permit_activate=next((t for t in machines['safety_permit']['transitions'] if t['from']=='authorized' and t['command']=='activate'),None)
    check(bool(permit_activate) and 'safety_work_authorized' in permit_activate['guards'],'Safety Permit activation must require work authorization gate')
    stop_lift=next((t for t in machines['safety_stop_order']['transitions'] if t['from']=='verification' and t['command']=='lift_stop'),None)
    check(bool(stop_lift) and stop_lift['authority']=='safety.stop_lift' and 'safety_resume_gate_satisfied' in stop_lift['guards'],'Safety Stop lift must be explicit and resume-gated')
    check(policies['safety.stop_lift']['actor_groups']==['SUP'] and policies['safety.stop_lift']['role_codes']==['chief_supervisor'],'Safety Stop lift authority must remain human chief supervisor')
    check(policies['safety.permit.expire']['actor_groups']==['SYSTEM'] and policies['safety.permit.expire']['official'] is False,'Permit expiry may be system-derived but not official human approval')
    safety_execution=load('schema/safety_execution_contract_v1.json')
    check(safety_execution['issue_stop_package']['atomic'] is True and safety_execution['issue_stop_package']['rollback_on_failure'] is True,'Safety Stop issuance must be atomic and rollback on failure')
    check(safety_execution['resume_sequence']['issue_close_is_not_stop_lift'] is True and safety_execution['resume_sequence']['contractor_self_resume_forbidden'] is True,'Safety resume invariants changed')
    safety_data_names=['SafetyPermitData','SafetyStopOrderData','SafetyEquipmentInspectionData']
    readonly_fields={field for name in safety_data_names for field,spec in schemas[name]['properties'].items() if spec.get('readOnly') is True}
    for machine_name in safety_machines:
        for transition in machines[machine_name]['transitions']:
            check(not (set(transition['payload_fields']) & readonly_fields),machine_name+' exposes server-derived safety fields in command payload')
    check(schemas['SafetyPermitData']['properties']['workAuthorized'].get('readOnly') is True,'workAuthorized must be server-derived')
    check(schemas['SafetyEquipmentInspectionData']['properties']['equipmentAvailable'].get('readOnly') is True,'equipmentAvailable must be server-derived')
    schedule_machines={
        'schedule_baseline':('InformationItem','Schedule'),
        'schedule_progress':('InformationItem','Schedule'),
        'delay_event':('WorkItem','DelayEvent'),
        'recovery_plan':('WorkItem','RecoveryPlan'),
    }
    check(set(schedule_machines)<=set(machines),'F-04 Schedule execution state machines are required')
    for machine_name,(object_type,subtype) in schedule_machines.items():
        check(machines[machine_name]['object_type']==object_type and machines[machine_name]['subtype']==subtype,machine_name+' binding mismatch')
    check(machines['schedule_baseline']['initial']=='draft' and machines['schedule_progress']['initial']=='submitted','Baseline and Progress lifecycle initials changed')
    check(machines['delay_event']['initial']=='observed' and machines['recovery_plan']['initial']=='requested','Delay/Recovery lifecycle initials changed')
    baseline_activate=next((t for t in machines['schedule_baseline']['transitions'] if t['from']=='approved' and t['command']=='activate_baseline'),None)
    progress_freeze=next((t for t in machines['schedule_progress']['transitions'] if t['from']=='accepted_for_reporting' and t['command']=='freeze_progress'),None)
    check(bool(baseline_activate) and baseline_activate['authority']=='schedule.baseline.activate' and 'schedule_baseline_activation_ready' in baseline_activate['guards'],'Baseline activation contract changed')
    check(bool(progress_freeze) and progress_freeze['authority']=='schedule.progress.freeze' and 'schedule_progress_freeze_ready' in progress_freeze['guards'],'Progress freeze contract changed')
    schedule_execution=load('schema/schedule_execution_contract_v1.json')
    check(schedule_execution['baseline_activation']['atomic'] is True and schedule_execution['baseline_activation']['single_effective_per_scope'] is True,'Baseline activation must remain atomic with one effective baseline per scope')
    check(schedule_execution['progress_freeze']['content_immutable_after_frozen'] is True and schedule_execution['progress_freeze']['correction_requires_new_schedule_record'] is True,'Frozen Progress must remain immutable with correction by new record')
    check(schedule_execution['progress_freeze']['data_date_must_not_move_backward'] is True and schedule_execution['progress_freeze']['forecast_never_rewrites_baseline'] is True,'Data Date/Baseline invariants changed')
    check(schedule_execution['delay_boundary']['delay_event_is_fact_not_entitlement'] is True and schedule_execution['delay_boundary']['delay_close_does_not_close_claim_or_eot'] is True,'Delay entitlement boundary changed')
    check(schedule_execution['recovery_boundary']['accepted_recovery_does_not_revise_baseline'] is True and schedule_execution['recovery_boundary']['accepted_recovery_does_not_approve_eot_or_cost'] is True,'Recovery/Baseline/EOT boundary changed')
    check(schedule_execution['activity_boundary']['percent_complete_100_does_not_change_inspection_or_handover'] is True,'Schedule Activity completion must not alter quality/handover state')
    schedule_readonly={field for name in ['ScheduleData','RecoveryPlanData'] for field,spec in schemas[name]['properties'].items() if spec.get('readOnly') is True}
    for machine_name in ['schedule_baseline','schedule_progress','recovery_plan']:
        for transition in machines[machine_name]['transitions']:
            check(not (set(transition['payload_fields']) & schedule_readonly),machine_name+' exposes server-managed schedule fields in command payload')
    check(schemas['RecoveryPlanData']['properties']['effectivenessResult'].get('readOnly') is True,'Recovery effectiveness must be command-derived')
    check(schemas['ScheduleData']['properties']['variance']['$ref']=='#/components/schemas/ScheduleVarianceData','Schedule variance schema binding changed')
    collections=set()
    for name,machine in machines.items():
        check(machine['object_type'] in schemas,name+' has unknown object type')
        binding=machine_bindings[name]
        check(set(binding)=={'collection','create_authority'},name+' has invalid backend machine binding fields')
        collection=binding['collection']
        check(isinstance(collection,str) and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',collection),name+' has invalid API collection')
        check(collection not in collections,name+' has duplicate API collection')
        collections.add(collection)
        check(binding['create_authority'] in policies,name+' has unknown create authority')
        seen=set()
        for t in machine['transitions']:
            signature=t['from'],t['command'];check(signature not in seen,name+' has ambiguous command');seen.add(signature)
            check(t['from'] in machine['states'] and t['to'] in machine['states'],name+' has unknown state')
            check(t['authority'] in policies,name+' has unknown authority')
            check(t['audit_event'] and t['failure_reasons'],name+' lacks failure/audit contract')
            check(set(t.get('required_payload_fields',[]))<=set(t['payload_fields']),name+' requires fields outside writable payload')
            check(set(t['guards'])<=guard_keys|set(load('schema/state_machines_v1.json')['common_guards']),name+' has unimplemented guard')
    check([p['register_id'] for p in mapping['registers']]==[f'{i:02}' for i in range(1,30)],'29 projection mappings required')
    product_map=(ROOT/'26_Product_Functional_Map_v1.md').read_text(encoding='utf-8')
    maturity={}
    for line in product_map.splitlines():
        match=re.match(r'^\| (\d{2}) \|.*\| (M3|M2|M1|R) \|',line)
        if match:maturity[match.group(1)]=match.group(2)
    check(list(maturity)==[f'{i:02}' for i in range(1,30)],'Product map must declare maturity for registers 01-29 in order')
    check(maturity.get('02')=='R' and all(maturity.get(f'{i:02}')=='M3' for i in range(1,30) if i!=2),'Product baseline requires 28 M3 registers plus register 02 Reference')
    detailed_contracts=[ROOT/f'{n:02}_{name}' for n,name in [
        (33,'Fire_Environment_Compliance_Functional_Contract.md'),
        (34,'Commissioning_Handover_Warranty_Functional_Contract.md'),
        (35,'Contract_Notice_Claim_EOT_Functional_Contract.md'),
        (36,'Regulatory_Permit_Lifecycle_Functional_Contract.md'),
        (37,'Site_Instruction_Functional_Contract.md'),
        (38,'Risk_Assurance_Audit_Functional_Contract.md'),
        (39,'Insurance_Guarantee_Functional_Contract.md'),
        (40,'Lesson_Learned_Functional_Contract.md'),
        (41,'Document_Transmittal_Functional_Contract.md'),
        (42,'Personnel_Qualification_Deployment_Functional_Contract.md'),
        (43,'Drawing_Revision_Field_Distribution_Functional_Contract.md'),
        (44,'Daily_Record_Evidence_Functional_Contract.md'),
    ]]
    for contract in detailed_contracts:
        check(contract.exists(),contract.name+' missing from Product baseline')
        text=contract.read_text(encoding='utf-8')
        check('Command Contract' in text,contract.name+' lacks explicit command contract')
        check(('Actor / Decision Right' in text or 'Decision Right' in text),contract.name+' lacks actor/decision-right contract')
        check('Completion' in text,contract.name+' lacks completion criteria')
        check('Backend' in text,contract.name+' lacks backend handoff boundary')
    check((ROOT/'45_Role_End_to_End_Journeys_v1.md').exists(),'Role E2E journey contract missing')
    check((ROOT/'46_Product_Functional_Baseline_v1_Validation.md').exists(),'Product baseline validation document missing')
    product_ops_docs=[
        '48_Product_Baseline_Change_Control_v1.md',
        '49_Implementation_Acceptance_Scenarios_v1.md',
        '50_Project_Configuration_Pack_v1.md',
        '51_Owner_Reporting_Trigger_Matrix_v1.md',
        '52_Media_Analysis_Operations_Policy_v1.md',
        '53_Field_Pilot_Acceptance_Plan_v1.md',
        '54_Implementation_Progress_Stage_Ledger_v1.md',
    ]
    for name in product_ops_docs:check((ROOT/name).exists(),name+' missing from Product implementation handoff')
    change_contract=load('schema/product_change_record_contract_v1.json')
    project_config=load('schema/project_configuration_contract_v1.json')
    acceptance=load('schema/implementation_acceptance_catalog_v1.json')
    check(change_contract.get('$schema')=='https://json-schema.org/draft/2020-12/schema','Product change contract must use JSON Schema 2020-12')
    check(project_config.get('$schema')=='https://json-schema.org/draft/2020-12/schema','Project configuration contract must use JSON Schema 2020-12')
    check(project_config.get('additionalProperties') is False,'Project configuration must fail closed on unknown root keys')
    required_config={'schemaVersion','configVersion','baselineVersion','projectId','timezone','effectiveFrom','organizations','roleAssignments','qualificationRules','scopes','authorityBindings','deadlineRules','ownerReporting','forms','thresholds','mediaPolicy','acceptanceScenarioIds'}
    check(required_config<=set(project_config.get('required',[])),'Project configuration required fields incomplete')
    scenario_ids=[x['id'] for x in acceptance.get('scenarios',[])]
    check(len(scenario_ids)==len(set(scenario_ids)) and len(scenario_ids)>=15,'Acceptance scenario IDs must be unique and complete')
    check({'AC-Q-01','AC-S-01','AC-SCH-01','AC-PAY-01','AC-HO-01','AC-MEDIA-01','AC-AUTH-01','AC-WORKER-01','AC-REPORT-01'}<=set(scenario_ids),'Required E2E/failure acceptance scenarios missing')
    validate_product_configuration_examples()
    progress=load('reference/implementation_progress_ledger_v1.json')
    expected_stages=['contract_confirmed','backend_api_implemented','ui_connected','integration_passed','pilot_verified']
    check(progress.get('stageOrder')==expected_stages,'Implementation progress stage order changed')
    progress_ids=[x['functionId'] for x in progress.get('functions',[])]
    check(progress_ids==[f'F-{i:02}' for i in range(1,18)],'Implementation progress ledger must cover F-01 through F-17')
    check(all(x['currentStage'] in expected_stages and x.get('evidenceRefs') for x in progress['functions']),'Implementation stage requires valid stage and evidence')
    check(all(x.get('countsAsFunctionStage') is False for x in progress.get('foundationTracks',[])),'Foundation tracks must not imply business function completion')
    owner_trigger_catalog=load('schema/owner_reporting_trigger_catalog_v1.json')
    owner_contract=load('schema/owner_reporting_contract_v1.json')
    trigger_ids=[x['functionId'] for x in owner_trigger_catalog.get('functions',[])]
    check(trigger_ids==[f'F-{i:02}' for i in range(1,18)],'Owner reporting trigger catalog must cover F-01 through F-17 in order')
    check(all(x.get('closureSeparationRequired') is True for x in owner_trigger_catalog['functions']),'Every functional owner-report trigger must preserve Domain/Report closure separation')
    check(owner_trigger_catalog['semantics']['receipt_is_not_approval'] is True,'Owner receipt must remain distinct from approval')
    check(owner_contract.get('version')=='1.1','Owner reporting contract v1.1 required')
    check(owner_contract.get('trigger_catalog_ref')=='app/schema/owner_reporting_trigger_catalog_v1.json','Owner reporting trigger catalog ref missing')
    check(owner_contract.get('project_configuration_ref')=='app/schema/project_configuration_contract_v1.json','Owner reporting project config ref missing')
    media_contract=load('schema/media_analysis_contract_v1.json')
    check(media_contract.get('version')=='1.3' and 'operations_policy' in media_contract,'Media operations policy contract v1.3 required')
    check(media_contract['operations_policy']['user_reanalysis']['new_analysis_run_required'] is True,'Reanalysis must create a new AnalysisRun')
    check(media_contract['operations_policy']['cost_control']['silent_mode_downgrade_forbidden'] is True,'Media cost policy must forbid silent mode downgrade')
    subtypes=load('schema/domain_model_v2.json')['subtypes']
    all_commands={name+':'+t['command'] for name,m in machines.items() for t in m['transitions']}
    for projection in mapping['registers']:
        check(projection['raw_status_patch'] is False,'Projection status writes forbidden')
        check(set(projection['allowed_commands'])<=all_commands,'Unknown projection command')
        check(projection['mode'] in ['read_only','actionable'],'Unknown projection mode')
        check(projection['join_relations'] and projection['calculated_fields'],'Join/calculation contract absent')
        for source in projection['sources']:
            kind=source['object_type'];check(kind in schemas,'Unknown projection source')
            if source['subtype']:check(source['subtype'] in (subtypes.get(kind,[]) or schemas[kind]['properties'].get('kind',{}).get('enum',[])),'Unknown subtype '+str(source))
    identifiers={p['register_id'] for p in mapping['registers']}|{v['id'] for v in catalog['views']}
    form_ids={f['id'] for f in forms};template_ids={t['id'] for t in templates}
    check(len(forms)==36 and len(templates)==36 and set(data)==set(bindings)==form_ids==template_ids,'36 form catalog/data/binding/template contracts required')
    for form in forms:
        check(set(form['registers'])<=identifiers,form['id']+' refers to unknown view')
        primary=bindings[form['id']].get('primary_source')
        if primary:check(primary['object_type'] in schemas and primary['cardinality']==1 and primary['binding']=='primarySourceRef','Invalid form primary subject contract')
        for conditional in data[form['id']]['conditional_signatures']:
            check(isinstance(conditional['when'],dict) and conditional['when']['operator']=='non_null','Unsafe conditional predicate')
        spec=data[form['id']];binding=bindings[form['id']]
        for field,rule in spec['scalar_fields'].items():
            check(binding['field_bindings'][field]['required']==rule['required'],form['id']+' has inconsistent required field '+field)
        conditions=spec.get('conditional_requirements',[])
        check(conditions==binding.get('conditional_requirements',[]),form['id']+' has inconsistent conditional requirements')
        for condition in conditions:
            check(condition['when']=={'operator':'failed_inspection_has_issued_issue'},'Unsafe form requirement predicate')
            check(condition['any_of']==[{'field':'review.ncr_no'},{'source_object_type':'Issue'}],'Invalid NCR link alternatives')
    known={'$ref','$schema','type','enum','const','format','pattern','minLength','minimum','maximum','properties','required','additionalProperties','items','minItems','uniqueItems','allOf','oneOf','anyOf','if','then','else','description','title','default','readOnly'}
    def walk(schema):
        check(set(schema)<=known,'Unsupported validation keywords '+str(set(schema)-known))
        if '$ref' in schema:check(schema['$ref'].split('/')[-1] in schemas,'Unresolved schema reference')
        for value in schema.get('properties',{}).values():walk(value)
        if 'items' in schema:walk(schema['items'])
        for key in ['allOf','oneOf','anyOf']:
            for value in schema.get(key,[]):walk(value)
        for key in ['if','then','else']:
            if key in schema:walk(schema[key])
    for schema in schemas.values():walk(schema)
    api=json.loads((ROOT/'app/api/openapi.yaml').read_text());ops=0
    from app.reference.documents import PRIMARY_SOURCES
    check(PRIMARY_SOURCES=={f:(b['primary_source']['object_type'],b['primary_source']['subtype']) for f,b in bindings.items() if 'primary_source' in b},'Renderer primary subjects differ from the form contract')
    operation_ids=set()
    for path,item in api['paths'].items():
        check(path.startswith('/projects/{projectId}'),'Unscoped API route')
        for method,op in item.items():
            if method not in ['get','post','put','patch','delete']:continue
            ops+=1;check(method not in ['patch','delete'],'Raw status/deletion endpoint forbidden')
            params=item.get('parameters',[])+op.get('parameters',[])
            for token in re.findall(r'\{([^}]+)\}',path):check(any(p['name']==token and p['in']=='path' and p['required'] for p in params),'Undeclared path parameter '+path)
            check(op['operationId'] not in operation_ids,'Duplicate operationId');operation_ids.add(op['operationId'])
            if method in ['post','put']:
                check(op.get('requestBody',{}).get('required'),'Write body absent')
                check(any(p['name']=='Idempotency-Key' and p['required'] for p in params),'Write lacks idempotency')
            check(any(k.startswith('2') for k in op['responses']),'Success response absent')
            if 'x-domain-command' in op:check(op['x-domain-command'] in all_commands,'Unknown API command')
    def refs(value):
        if isinstance(value,dict):
            if '$ref' in value:
                cursor=api
                for p in value['$ref'].removeprefix('#/').split('/'):cursor=cursor[p]
            for v in value.values():refs(v)
        elif isinstance(value,list):
            for v in value:refs(v)
    refs(api)
    legal=load('forms/legal_form_registry.json')['official_fixed'];check(len({x['id'] for x in legal})==len(legal),'Duplicate legal template')
    for entry in legal:
        if entry['render_enabled']:check(all(entry.get(k) for k in ['template_file','template_sha256','effective_from','verified_source_url']),'Unverified legal template enabled')
    return dict(machines=len(machines),transitions=sum(len(m['transitions']) for m in machines.values()),policies=len(policies),registers=29,forms=36,api_paths=len(api['paths']),api_operations=ops)

if __name__=='__main__':print(json.dumps(validate_all(),ensure_ascii=False))
