"""Local-development HTTP adapter. Not production authentication or e-signature.

Uses the PR #2 contracts directly. No client-supplied authority objects and no
status PATCH endpoint. Run only on loopback using python -m services.api --demo.
"""
import base64
import binascii
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
import re
from pathlib import Path
import secrets
from threading import RLock
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.middleware.trustedhost import TrustedHostMiddleware
from app.reference.engine import canonical, uid
from app.reference.validation import ContractError, require, instant, validate
from .application import (
    add_derived_frame,
    analysis_review_package,
    build_inspection_case,
    complete_media_analysis,
    create_case_owner_report,
    create_issue_package,
    create_media_issue_package,
    create_reinspection_request,
    fail_media_analysis,
    queue_media_analysis,
    start_media_analysis,
)
from .persistence import PersistencePort, create_local_persistence

ROOT=Path(__file__).resolve().parents[2]
SPEC=json.loads((ROOT/'app/api/openapi.yaml').read_text())
SCHEMAS=SPEC['components']['schemas']
MACHINE_BINDINGS=json.loads((ROOT/'app/reference/machine_bindings_v1.json').read_text())['machines']
COLLECTIONS={binding['collection']:name for name,binding in MACHINE_BINDINGS.items()}
DEFAULT_ORIGINS=['http://127.0.0.1:5181','http://localhost:5181','http://127.0.0.1:8791','http://localhost:8791']
MAX_FILE=64*1024*1024
MAX_CHUNK=4*1024*1024


def development_origins():
    raw=os.getenv('DOUL_API_ALLOWED_ORIGINS','')
    origins=[x.strip() for x in raw.split(',') if x.strip()] if raw else list(DEFAULT_ORIGINS)
    if not origins:raise RuntimeError('At least one development origin is required')
    result=[]
    for origin in origins:
        parsed=urlsplit(origin)
        if parsed.scheme!='http' or parsed.hostname not in ['127.0.0.1','localhost'] or parsed.username or parsed.password or parsed.path not in ['', '/'] or parsed.query or parsed.fragment:
            raise RuntimeError('DOUL_API_ALLOWED_ORIGINS accepts loopback HTTP origins only')
        normalized=origin.rstrip('/')
        if normalized not in result:result.append(normalized)
    return result


def status_for(code):
    if code=='UNAUTHENTICATED':return 401
    if code in ['OBJECT_NOT_FOUND','DOCUMENT_NOT_FOUND','PROJECT_MISMATCH','NOT_FOUND']:return 404
    if code in ['NOT_AUTHORIZED','ASSIGNMENT_EXPIRED','SCOPE_MISMATCH','ORGANIZATION_MISMATCH','QUALIFICATION_INVALID','NONHUMAN_OFFICIAL_DENIED','RECIPIENT_MISMATCH','ORIGIN_DENIED']:return 403
    if code in ['ADAPTER_NOT_CONFIGURED']:return 501
    if code=='PAYLOAD_TOO_LARGE':return 413
    if code in ['MIME_INVALID']:return 415
    if code.startswith(('SCHEMA','FORM_')) or code in ['INVALID_REQUEST','INVALID_DATETIME','COMMAND_FIELD_INVALID','COMMAND_FIELD_REQUIRED','RFI_PACKAGE_COMPLETE']:return 422
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


