"""Local-development HTTP adapter. Not production authentication or e-signature.

Uses the PR #2 contracts directly. No client-supplied authority objects and no
status PATCH endpoint. Run only on loopback using python -m services.api --demo.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import secrets
from threading import RLock
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware
from app.reference.engine import canonical, uid
from app.reference.validation import ContractError, require, instant, validate
from .store import Store

ROOT=Path(__file__).resolve().parents[2]
SPEC=json.loads((ROOT/'app/api/openapi.yaml').read_text())
SCHEMAS=SPEC['components']['schemas']
COLLECTIONS={'observations':'observation','inspections':'inspection','issues':'issue','rfis':'rfi','changes':'change','approvals':'approval','actions':'action','owner-decisions':'decision','owner-reports':'report','analysis-runs':'analysis_run'}
ORIGINS=['http://127.0.0.1:5181','http://localhost:5181','http://127.0.0.1:8791','http://localhost:8791']
MAX_FILE=64*1024*1024
MAX_CHUNK=4*1024*1024


def status_for(code):
    if code=='UNAUTHENTICATED':return 401
    if code in ['OBJECT_NOT_FOUND','DOCUMENT_NOT_FOUND','PROJECT_MISMATCH','NOT_FOUND']:return 404
    if code in ['NOT_AUTHORIZED','ASSIGNMENT_EXPIRED','SCOPE_MISMATCH','ORGANIZATION_MISMATCH','QUALIFICATION_INVALID','NONHUMAN_OFFICIAL_DENIED','RECIPIENT_MISMATCH','ORIGIN_DENIED']:return 403
    if code in ['ADAPTER_NOT_CONFIGURED']:return 501
    if code=='PAYLOAD_TOO_LARGE':return 413
    if code in ['MIME_INVALID']:return 415
    if code.startswith(('SCHEMA','FORM_')) or code in ['INVALID_REQUEST','INVALID_DATETIME','COMMAND_FIELD_INVALID']:return 422
    return 409


def error_body(exc):
    d=dict(code=exc.code,message=str(exc),failedGuards=[exc.code])
    if exc.current_version is not None:d['currentVersion']=exc.current_version
    return d


async def limited_body(request, maximum=MAX_CHUNK):
    data=bytearray()
    async for chunk in request.stream():
        require(len(data)+len(chunk)<=maximum,'PAYLOAD_TOO_LARGE','Request exceeds the development upload limit')
        data.extend(chunk)
    return bytes(data)


async def body_json(request):
    try:
        value=json.loads((await limited_body(request)).decode())
    except (ValueError,UnicodeDecodeError):raise ContractError('INVALID_REQUEST','Expected valid JSON')
    require(isinstance(value,dict),'INVALID_REQUEST','Expected a JSON object')
    return value


def valid_id(value):
    try:UUID(value)
    except (ValueError,TypeError,AttributeError):raise ContractError('INVALID_REQUEST','Expected UUID')


def sniff(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):return 'image/jpeg'
    if data[:6] in [b'GIF87a',b'GIF89a']:return 'image/gif'
    if data.startswith(b'RIFF') and data[8:12]==b'WEBP':return 'image/webp'
    if data.startswith(b'RIFF') and data[8:12]==b'WAVE':return 'audio/wav'
    if data.startswith(b'%PDF-'):return 'application/pdf'
    if data[4:8]==b'ftyp':return 'video/mp4'
    if data.startswith(b'\x1a\x45\xdf\xa3'):return 'video/webm'
    if data.startswith(b'ID3') or data[:2] in [b'\xff\xfb',b'\xff\xf3',b'\xff\xf2']:return 'audio/mpeg'
    raise ContractError('MIME_INVALID','Supported development formats: PNG/JPEG/GIF/WebP/MP4/WebM/WAV/MP3/PDF')


def create_app(db_path=':memory:', demo=False):
    if not demo:raise RuntimeError('Production auth is not configured. Explicit --demo is required; bind to loopback only.')
    store=Store(db_path,demo=True)
    app=FastAPI(title='DOUL MVP local development adapter',version='0.1.0',docs_url='/api-docs')
    app.state.store=store
    sessions={};session_lock=RLock()
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','testserver'])
    app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_methods=['GET','POST','PUT'],allow_headers=['Authorization','Content-Type','X-RoleAssignment-Id','Idempotency-Key','Upload-Offset'])

    @app.exception_handler(ContractError)
    async def contract_error(request,exc):return JSONResponse(error_body(exc),status_code=status_for(exc.code))

    def identity(request):
        auth=request.headers.get('authorization','')
        token=auth[7:] if auth.startswith('Bearer ') else ''
        with session_lock:session=sessions.get(token)
        require(session is not None and session['expires']>datetime.now(timezone.utc),'UNAUTHENTICATED','Development session missing or expired')
        return session

    def role_for(session,project,role_id=None):
        valid_id(project)
        rid=role_id or session['roleAssignmentId']
        role=store.engine.get('RoleAssignment',rid)
        require(role['partyId']==session['partyId'],'NOT_AUTHORIZED','Role does not belong to this session')
        require(role['projectId']==project,'PROJECT_MISMATCH','Project unavailable')
        require(role['active'] and instant(role['validFrom'])<=instant(store.engine.at())<instant(role['validTo']),'ASSIGNMENT_EXPIRED','Project assignment is inactive or expired')
        return role

    def readable(record,session,role):
        require(record['projectId']==role['projectId'],'PROJECT_MISMATCH','Project unavailable')
        group=role['actorGroup']
        if record.get('subtype')=='Report':
            require(group in ['SUP','ADM'] or record.get('status') not in ['draft','review'],'NOT_FOUND','Report unavailable')
            if group=='OWN':require(session['partyId'] in record['report']['recipients'],'NOT_FOUND','Report unavailable')
        if record.get('source') in ['ai','supervisor'] and record.get('status') in ['candidate','under_review']:
            require(group in ['SUP','ADM'],'NOT_FOUND','Internal observation unavailable')
        if record.get('formId'):
            for source in record['sourcePayload']['sources']:readable(source['record'],session,role)
        else:store.engine.authorize(record,'render_document',session['partyId'],role['id'])

    def machine_record(collection,oid,project,session,role):
        require(collection in COLLECTIONS,'NOT_FOUND','Unknown collection');valid_id(oid)
        machine=COLLECTIONS[collection];kind=store.engine.machines[machine]['object_type']
        record=store.engine.get(kind,oid)
        require(store.engine._record_machines.get((kind,oid))==machine,'NOT_FOUND','Resource unavailable')
        require(record['projectId']==project,'PROJECT_MISMATCH','Project unavailable')
        readable(record,session,role)
        return machine,record

    def key_for(request):
        key=request.headers.get('idempotency-key','')
        require(bool(key.strip()) and len(key)<=160,'IDEMPOTENCY_REQUIRED','Provide Idempotency-Key, at most 160 characters')
        return key

    def preflight(machine,record,session,role,payload=None):
        results=[]
        for transition in store.engine.machines[machine]['transitions']:
            if transition['from']!=record['status']:continue
            try:store.engine.authorize(record,transition['authority'],session['partyId'],role['id'])
            except ContractError:continue
            preview=deepcopy(store.engine)
            failure=None
            try:preview.execute(machine,record['id'],transition['command'],record['version'],payload or {},[],session['partyId'],role['id'],uid())
            except ContractError as exc:failure=error_body(exc)
            fields=transition['payload_fields']
            results.append(dict(command=transition['command'],to=transition['to'],authority=transition['authority'],fields=fields,requiresEvidence=transition['required_evidence'],ready=failure is None,requiresInput=bool(fields),blockedReason=failure,expectedVersion=record['version']))
        return results

    @app.get('/health')
    def health():return dict(status='ok',mode='local-demo',baseCommit='d13e744',adapters={'database':'sqlite-development','workflow':'merged-reference-engine','authentication':'explicit-local-demo','ai':'not-configured','legalSignature':'not-configured','pdfDocx':'not-configured'})

    @app.get('/dev/actors')
    def actors():
        with store.transaction():return [dict(actorGroup=g,name=a['name']) for g,a in store.meta['actors'].items()]

    @app.post('/dev/sessions')
    async def login(request:Request):
        origin=request.headers.get('origin')
        require(origin is None or origin in ORIGINS,'ORIGIN_DENIED','Development origin not allowed')
        body=await body_json(request)
        require(set(body)=={'actorGroup'} and body['actorGroup'] in ['SUP','CON','OWN','DES','ADM'],'INVALID_REQUEST','Choose one demo human role; service/source parties cannot log in')
        with store.transaction():a=deepcopy(store.meta['actors'][body['actorGroup']]);project=store.meta['projectId']
        token=secrets.token_urlsafe(32)
        with session_lock:sessions[token]=dict(a,expires=datetime.now(timezone.utc)+timedelta(hours=8))
        return dict(accessToken=token,projectId=project,actor=a,mode='LOCAL_DEMO_NOT_PRODUCTION')

    @app.get('/projects/{project_id}/workspace')
    def workspace(project_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            items=[]
            for (kind,oid),r in store.engine._records.items():
                machine=store.engine._record_machines.get((kind,oid))
                if machine is None and kind not in ['Evidence','DocumentSnapshot']:continue
                try:readable(r,session,role)
                except ContractError:continue
                items.append(dict(machine=machine or ('evidence' if kind=='Evidence' else 'document'),record=deepcopy(r),actions=preflight(machine,r,session,role) if machine else []))
            visible_ids={x['record']['id'] for x in items}
            audits=[x for x in store.engine.audit_events if x['projectId']==project_id and x['objectRef']['objectId'] in visible_ids][-50:]
            return dict(project=store.engine.get('Project',project_id),role=role,items=items,audit=audits,context={k:v for k,v in store.meta.items() if k not in ['actors']},participants=[{k:a[k] for k in ['partyId','name','actorGroup']} for a in store.meta['actors'].values()],formSchemas=store.documents.schemas,demo=True)

    @app.get('/projects/{project_id}/roles')
    def roles(project_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            return [deepcopy(r) for (k,i),r in store.engine._records.items() if k=='RoleAssignment' and r['projectId']==project_id and (role['actorGroup']=='ADM' or r['partyId']==session['partyId'])]

    @app.get('/projects/{project_id}/registers/{register_id}')
    def projection(project_id:str,register_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            rows=store.engine.projections(register_id,session['partyId'],role['id'])
            output=[]
            for row in rows:
                try:readable(row['data'],session,role);output.append(row)
                except ContractError:pass
            return output

    @app.post('/projects/{project_id}/uploads')
    async def start_upload(project_id:str,request:Request):
        session=identity(request);body=await body_json(request);key=key_for(request)
        validate(body,SCHEMAS['EvidenceUploadRequest'],SCHEMAS)
        require(body['byteCount']<=MAX_FILE,'PAYLOAD_TOO_LARGE','Maximum development file size is 64 MiB')
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            scope=dict(discipline=body['discipline'],packageId=body['packageId'],locationId=body['locationId'],responsibleOrganizationId=role['organizationId'] if role['actorGroup']=='CON' else store.meta['scope']['responsibleOrganizationId'])
            store.engine.authorize(dict(projectId=project_id,**scope),'create_evidence',session['partyId'],role['id'])
            source=store.engine.get('Party',body['sourcePartyId']);require(source['projectId']==project_id,'PROJECT_MISMATCH','Source party unavailable')
            request_key='upload:'+project_id+':'+session['partyId']+':'+key
            fingerprint=sha256(canonical(body)).hexdigest()
            if request_key in store.requests:
                old=store.requests[request_key];require(old['hash']==fingerprint,'IDEMPOTENCY_CONFLICT','Upload request changed');return store.uploads[old['id']]['public']
            upload_id=uid()
            public=dict(id=upload_id,projectId=project_id,captureId=body['captureId'],fileName=Path(body['fileName']).name,mimeType=body['mimeType'],byteCount=body['byteCount'],expectedHash=body['expectedHash'],offset=0,status='created',expiresAt=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat())
            store.uploads[upload_id]=dict(public=public,partyId=session['partyId'],roleId=role['id'],sourcePartyId=body['sourcePartyId'],mediaType=body['mediaType'],scope=scope,capturedAt=body.get('capturedAt'),chunks={})
            store.requests[request_key]=dict(hash=fingerprint,id=upload_id);store.put_blob(upload_id,b'')
            return JSONResponse(public,status_code=201)

    def upload_for(upload_id,project_id,session,role):
        require(upload_id in store.uploads,'NOT_FOUND','Upload unavailable');u=store.uploads[upload_id]
        require(u['public']['projectId']==project_id,'PROJECT_MISMATCH','Upload unavailable')
        require(u['partyId']==session['partyId'] and u['roleId']==role['id'],'NOT_AUTHORIZED','Upload belongs to a different session role')
        store.engine.authorize(dict(projectId=project_id,**u['scope']),'create_evidence',session['partyId'],role['id'])
        require(instant(u['public']['expiresAt'])>instant(store.engine.at()),'UPLOAD_EXPIRED','Start a new upload session')
        return u

    @app.get('/projects/{project_id}/uploads/{upload_id}')
    def upload_status(project_id:str,upload_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'));return upload_for(upload_id,project_id,session,role)['public']

    @app.put('/projects/{project_id}/uploads/{upload_id}/chunks')
    async def upload_chunk(project_id:str,upload_id:str,request:Request):
        session=identity(request);key=key_for(request);content=await limited_body(request)
        try:offset=int(request.headers.get('upload-offset',''))
        except ValueError:raise ContractError('INVALID_REQUEST','Upload-Offset is required')
        require(content and offset>=0,'INVALID_REQUEST','Empty chunk or negative offset')
        with store.transaction(True):
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'));u=upload_for(upload_id,project_id,session,role);p=u['public']
            fingerprint=sha256(content).hexdigest()
            if key in u['chunks']:
                old=u['chunks'][key];require(old==[offset,len(content),fingerprint],'IDEMPOTENCY_CONFLICT','Chunk key reused');return dict(offset=p['offset'])
            require(p['status'] in ['created','uploading'],'UPLOAD_CLOSED','Upload is already finalized')
            require(offset==p['offset'],'OFFSET_CONFLICT','Resume from the server offset')
            require(offset+len(content)<=p['byteCount'],'PAYLOAD_TOO_LARGE','Chunk exceeds declared file size')
            store.put_blob(upload_id,store.blob(upload_id)+content);p.update(offset=offset+len(content),status='uploading');u['chunks'][key]=[offset,len(content),fingerprint]
            return dict(offset=p['offset'])

    @app.post('/projects/{project_id}/uploads/{upload_id}/complete')
    async def complete_upload(project_id:str,upload_id:str,request:Request):
        session=identity(request);body=await body_json(request);key=key_for(request)
        require(set(body)=={'roleAssignmentId','expectedHash'},'INVALID_REQUEST','Expected roleAssignmentId and expectedHash')
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId']);u=upload_for(upload_id,project_id,session,role);p=u['public']
            require(body['expectedHash']==p['expectedHash'],'CHECKSUM_MISMATCH','Expected hash changed')
            if p['status']=='completed':return store.engine.get('Evidence',p['captureId'])
            content=store.blob(upload_id)
            require(len(content)==p['byteCount'],'UPLOAD_INCOMPLETE','Some bytes have not arrived')
            require(sha256(content).hexdigest()==p['expectedHash'],'CHECKSUM_MISMATCH','Server checksum mismatch')
            actual_mime=sniff(content)
            require(actual_mime==p['mimeType'],'MIME_INVALID','Declared MIME does not match bytes')
            expected_media='photo' if actual_mime.startswith('image/') else 'video' if actual_mime.startswith('video/') else 'audio' if actual_mime.startswith('audio/') else 'document'
            require(u['mediaType']==expected_media,'MIME_INVALID','Media category does not match bytes')
            payload=dict(sourceType='original',mediaType=u['mediaType'],fileId=upload_id,fileHash=p['expectedHash'],sourcePartyId=u['sourcePartyId'],metadata={'name':p['fileName'],'mimeType':actual_mime,'byteCount':len(content)},**u['scope'])
            if u['capturedAt']:payload['capturedAt']=u['capturedAt']
            result=store.engine.add_evidence(p['captureId'],project_id,payload,content,session['partyId'],role['id'],key)
            p['status']='completed';return JSONResponse(result['record'],status_code=201)

    @app.get('/projects/{project_id}/evidence/{evidence_id}/content')
    def evidence_content(project_id:str,evidence_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'));r=store.engine.get('Evidence',evidence_id);readable(r,session,role)
            return Response(store.blob(r['fileId']),media_type=r.get('metadata',{}).get('mimeType','application/octet-stream'),headers={'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'})

    @app.get('/projects/{project_id}/documents/{document_id}')
    def document(project_id:str,document_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'));d=store.documents.get(document_id);readable(d,session,role);return d

    @app.get('/projects/{project_id}/documents/{document_id}/content')
    def document_content(project_id:str,document_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'));d=store.documents.get(document_id);readable(d,session,role)
            return Response(store.documents.rerender(document_id),media_type='text/html',headers={'Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'",'Cache-Control':'no-store'})

    @app.post('/projects/{project_id}/forms/{form_id}/{operation}')
    async def render(project_id:str,form_id:str,operation:str,request:Request):
        session=identity(request);body=await body_json(request);key=key_for(request);validate(body,SCHEMAS['RenderRequest'],SCHEMAS)
        require(operation in ['preview','render'],'NOT_FOUND','Unknown operation')
        require(body['output']=='html_a4','ADAPTER_NOT_CONFIGURED','DOCX/PDF renderer is not connected; choose html_a4')
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            for ref in body['sourceDomainRefs']:readable(store.engine.resolve(ref,project_id),session,role)
            return store.documents.render(form_id,body['sourceDomainRefs'],body['data'],session['partyId'],role['id'],key,body['language'],operation=='render')

    @app.post('/projects/{project_id}/documents/{document_id}/sign')
    async def sign(project_id:str,document_id:str,request:Request):
        session=identity(request);body=await body_json(request);key_for(request);validate(body,SCHEMAS['SignRequest'],SCHEMAS)
        with store.transaction():
            role=role_for(session,project_id,body['roleAssignmentId']);d=store.documents.get(document_id);readable(d,session,role)
            raise ContractError('ADAPTER_NOT_CONFIGURED','A trusted legal-signature verifier is required. Client assertions are never accepted as verified signatures.')

    @app.get('/projects/{project_id}/{collection}/{object_id}/available-actions')
    def available(project_id:str,collection:str,object_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'));machine,r=machine_record(collection,object_id,project_id,session,role)
            return preflight(machine,r,session,role)

    @app.get('/projects/{project_id}/{collection}/{object_id}')
    def detail(project_id:str,collection:str,object_id:str,request:Request):
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            if collection=='evidence':
                r=store.engine.get('Evidence',object_id);readable(r,session,role);return r
            return machine_record(collection,object_id,project_id,session,role)[1]

    @app.post('/projects/{project_id}/{collection}')
    async def create(project_id:str,collection:str,request:Request):
        session=identity(request);body=await body_json(request);key=key_for(request)
        require(collection in COLLECTIONS,'NOT_FOUND','Unknown collection');machine=COLLECTIONS[collection]
        require(machine!='analysis_run','ADAPTER_NOT_CONFIGURED','No media/AI worker is connected')
        validate(body,SCHEMAS['Create_'+machine],SCHEMAS)
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            result=store.engine.create(machine,body['clientObjectId'],project_id,body['payload'],session['partyId'],role['id'],key)
            return JSONResponse(result,status_code=201)

    @app.post('/projects/{project_id}/{collection}/{object_id}/{command}')
    async def execute(project_id:str,collection:str,object_id:str,command:str,request:Request):
        session=identity(request);body=await body_json(request);key=key_for(request)
        require(collection in COLLECTIONS,'NOT_FOUND','Unknown collection');machine=COLLECTIONS[collection];cmd=command.replace('-','_')
        schema='Command_'+machine+'_'+cmd
        require(schema in SCHEMAS,'NOT_FOUND','Unknown command');validate(body,SCHEMAS[schema],SCHEMAS)
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId']);machine,r=machine_record(collection,object_id,project_id,session,role)
            return store.engine.execute(machine,object_id,cmd,body['expectedVersion'],body['payload'],body['evidenceIds'],session['partyId'],role['id'],key)
    return app
