"""Generate OpenAPI JSON (valid YAML) from command and domain contracts."""
import argparse
from copy import deepcopy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    return json.loads((ROOT/path).read_text())


def generate():
    schemas = deepcopy(load('app/schema/domain_schemas_v2.json')['components']['schemas'])
    machines = load('app/schema/state_machines_v1.json')['machines']
    bindings = load('app/reference/machine_bindings_v1.json')['machines']
    workitem_data_schemas={}
    for condition in schemas['WorkItem'].get('allOf',[]):
        subtype=condition.get('if',{}).get('properties',{}).get('subtype',{}).get('const')
        reference=condition.get('then',{}).get('properties',{}).get('data',{}).get('$ref')
        if subtype and reference:workitem_data_schemas[subtype]=reference.split('/')[-1]
    informationitem_nested_schemas={'Schedule':('schedule','ScheduleData')}
    paths = {}
    parameter = lambda name: {'name': name, 'in':'path', 'required':True, 'schema':{'type':'string', 'format':'uuid'} if name.endswith('Id') and name not in ['registerId','viewId','formId','legalFormId'] else {'type':'string'}}
    error_responses = {str(code): {'description':description,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/CommandError'}}}} for code,description in [(400,'잘못된 요청'),(401,'인증 필요'),(403,'권한·자격·배치범위 불충족'),(404,'대상 없음 또는 범위 밖'),(409,'상태·버전·중복요청·선행조건 충돌'),(422,'필수자료·법정필드 미비'),(429,'요청량 초과')]}
    errors={code:{'$ref':'#/components/responses/Error'+code} for code in error_responses}
    def endpoint(path,method,summary,body=None,response=None,command=None,code=200):
        import re
        op={'operationId':method+'_'+re.sub('[^a-zA-Z0-9]+','_',path).strip('_'),'summary':summary,
            'responses':{str(code):{'description':'성공','content':{'application/json':{'schema':response or {'type':'object'}}}},**errors}}
        if method=='post':
            op['parameters']=[{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':1}}]
            op['requestBody']={'required':True,'content':{'application/json':{'schema':body or {'$ref':'#/components/schemas/CommandRequest'}}}}
        if command:op['x-domain-command']=command
        if method=='get':op['parameters']=[{'name':'X-RoleAssignment-Id','in':'header','required':True,'schema':{'type':'string','format':'uuid'}}]
        if path not in paths:paths[path]={'parameters':[parameter(p) for p in re.findall(r'\{([^}]+)\}',path)]}
        paths[path][method]=op
    root='/projects/{projectId}'
    for name,m in machines.items():
        payload_schema=deepcopy(schemas[m['object_type']])
        managed={'id','projectId','version','createdAt','updatedAt','createdBy','status'}
        for field in managed:payload_schema['properties'].pop(field,None)
        payload_schema['required']=[f for f in payload_schema['required'] if f not in managed]
        if m['subtype']:
            payload_schema['properties']['subtype']={'const':m['subtype']}
            payload_schema['required'].remove('subtype')
        if m['object_type']=='WorkItem' and m['subtype'] in workitem_data_schemas:
            payload_schema.pop('allOf',None)
            payload_schema['properties']['data']={'$ref':'#/components/schemas/'+workitem_data_schemas[m['subtype']]}
        if m['object_type']=='InformationItem' and m['subtype'] in informationitem_nested_schemas:
            nested_field,nested_schema=informationitem_nested_schemas[m['subtype']]
            payload_schema.pop('allOf',None)
            overlay={'type':'object','properties':{}}
            if name=='schedule_baseline':overlay['properties']['scheduleKind']={'const':'baseline'}
            if name=='schedule_progress':overlay['properties']['scheduleKind']={'const':'progress_update'}
            payload_schema['properties'][nested_field]={'allOf':[{'$ref':'#/components/schemas/'+nested_schema},overlay]}
            if nested_field not in payload_schema['required']:payload_schema['required'].append(nested_field)
        if name=='report' and 'report' not in payload_schema['required']:payload_schema['required'].append('report')
        schemas['Create_'+name]={'type':'object','required':['roleAssignmentId','clientObjectId','payload'],
            'properties':{'roleAssignmentId':{'type':'string','format':'uuid'},'clientObjectId':{'type':'string','format':'uuid'},'payload':payload_schema},'additionalProperties':False}
        schemas['CommandResult_'+name]={'type':'object','required':['record','auditEvent'],
            'properties':{'record':{'$ref':'#/components/schemas/'+m['object_type']},'auditEvent':{'$ref':'#/components/schemas/AuditEvent'}},'additionalProperties':False}
        endpoint(root+'/'+bindings[name]['collection'],'post',name+' 생성',{'$ref':'#/components/schemas/Create_'+name}, {'$ref':'#/components/schemas/CommandResult_'+name},code=201)
        endpoint(root+'/'+bindings[name]['collection']+'/{objectId}','get',name+' 상세',response={'$ref':'#/components/schemas/'+m['object_type']})
        grouped={}
        for transition in m['transitions']:grouped.setdefault(transition['command'],[]).append(transition)
        for cmd,transitions in grouped.items():
            fields=set(f for t in transitions for f in t['payload_fields'])
            props=schemas[m['object_type']]['properties']
            if name=='report':props={**props,**schemas['OwnerReportData']['properties']}
            if m['object_type']=='WorkItem' and m['subtype'] in workitem_data_schemas:
                props={**props,**schemas[workitem_data_schemas[m['subtype']]]['properties']}
            if m['object_type']=='InformationItem' and m['subtype'] in informationitem_nested_schemas:
                _,nested_schema=informationitem_nested_schemas[m['subtype']]
                props={**props,**schemas[nested_schema]['properties']}
            body={'allOf':[{'$ref':'#/components/schemas/CommandRequest'},{'type':'object','properties':{'payload':{'type':'object','properties':{f:deepcopy(props[f]) for f in sorted(fields)},'additionalProperties':False}}}]}
            required=set(f for t in transitions for f in t.get('required_payload_fields',[]))
            if required:body['allOf'][1]['properties']['payload']['required']=sorted(required)
            schema_name='Command_'+name+'_'+cmd
            schemas[schema_name]=body
            endpoint(root+'/'+bindings[name]['collection']+'/{objectId}/'+cmd.replace('_','-'),'post',name+' / '+cmd,{'$ref':'#/components/schemas/'+schema_name}, {'$ref':'#/components/schemas/CommandResult_'+name},name+':'+cmd)
    endpoint(root+'/registers/{registerId}','get','읽기 전용 관리대장 Projection',response={'type':'array','items':{'type':'object'}})
    endpoint(root+'/views/{viewId}','get','통합현황 V-01~04',response={'type':'array','items':{'type':'object'}})
    endpoint(root+'/roles','get','현재 프로젝트 RoleAssignment',response={'type':'array','items':{'$ref':'#/components/schemas/RoleAssignment'}})
    endpoint(root+'/roles/{roleAssignmentId}/authorities','get','유효한 업무권한·범위',response={'type':'object'})
    schemas['EvidenceUploadRequest']={'type':'object','required':['roleAssignmentId','captureId','fileName','mimeType','byteCount','expectedHash','sourcePartyId','mediaType','discipline','packageId','locationId'], 'properties':{'roleAssignmentId':{'type':'string','format':'uuid'},'captureId':{'type':'string','format':'uuid'},'fileName':{'type':'string'},'mimeType':{'type':'string'},'byteCount':{'type':'integer','minimum':1},'expectedHash':{'type':'string','pattern':'^[a-f0-9]{64}$'},'sourcePartyId':{'type':'string','format':'uuid'},'mediaType':schemas['Evidence']['properties']['mediaType'],'discipline':{'type':'string'},'packageId':{'type':'string','format':'uuid'},'locationId':{'type':'string','format':'uuid'},'capturedAt':{'type':'string','format':'date-time'}},'additionalProperties':False}
    endpoint(root+'/uploads','post','재개 가능한 원본 업로드 세션',{'$ref':'#/components/schemas/EvidenceUploadRequest'},{'$ref':'#/components/schemas/UploadSession'},code=201)
    endpoint(root+'/uploads/{uploadId}','get','업로드 offset·검증상태',response={'$ref':'#/components/schemas/UploadSession'})
    endpoint(root+'/uploads/{uploadId}/complete','post','서버 checksum·MIME 확인 후 증빙등록',{'type':'object','required':['roleAssignmentId','expectedHash'],'properties':{'roleAssignmentId':{'type':'string','format':'uuid'},'expectedHash':{'type':'string'}}}, {'$ref':'#/components/schemas/Evidence'},code=201)
    paths[root+'/uploads/{uploadId}/chunks']={'parameters':[parameter('projectId'),parameter('uploadId')], 'put':{'operationId':'put_upload_chunk','summary':'원본 chunk 업로드; offset 불일치 409',
        'parameters':[{'name':'Upload-Offset','in':'header','required':True,'schema':{'type':'integer','minimum':0}},{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':1}}],
        'requestBody':{'required':True,'content':{'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}},'responses':{'200':{'description':'Chunk 수령 및 새 offset'},'413':{'description':'파일크기 초과'},**errors}}}
    endpoint(root+'/evidence/{evidenceId}','get','원본·파생 증빙 및 출처',response={'$ref':'#/components/schemas/Evidence'})
    schemas['RenderRequest']={'type':'object','required':['roleAssignmentId','sourceDomainRefs','data','language','output'],'properties':{'roleAssignmentId':{'type':'string','format':'uuid'},'sourceDomainRefs':{'type':'array','minItems':1,'items':{'$ref':'#/components/schemas/DomainRef'}},'data':{'type':'object'},'language':{'enum':['vi','ko','en']},'output':{'enum':['html_a4','docx','pdf']}},'additionalProperties':False}
    for action in ['preview','render']:
        endpoint(root+'/forms/{formId}/'+action,'post','동일 원본버전의 DOUL A4 '+action,{'$ref':'#/components/schemas/RenderRequest'}, {'$ref':'#/components/schemas/DocumentSnapshot'},code=201 if action=='render' else 200)
    endpoint(root+'/legal-forms/{legalFormId}/render','post','검증·설치 완료 공식서식만 생성',{'$ref':'#/components/schemas/RenderRequest'}, {'$ref':'#/components/schemas/DocumentSnapshot'},code=201)
    schemas['SignRequest']={'type':'object','required':['roleAssignmentId','documentHash','roleCode','method'],'properties':{'roleAssignmentId':{'type':'string','format':'uuid'},'documentHash':{'type':'string'},'roleCode':{'type':'string'},'method':{'enum':['wet_original_verified','approved_e_signature']},'originalFileId':{'type':'string','format':'uuid'}},'additionalProperties':False}
    endpoint(root+'/documents/{documentId}/sign','post','현재 자격·배치·정확한 문서 hash에 서명',{'$ref':'#/components/schemas/SignRequest'}, {'$ref':'#/components/schemas/Signature'},code=201)
    endpoint(root+'/documents/{documentId}','get','불변 문서와 서명 이력',response={'$ref':'#/components/schemas/DocumentSnapshot'})
    export_path=root+'/documents/{documentId}/exports/{format}'
    endpoint(export_path,'get','Stored snapshot derivative export; original signature is not transferred',response={'type':'string','format':'binary'})
    paths[export_path]['get']['responses']['200']['content']={mime:{'schema':{'type':'string','format':'binary'}} for mime in ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']}
    endpoint(root+'/notifications/{notificationId}/acknowledge','post','수신자 본인의 보고 수령 확인',{'$ref':'#/components/schemas/CommandRequest'}, {'$ref':'#/components/schemas/Notification'})
    endpoint(root+'/sync/conflicts','get','수동 해결을 기다리는 stale 업무명령',response={'type':'array','items':{'$ref':'#/components/schemas/CommandError'}})
    return {'openapi':'3.1.0','info':{'title':'DOUL Supervision Domain Command API','version':'2.2.0','description':'Project-scoped contract. Executable in-memory reference covers workflow; HTTP/DB/auth/media/DOCX/PDF adapters are implementation work.'},
        'security':[{'bearerAuth':[]}],'paths':paths,'components':{'securitySchemes':{'bearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'JWT'}},'schemas':schemas,'responses':{'Error'+k:v for k,v in error_responses.items()}},
        'x-authority-contract':'../schema/authority_matrix_v1.json','x-state-contract':'../schema/state_machines_v1.json','x-client-state-write':'forbidden',
        'x-compatibility':'v2 unscoped skeleton endpoints replaced; no deployed clients exist in this repository.'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    rendered=json.dumps(generate(),ensure_ascii=False,indent=2)+'\n';path=ROOT/'app/api/openapi.yaml'
    if args.check:
        if path.read_text()!=rendered:raise SystemExit('OpenAPI is stale: run python scripts/generate_api.py')
        print('OpenAPI generation is current')
    else:path.write_text(rendered);print('Generated OpenAPI')


if __name__=='__main__':main()
