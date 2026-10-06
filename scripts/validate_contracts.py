"""Fail closed on inconsistent domain/state/authority/API/form declarations."""
import ast
import json
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.reference.engine import load


def check(condition,message):
    if not condition:raise AssertionError(message)


def validate_all():
    schemas=load('schema/domain_schemas_v2.json')['components']['schemas']
    machines=load('schema/state_machines_v1.json')['machines'];authority=load('schema/authority_matrix_v1.json');policies=authority['policies']
    mapping=load('schema/register_projection_map_v2.json');catalog=load('schema/register_catalog.json')
    forms=load('forms/form_catalog.json')['forms'];data=load('forms/form_data_schemas_v1.json')['forms'];bindings=load('forms/form_domain_bindings_v2.json')['forms'];templates=load('forms/form_templates_v1.json')['templates']
    check(authority['default']=='deny','Authority must default deny')
    for name,policy in policies.items():check(not policy['official'] or not set(policy['actor_groups'])&{'AI','SYSTEM','INTEGRATION'},name+' gives nonhuman official authority')
    tree=ast.parse((ROOT/'app/reference/engine.py').read_text());guard_keys=set()
    for node in ast.walk(tree):
        if isinstance(node,ast.Assign) and isinstance(node.value,ast.Dict) and any(isinstance(t,ast.Name) and t.id in ['predicates','checks'] for t in node.targets):
            guard_keys.update(k.value for k in node.value.keys if isinstance(k,ast.Constant))
    machine_bindings=load('reference/machine_bindings_v1.json')['machines']
    check(set(machine_bindings)==set(machines),'Backend machine bindings must match Product machines exactly')
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
    known={'$ref','$schema','type','enum','const','format','pattern','minLength','minimum','maximum','properties','required','additionalProperties','items','minItems','uniqueItems','allOf','oneOf','anyOf','if','then','else','description','title','default'}
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