def create_app(db_path=':memory:', demo=False, persistence=None, queue_enabled=None, document_runtime=None, authentication=None):
    from services.runtime_config import environment
    stage=environment()
    if demo and stage!='development':raise RuntimeError('Demonstration mode is forbidden outside development')
    if not demo:
        if stage=='development':raise RuntimeError('Production auth requires an explicitly configured staging or pilot environment')
        from services.deployment.auth import PinnedJWT
        from services.deployment.gates import https_origins,allowed_hosts,validate_store
        authentication=authentication or PinnedJWT.configured()
        origins=https_origins();hosts=allowed_hosts()
        if persistence is None:raise RuntimeError('Non-demo API requires explicitly provisioned persistence')
        validate_store(persistence,stage)
    else:
        origins=development_origins();hosts=['127.0.0.1','localhost','testserver']
    if persistence is not None and not isinstance(persistence,PersistencePort):
        raise TypeError('persistence must satisfy PersistencePort')
    store=persistence if persistence is not None else create_local_persistence(db_path,demo=True)
    app=FastAPI(title='DOUL Supervision API',version='0.1.0',docs_url='/api-docs' if demo else None,openapi_url='/openapi.json' if demo else None,redoc_url=None)
    app.state.document_runtime=document_runtime
    if document_runtime is None and os.getenv('DOUL_DOCUMENT_RUNTIME') == 'local':
        from services.document_runtime.render import LocalDocumentRuntime
        app.state.document_runtime=LocalDocumentRuntime(os.environ['DOUL_DOCUMENT_CACHE'])
    app.state.store=store
    app.state.queue_enabled = (os.getenv('DOUL_QUEUE_ENABLED', '').lower() == 'true') if queue_enabled is None else bool(queue_enabled)
    app.state.allowed_origins=origins

    async def system_request_log(request, call_next):
        import time
        from uuid import uuid4
        from services.telemetry import emit
        request_id = str(uuid4())
        started = time.monotonic()
        status = 500
        error_type = None
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers['X-Request-ID'] = request_id
            return response
        except Exception as exc:
            error_type = type(exc).__name__
            raise
        finally:
            route = getattr(request.scope.get('route'), 'path', 'unmatched')
            emit('api', 'http-request', method=request.method, route=route,
                 requestId=request_id, statusCode=status,
                 latencyMs=round((time.monotonic() - started) * 1000, 3), errorType=error_type)

    sessions={};session_lock=RLock()
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=hosts)
    app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=['GET','POST','PUT'],allow_headers=['Authorization','Content-Type','X-RoleAssignment-Id','Idempotency-Key','Upload-Offset'])

    @app.exception_handler(ContractError)
    async def contract_error(request,exc):return JSONResponse(error_body(exc),status_code=status_for(exc.code))

    def identity(request):
        auth=request.headers.get('authorization','')
        token=auth[7:] if auth.startswith('Bearer ') else ''
        if not demo:return authentication.session(token,store)
        with session_lock:session=sessions.get(token)
        require(session is not None and session['expires']>datetime.now(timezone.utc),'UNAUTHENTICATED','Development session missing or expired')
        return session

    def role_for(session,project,role_id=None):
        valid_id(project)
        if not demo:
            binding=store.meta.get('identityBindings',{}).get(session['identityKey'],{})
            require(binding.get('active') is True and binding.get('partyId')==session['partyId'] and session['issuedAt']>=binding.get('validAfter',0),'UNAUTHENTICATED','Identity is revoked')
            party=store.engine.get('Party',session['partyId'])
            require(party.get('loginEnabled') is True,'UNAUTHENTICATED','Identity is disabled')
        rid=role_id or session['roleAssignmentId']
        role=store.engine.get('RoleAssignment',rid)
        require(role['partyId']==session['partyId'],'NOT_AUTHORIZED','Role does not belong to this session')
        require(role['projectId']==project,'PROJECT_MISMATCH','Project unavailable')
        require(role['active'] and instant(role['validFrom'])<=instant(store.engine.at())<instant(role['validTo']),'ASSIGNMENT_EXPIRED','Project assignment is inactive or expired')
        return role

    def readable(record,session,role):
        require(record['projectId']==role['projectId'],'PROJECT_MISMATCH','Project unavailable')
        store.engine.authorize_read(record,session['partyId'],role['id'])

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

    def application_replay(operation,key,project_id,session,body):
        request_key='application:'+project_id+':'+session['partyId']+':'+operation+':'+key
        fingerprint=sha256(canonical(body)).hexdigest()
        cached=store.requests.get(request_key)
        if cached:
            require(cached['hash']==fingerprint,'IDEMPOTENCY_CONFLICT','Application request changed')
            return deepcopy(cached['result']),request_key,fingerprint
        return None,request_key,fingerprint

    def remember_application(request_key,fingerprint,result):
        store.requests[request_key]=dict(hash=fingerprint,result=deepcopy(result))

    def service_replay(operation,key,project_id,actor,body):
        request_key='service:'+project_id+':'+actor['partyId']+':'+operation+':'+key
        fingerprint=sha256(canonical(body)).hexdigest()
        cached=store.requests.get(request_key)
        if cached:
            require(cached['hash']==fingerprint,'IDEMPOTENCY_CONFLICT','Service request changed')
            return deepcopy(cached['result']),request_key,fingerprint
        return None,request_key,fingerprint

    def service_actor(group):
        require(group in store.meta.get('serviceActors',{}),'ADAPTER_NOT_CONFIGURED','Service actor is not provisioned')
        return deepcopy(store.meta['serviceActors'][group])

    def dev_worker_operator(request):
        session=identity(request)
        require(session['actorGroup']=='ADM','NOT_AUTHORIZED','Local media worker ingress requires the demo administrator')
        return session

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
            results.append(dict(command=transition['command'],to=transition['to'],authority=transition['authority'],fields=fields,requiresEvidence=transition['required_evidence'],ready=failure is None,requiresInput=bool(fields) or transition['required_evidence'],blockedReason=failure,expectedVersion=record['version']))
        return results

    @app.get('/ready')
    def ready():
        try:
            with store.transaction():
                initialized = bool(store.engine._records)
            if not initialized:
                return JSONResponse({'status': 'error', 'errorType': 'UnprovisionedStore'}, status_code=503)
            return {'status': 'ok', 'database': 'reachable'}
        except Exception as exc:
            return JSONResponse({'status': 'error', 'errorType': type(exc).__name__}, status_code=503)

    @app.get('/health')
    def health():return dict(status='ok',mode='local-demo' if demo else stage,baseCommit=(os.getenv('DOUL_RELEASE_SHA', '') if re.fullmatch(r'[a-f0-9]{40}', os.getenv('DOUL_RELEASE_SHA', '')) else 'unversioned-development'),adapters={'database':store.adapter_name,'workflow':'merged-reference-engine','authentication':'explicit-local-demo' if demo else 'pinned-rs256-access-token','mediaPipeline':'durable-outbox-redis-worker' if app.state.queue_enabled else 'normalized-worker-ingress-demo-only','ai':'provider-not-configured','legalSignature':'not-configured','pdfDocx':'not-configured'})

    @app.get('/dev/actors')
    def actors():
        with store.transaction():return [dict(actorGroup=g,name=a['name']) for g,a in store.meta['actors'].items()]

    @app.post('/dev/sessions')
    async def login(request:Request):
        origin=request.headers.get('origin')
        require(origin is None or origin in origins,'ORIGIN_DENIED','Development origin not allowed')
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
            return dict(project=store.engine.get('Project',project_id),role=role,items=items,audit=audits,context=({k:v for k,v in store.meta.items() if k in ['projectId','scope','analysisProfile','requirementRef','drawingRef','evidenceId']} if store.meta.get('projectId')==project_id else {'projectId':project_id}),participants=[dict(partyId=r['partyId'],name=store.engine.get('Party',r['partyId'])['name'],actorGroup=r['actorGroup']) for (kind,_),r in store.engine._records.items() if kind=='RoleAssignment' and r['projectId']==project_id and r['active'] and r['actorGroup'] in ['SUP','CON','OWN','DES','ADM']],formSchemas=store.documents.schemas,demo=demo)

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



    @app.post('/projects/{project_id}/media-analysis-runs')
    async def request_media_analysis(project_id:str,request:Request):
        """Queue analysis using a server-controlled model/prompt/policy profile."""
        session=identity(request);body=await body_json(request);key=key_for(request)
        allowed={'roleAssignmentId','clientObjectId','sourceEvidenceIds','mode','languages','inspectionId','retryOfId'}
        required={'roleAssignmentId','clientObjectId','sourceEvidenceIds','mode','languages'}
        require(required<=set(body)<=allowed,'INVALID_REQUEST','Unexpected or missing media-analysis request fields')
        for value in [body['roleAssignmentId'],body['clientObjectId']]:valid_id(value)
        if body.get('inspectionId'):valid_id(body['inspectionId'])
        if body.get('retryOfId'):valid_id(body['retryOfId'])
        require(isinstance(body['sourceEvidenceIds'],list) and bool(body['sourceEvidenceIds']),'INVALID_REQUEST','sourceEvidenceIds must be a non-empty array')
        for value in body['sourceEvidenceIds']:valid_id(value)
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            if not demo:
                require(store.meta.get('projectConfiguration',{}).get('mediaPolicy',{}).get('enabled') is True,'ADAPTER_NOT_CONFIGURED','Media processing is not enabled for this environment')
            for evidence_id in body['sourceEvidenceIds']:
                evidence=store.engine.get('Evidence',evidence_id);readable(evidence,session,role)
            if body.get('inspectionId'):
                inspection=store.engine.get('Inspection',body['inspectionId']);readable(inspection,session,role)
            replay,request_key,fingerprint=application_replay('queue-media-analysis',key,project_id,session,body)
            if replay is not None:return JSONResponse(replay,status_code=201)
            run=queue_media_analysis(
                store.engine,
                body['clientObjectId'],
                body['sourceEvidenceIds'],
                body['mode'],
                body['languages'],
                store.meta['analysisProfile'],
                session['partyId'],
                role['id'],
                key,
                body.get('inspectionId'),
                body.get('retryOfId'),
            )
            if app.state.queue_enabled:
                from services.worker.jobs import register_job
                register_job(store, run)
            remember_application(request_key,fingerprint,run)
            return JSONResponse(run,status_code=201)

    @app.get('/projects/{project_id}/media-analysis-runs/{run_id}')
    def media_analysis_review(project_id:str,run_id:str,request:Request):
        """Return normalized worker outputs plus candidate observations for human review."""
        session=identity(request);valid_id(run_id)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            package=analysis_review_package(store.engine,run_id)
            require(package['run']['projectId']==project_id,'PROJECT_MISMATCH','Analysis run unavailable')
            readable(package['run'],session,role)
            for source in package['sources']:readable(source,session,role)
            candidates=[]
            for record in package['candidates']:
                try:
                    readable(record,session,role)
                    candidates.append(dict(machine='observation',record=record,actions=preflight('observation',record,session,role)))
                except ContractError:
                    pass
            target_inspection=None
            if package['targetInspection'] is not None:
                readable(package['targetInspection'],session,role)
                target_inspection=dict(
                    machine='inspection',
                    record=package['targetInspection'],
                    actions=preflight('inspection',package['targetInspection'],session,role),
                )
            return dict(
                run=dict(machine='analysis_run',record=package['run'],actions=preflight('analysis_run',package['run'],session,role)),
                sources=package['sources'],
                candidates=candidates,
                targetInspection=target_inspection,
                issueReadiness=package['issueReadiness'],
                transcripts=package['transcripts'],
                frames=package['frames'],
                photoResults=package['photoResults'],
                coverage=package['coverage'],
            )

    @app.post('/projects/{project_id}/media-analysis-runs/{run_id}/issues')
    async def create_media_issue(project_id:str,run_id:str,request:Request):
        """Create an official issue package from confirmed candidates of one explicitly linked media run."""
        session=identity(request);body=await body_json(request);key=key_for(request);valid_id(run_id)
        required={'roleAssignmentId','issueObjectId','actionObjectId','observationIds','subtype','title','actionTitle','responsiblePartyId','dueAt'}
        require(set(body)==required,'INVALID_REQUEST','Unexpected or missing media issue-package fields')
        for value in [body['roleAssignmentId'],body['issueObjectId'],body['actionObjectId'],body['responsiblePartyId']]:
            valid_id(value)
        require(isinstance(body['observationIds'],list) and bool(body['observationIds']),'INVALID_REQUEST','observationIds must be a non-empty array')
        for value in body['observationIds']:valid_id(value)
        require(all(isinstance(body[x],str) and body[x].strip() for x in ['subtype','title','actionTitle','dueAt']),'INVALID_REQUEST','Media issue package text fields are required')
        instant(body['dueAt'])
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            run=store.engine.get('AnalysisRun',run_id);readable(run,session,role)
            for observation_id in body['observationIds']:
                readable(store.engine.get('Observation',observation_id),session,role)
            replay,request_key,fingerprint=application_replay('create-media-issue-package',key,project_id,session,body|{'runId':run_id})
            if replay is not None:return JSONResponse(replay,status_code=201)
            result=create_media_issue_package(
                store.engine,
                run_id,
                body['issueObjectId'],
                body['actionObjectId'],
                body['observationIds'],
                body['subtype'],
                body['title'],
                body['actionTitle'],
                body['responsiblePartyId'],
                body['dueAt'],
                session['partyId'],
                role['id'],
                key,
            )
            remember_application(request_key,fingerprint,result)
            return JSONResponse(result,status_code=201)

    @app.post('/dev/media-worker/projects/{project_id}/evidence/{evidence_id}/index')
    async def dev_media_index(project_id:str,evidence_id:str,request:Request):
        """Demo-only normalized media index ingress. Not a production worker credential."""
        session=dev_worker_operator(request);body=await body_json(request);key=key_for(request);valid_id(evidence_id)
        require(set(body)=={'durationMs','framePtsMs','metadata'},'INVALID_REQUEST','Media index requires durationMs, framePtsMs and metadata')
        with store.transaction(True):
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            evidence=store.engine.get('Evidence',evidence_id);readable(evidence,session,role)
            system=service_actor('SYSTEM')
            replay,request_key,fingerprint=service_replay('index-media',key,project_id,system,body|{'evidenceId':evidence_id})
            if replay is not None:return replay
            result=store.engine.index_media_evidence(
                evidence_id,
                body['durationMs'],
                body['framePtsMs'],
                body['metadata'],
                system['partyId'],
                system['roleAssignmentId'],
                key,
            )['record']
            remember_application(request_key,fingerprint,result)
            return result

    @app.post('/dev/media-worker/projects/{project_id}/runs/{run_id}/start')
    async def dev_media_start(project_id:str,run_id:str,request:Request):
        """Demo-only worker claim/start ingress."""
        session=dev_worker_operator(request);body=await body_json(request);key=key_for(request);valid_id(run_id)
        require(body=={},'INVALID_REQUEST','Start body must be empty')
        with store.transaction(True):
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            run=store.engine.get('AnalysisRun',run_id);readable(run,session,role)
            system=service_actor('SYSTEM')
            replay,request_key,fingerprint=service_replay('start-media-analysis',key,project_id,system,{'runId':run_id})
            if replay is not None:return replay
            result=start_media_analysis(store.engine,run_id,system,key)
            remember_application(request_key,fingerprint,result)
            return result

    @app.post('/dev/media-worker/projects/{project_id}/runs/{run_id}/frames')
    async def dev_media_frame(project_id:str,run_id:str,request:Request):
        """Demo-only derived-frame ingress preserving exact decoder frame index and PTS."""
        session=dev_worker_operator(request);body=await body_json(request);key=key_for(request);valid_id(run_id)
        required={'frameObjectId','fileObjectId','sourceEvidenceId','frameIndex','ptsMs','mimeType','contentBase64'}
        require(set(body)==required,'INVALID_REQUEST','Derived frame fields are incomplete')
        for value in [body['frameObjectId'],body['fileObjectId'],body['sourceEvidenceId']]:valid_id(value)
        require(type(body['frameIndex']) is int and type(body['ptsMs']) is int,'INVALID_REQUEST','frameIndex and ptsMs must be integers')
        try:content=base64.b64decode(body['contentBase64'],validate=True)
        except (binascii.Error,ValueError):raise ContractError('INVALID_REQUEST','contentBase64 is invalid')
        require(bool(content) and len(content)<=MAX_CHUNK,'PAYLOAD_TOO_LARGE','Derived frame exceeds the development chunk limit')
        with store.transaction(True):
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            run=store.engine.get('AnalysisRun',run_id);readable(run,session,role)
            system=service_actor('SYSTEM')
            fingerprint_body={k:v for k,v in body.items() if k!='contentBase64'}|{'contentHash':sha256(content).hexdigest()}
            replay,request_key,fingerprint=service_replay('add-derived-frame',key,project_id,system,fingerprint_body|{'runId':run_id})
            if replay is not None:return replay
            result=add_derived_frame(
                store.engine,
                run_id,
                body['frameObjectId'],
                body['fileObjectId'],
                body['sourceEvidenceId'],
                body['frameIndex'],
                body['ptsMs'],
                content,
                body['mimeType'],
                system,
                key,
            )
            store.put_blob(result['fileId'],content)
            remember_application(request_key,fingerprint,result)
            return JSONResponse(result,status_code=201)

    @app.post('/dev/media-worker/projects/{project_id}/runs/{run_id}/complete')
    async def dev_media_complete(project_id:str,run_id:str,request:Request):
        """Demo-only normalized worker completion; creates AI observation candidates atomically."""
        session=dev_worker_operator(request);body=await body_json(request);key=key_for(request);valid_id(run_id)
        require(set(body)=={'outputs','coverage','completedAt'},'INVALID_REQUEST','Worker completion requires outputs, coverage and completedAt')
        instant(body['completedAt'])
        with store.transaction(True):
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            run=store.engine.get('AnalysisRun',run_id);readable(run,session,role)
            system=service_actor('SYSTEM');ai=service_actor('AI')
            replay,request_key,fingerprint=service_replay('complete-media-analysis',key,project_id,system,body|{'runId':run_id})
            if replay is not None:return replay
            result=complete_media_analysis(
                store.engine,
                run_id,
                body['outputs'],
                body['coverage'],
                body['completedAt'],
                system,
                ai,
                key,
            )
            remember_application(request_key,fingerprint,result)
            return result

    @app.post('/dev/media-worker/projects/{project_id}/runs/{run_id}/fail')
    async def dev_media_fail(project_id:str,run_id:str,request:Request):
        """Demo-only worker failure ingress retaining the run and reason."""
        session=dev_worker_operator(request);body=await body_json(request);key=key_for(request);valid_id(run_id)
        require(set(body)=={'reason'} and isinstance(body['reason'],str),'INVALID_REQUEST','Worker failure reason is required')
        with store.transaction(True):
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            run=store.engine.get('AnalysisRun',run_id);readable(run,session,role)
            system=service_actor('SYSTEM')
            replay,request_key,fingerprint=service_replay('fail-media-analysis',key,project_id,system,body|{'runId':run_id})
            if replay is not None:return replay
            result=fail_media_analysis(store.engine,run_id,body['reason'],system,key)
            remember_application(request_key,fingerprint,result)
            return result

    @app.get('/projects/{project_id}/inspection-cases/{inspection_id}')
    def inspection_case(project_id:str,inspection_id:str,request:Request):
        """Inspection-centered application read model for UI/workbench clients."""
        session=identity(request)
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            valid_id(inspection_id)
            graph=build_inspection_case(store.engine,inspection_id)
            require(graph['projectId']==project_id,'PROJECT_MISMATCH','Project unavailable')
            readable(graph['rootInspection'],session,role)

            def item(machine,record):
                readable(record,session,role)
                return dict(machine=machine,record=deepcopy(record),actions=preflight(machine,record,session,role))

            visible_ids={graph['rootInspection']['id']}
            groups=[]
            for group in graph['issues']:
                try:issue=item('issue',group['issue'])
                except ContractError:continue
                visible_ids.add(issue['record']['id'])

                def visible_items(machine,key):
                    result=[]
                    for record in group[key]:
                        try:
                            decorated=item(machine,record);result.append(decorated);visible_ids.add(record['id'])
                        except ContractError:pass
                    return result

                owner_reports=visible_items('report','ownerReports')
                visible_report_ids={record['record']['id'] for record in owner_reports}
                readiness=deepcopy(group['readiness'])
                closeout_ids=[
                    report_id for report_id in readiness.get('closeoutReportIds',[])
                    if report_id in visible_report_ids
                ]
                closeout_reports=[
                    record['record'] for record in owner_reports
                    if record['record']['id'] in closeout_ids
                ]
                readiness.update(
                    closeoutReportIds=closeout_ids,
                    ownerReportDraftReady=(
                        issue['record'].get('status')=='closed' and not closeout_ids
                    ),
                    ownerReportIssuePending=(
                        bool(closeout_reports)
                        and not any(
                            report.get('status') in ['issued','acknowledged','followup','verified','closed']
                            for report in closeout_reports
                        )
                    ),
                    ownerReceiptPending=any(
                        report.get('status')=='issued' for report in closeout_reports
                    ),
                    ownerReceiptConfirmed=any(
                        report.get('status') in ['acknowledged','followup','verified','closed']
                        for report in closeout_reports
                    ),
                    ownerReportingComplete=any(
                        report.get('status')=='closed' for report in closeout_reports
                    ),
                )
                groups.append(dict(
                    issue=issue,
                    observations=visible_items('observation','observations'),
                    correctiveActions=visible_items('action','correctiveActions'),
                    inspections=visible_items('inspection','inspections'),
                    ownerReports=owner_reports,
                    readiness=readiness,
                    currentCorrectionCycle=group['currentCorrectionCycle'],
                ))

            root=item('inspection',graph['rootInspection'])
            owner_reports=[]
            for record in graph['ownerReports']:
                try:
                    decorated=item('report',record);owner_reports.append(decorated);visible_ids.add(record['id'])
                except ContractError:pass
            timeline=[event for event in graph['timeline'] if event['objectRef']['objectId'] in visible_ids]
            open_issues=[group['issue']['record']['id'] for group in groups if group['issue']['record'].get('status')!='closed']
            reporting_pending=[
                group['issue']['record']['id'] for group in groups
                if group['issue']['record'].get('status')=='closed' and not group['readiness']['ownerReportingComplete']
            ]
            return dict(
                caseId=graph['caseId'],
                requestedInspectionId=graph['requestedInspectionId'],
                projectId=project_id,
                rootInspection=root,
                issues=groups,
                ownerReports=owner_reports,
                readiness=dict(
                    openIssueIds=open_issues,
                    ownerReportingPendingIssueIds=reporting_pending,
                    complete=bool(groups) and not open_issues and not reporting_pending,
                ),
                timeline=timeline,
            )


    @app.post('/projects/{project_id}/inspection-cases/{inspection_id}/issues')
    async def create_case_issue(project_id:str,inspection_id:str,request:Request):
        """Create/assign an Issue and its first corrective Action in one transaction."""
        session=identity(request);body=await body_json(request);key=key_for(request)
        required={'roleAssignmentId','issueObjectId','actionObjectId','observationIds','subtype','title','actionTitle','responsiblePartyId','dueAt'}
        require(set(body)==required,'INVALID_REQUEST','Unexpected or missing issue-package fields')
        for value in [inspection_id,body['roleAssignmentId'],body['issueObjectId'],body['actionObjectId'],body['responsiblePartyId']]:
            valid_id(value)
        require(isinstance(body['observationIds'],list) and bool(body['observationIds']),'INVALID_REQUEST','observationIds must be a non-empty array')
        for value in body['observationIds']:valid_id(value)
        require(all(isinstance(body[x],str) and body[x].strip() for x in ['subtype','title','actionTitle','dueAt']),'INVALID_REQUEST','Issue package text fields are required')
        instant(body['dueAt'])
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            inspection=store.engine.get('Inspection',inspection_id);readable(inspection,session,role)
            replay,request_key,fingerprint=application_replay(
                'create-issue-package',key,project_id,session,body|{'inspectionId':inspection_id}
            )
            if replay is not None:return JSONResponse(replay,status_code=201)
            result=create_issue_package(
                store.engine,
                inspection_id,
                body['issueObjectId'],
                body['actionObjectId'],
                body['observationIds'],
                body['subtype'],
                body['title'],
                body['actionTitle'],
                body['responsiblePartyId'],
                body['dueAt'],
                session['partyId'],
                role['id'],
                key,
            )
            remember_application(request_key,fingerprint,result)
            return JSONResponse(result,status_code=201)

    @app.post('/projects/{project_id}/inspection-cases/{inspection_id}/issues/{issue_id}/reinspections')
    async def create_case_reinspection(project_id:str,inspection_id:str,issue_id:str,request:Request):
        """Create, submit and link a reinspection request in one transaction."""
        session=identity(request);body=await body_json(request);key=key_for(request)
        required={'roleAssignmentId','reinspectionObjectId','workName','requestedInspectionAt','selfInspectionComplete','precheck','evidenceIds'}
        require(set(body)==required,'INVALID_REQUEST','Unexpected or missing reinspection fields')
        for value in [inspection_id,issue_id,body['roleAssignmentId'],body['reinspectionObjectId']]:
            valid_id(value)
        require(isinstance(body['workName'],str) and body['workName'].strip(),'INVALID_REQUEST','workName is required')
        require(isinstance(body['requestedInspectionAt'],str),'INVALID_REQUEST','requestedInspectionAt is required')
        instant(body['requestedInspectionAt'])
        require(body['selfInspectionComplete'] is True,'SELF_INSPECTION_COMPLETE','Contractor self-inspection must be complete')
        precheck=body['precheck']
        require(isinstance(precheck,dict) and set(precheck)=={'drawing','material','test','previous','change'} and all(type(v) is bool for v in precheck.values()),'INVALID_REQUEST','precheck must contain five boolean checks')
        require(isinstance(body['evidenceIds'],list) and bool(body['evidenceIds']),'INVALID_REQUEST','evidenceIds must be a non-empty array')
        for value in body['evidenceIds']:valid_id(value)
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            inspection=store.engine.get('Inspection',inspection_id);readable(inspection,session,role)
            issue=store.engine.get('Issue',issue_id);readable(issue,session,role)
            replay,request_key,fingerprint=application_replay(
                'create-reinspection-request',
                key,
                project_id,
                session,
                body|{'inspectionId':inspection_id,'issueId':issue_id},
            )
            if replay is not None:return JSONResponse(replay,status_code=201)
            result=create_reinspection_request(
                store.engine,
                inspection_id,
                issue_id,
                body['reinspectionObjectId'],
                body['workName'],
                body['requestedInspectionAt'],
                body['selfInspectionComplete'],
                precheck,
                body['evidenceIds'],
                session['partyId'],
                role['id'],
                key,
            )
            remember_application(request_key,fingerprint,result)
            return JSONResponse(result,status_code=201)

    @app.post('/projects/{project_id}/inspection-cases/{inspection_id}/issues/{issue_id}/owner-reports')
    async def create_case_report(project_id:str,inspection_id:str,issue_id:str,request:Request):
        """Create a closeout owner-report draft with exact case provenance."""
        session=identity(request);body=await body_json(request);key=key_for(request)
        required={
            'roleAssignmentId','reportObjectId','title','revision','type','priority',
            'recipientIds','facts','impact','recommendation','dueAt','receiptDueAt',
        }
        allowed=required|{'cause','immediateActions'}
        require(required<=set(body)<=allowed,'INVALID_REQUEST','Unexpected or missing owner-report fields')
        for value in [inspection_id,issue_id,body['roleAssignmentId'],body['reportObjectId']]:
            valid_id(value)
        require(isinstance(body['recipientIds'],list) and bool(body['recipientIds']),'INVALID_REQUEST','recipientIds must be a non-empty array')
        for value in body['recipientIds']:valid_id(value)
        require(all(isinstance(body[x],str) and body[x].strip() for x in ['title','revision','type','priority','facts','recommendation','dueAt','receiptDueAt']),'INVALID_REQUEST','Owner-report text fields are required')
        require(isinstance(body['impact'],dict) and bool(body['impact']),'INVALID_REQUEST','impact must be a non-empty object')
        for field in ['cause','immediateActions']:
            if field in body:require(isinstance(body[field],str),'INVALID_REQUEST',field+' must be text')
        instant(body['dueAt']);instant(body['receiptDueAt'])
        with store.transaction(True):
            role=role_for(session,project_id,body['roleAssignmentId'])
            requested=store.engine.get('Inspection',inspection_id);readable(requested,session,role)
            issue=store.engine.get('Issue',issue_id);readable(issue,session,role)
            replay,request_key,fingerprint=application_replay(
                'create-case-owner-report',
                key,
                project_id,
                session,
                body|{'inspectionId':inspection_id,'issueId':issue_id},
            )
            if replay is not None:return JSONResponse(replay,status_code=201)
            result=create_case_owner_report(
                store.engine,
                inspection_id,
                issue_id,
                body['reportObjectId'],
                body['title'],
                body['revision'],
                body['type'],
                body['priority'],
                body['recipientIds'],
                body['facts'],
                body.get('cause',''),
                body['impact'],
                body.get('immediateActions',''),
                body['recommendation'],
                body['dueAt'],
                body['receiptDueAt'],
                session['partyId'],
                role['id'],
                key,
            )
            remember_application(request_key,fingerprint,result)
            return JSONResponse(result,status_code=201)

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

    @app.get('/projects/{project_id}/documents/{document_id}/exports/{format}')
    def document_export(project_id:str,document_id:str,format:str,request:Request):
        session=identity(request)
        require(format in {'docx','pdf'},'NOT_FOUND','Unsupported export format')
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            snapshot=store.documents.get(document_id);readable(snapshot,session,role)
            preserved=store.documents.rerender(document_id)
        require(app.state.document_runtime is not None,'ADAPTER_NOT_CONFIGURED','Reproducible document runtime is not installed')
        try:
            artifact=app.state.document_runtime.export(snapshot,preserved,format)
        except Exception:
            raise ContractError('ADAPTER_NOT_CONFIGURED','Document export failed integrity or runtime checks')
        # Recheck visibility after conversion; a revoked role cannot receive bytes.
        with store.transaction():
            role=role_for(session,project_id,request.headers.get('x-roleassignment-id'))
            readable(store.documents.get(document_id),session,role)
        return Response(artifact['content'],media_type=artifact['mediaType'],headers={
            'Content-Disposition':'attachment; filename="'+snapshot['formId']+'-'+snapshot['id']+'.'+format+'"',
            'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
            'X-Artifact-SHA256':artifact['sha256'],'X-Source-Render-Hash':snapshot['renderHash'],
            'X-Source-Snapshot-ID':snapshot['id'],'X-Legal-Signature-Transferred':'false'})

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
    if not demo:
        app.router.routes=[route for route in app.router.routes if not getattr(route,'path','').startswith('/dev/')]
    app.middleware('http')(system_request_log)
    return app
