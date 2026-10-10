"""Server-authorized inspection authoring from exact, current field sources."""
from copy import deepcopy
import hashlib
import json
from fastapi import Request
from fastapi.responses import JSONResponse
from app.reference.validation import ContractError, require
from services.api.modules.drawing_field_control import _ref, _domain_ref


def install_inspection_authoring_routes(app, store, *, identity, role_for, key_for):
    def scope(engine, project_id, role, drawing, location_id):
        require(engine._scope([drawing.get('locationId')], location_id, True), 'SCOPE_MISMATCH', 'Location is outside drawing scope')
        location = engine.get('Location', location_id)
        require(location['projectId'] == project_id, 'PROJECT_MISMATCH', 'Location unavailable')
        project = engine.get('Project', project_id)
        ranks = [r['minimumRank'] for r in project['qualificationRules'] if r['discipline'] in {drawing['discipline'], '*'}]
        rank = max(ranks) if ranks else None
        require(rank is not None, 'QUALIFICATION_RULE_MISSING', 'Project discipline qualification is required')
        result = dict(packageId=drawing['packageId'], locationId=location_id, discipline=drawing['discipline'],
                      responsibleOrganizationId=role['organizationId'], minimumQualificationRank=rank)
        engine.authorize(dict(result, projectId=project_id), 'submit_inspection_request', role['partyId'], role['id'])
        return result

    def readable(engine, record, actor, role):
        engine.authorize_read(record, actor['partyId'], role['id'])

    def sources(engine, project_id, actor, role, drawing, location_id):
        work_scope = scope(engine, project_id, role, drawing, location_id)
        requirements, evidence = [], []
        for (kind, _), record in engine._records.items():
            if kind not in {'Requirement', 'Evidence'} or record.get('projectId') != project_id:
                continue
            if any(record.get(k) != work_scope[k] for k in ('packageId', 'discipline')):
                continue
            try:
                readable(engine, record, actor, role)
                if kind == 'Requirement':
                    if not engine._scope([record.get('locationId')], location_id, True):
                        continue
                    reference = _domain_ref(kind, record)
                    engine._common(dict(projectId=project_id, requirementRefs=[reference]), role)
                    requirements.append(dict(domainRef=reference, title=record.get('title', record['id'])))
                else:
                    if record.get('locationId') != location_id:
                        continue
                    engine._evidence_access(record['id'], dict(projectId=project_id), role)
                    evidence.append(dict(domainRef=_domain_ref(kind, record), title=record.get('metadata', {}).get('name', record['id']), mediaType=record.get('mediaType')))
            except ContractError:
                continue
        return work_scope, requirements, evidence

    def error(exc):
        code = exc.code
        status = 401 if code == 'UNAUTHENTICATED' else 403 if code in {'NOT_AUTHORIZED', 'SCOPE_MISMATCH'} else 409 if code in {'DRAWING_STALE', 'REFERENCE_STALE', 'IDEMPOTENCY_CONFLICT', 'OBJECT_EXISTS'} else 404 if code == 'NOT_FOUND' else 422
        return JSONResponse(dict(code=code, message=str(exc), failedGuards=[code]), status_code=status)

    @app.get('/projects/{project_id}/inspection-authoring/options')
    def options(project_id: str, request: Request, drawing_id: str = None, drawing_version: int = None, location_id: str = None):
        try:
            actor = identity(request)
            with store.transaction():
                engine = store.engine
                role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
                drawings = []
                for (kind, _), drawing in engine._records.items():
                    if kind != 'InformationItem' or drawing.get('projectId') != project_id or drawing.get('subtype') != 'Drawing':
                        continue
                    try:
                        readable(engine, drawing, actor, role)
                        reference = _domain_ref(kind, drawing)
                        engine._common(dict(projectId=project_id, drawingRef=reference), role)
                        locations = []
                        for (lk, _), location in engine._records.items():
                            if lk != 'Location' or location.get('projectId') != project_id:
                                continue
                            try:
                                scope(engine, project_id, role, drawing, location['id'])
                                locations.append(dict(id=location['id'], name=location.get('name', location['id'])))
                            except ContractError:
                                continue
                        if locations:
                            drawings.append(dict(domainRef=reference, title=drawing.get('title', drawing['id']), revision=drawing.get('revision', ''), locations=locations))
                    except ContractError:
                        continue
                result = dict(drawings=drawings, requirements=[], evidence=[])
                if any(v is not None for v in (drawing_id, drawing_version, location_id)):
                    require(all(v is not None for v in (drawing_id, drawing_version, location_id)), 'INVALID_REQUEST', 'Drawing version and location must be selected together')
                    chosen = next((d for d in drawings if d['domainRef'] == dict(objectType='InformationItem', objectId=drawing_id, version=drawing_version)), None)
                    require(chosen is not None, 'DRAWING_STALE', 'Selected drawing is no longer usable')
                    drawing = engine.get('InformationItem', drawing_id)
                    _, result['requirements'], result['evidence'] = sources(engine, project_id, actor, role, drawing, location_id)
                return result
        except ContractError as exc:
            return error(exc)

    @app.post('/projects/{project_id}/inspection-authoring/drafts')
    async def create(project_id: str, request: Request):
        try:
            actor = identity(request)
            body = await request.json()
            fields = {'objectId', 'drawingRef', 'locationId', 'requirementRefs', 'evidenceRefs', 'workName', 'selfInspectionComplete', 'precheck', 'holdPoint'}
            require(isinstance(body, dict) and set(body) == fields, 'INVALID_REQUEST', 'Unexpected inspection fields')
            require(_ref(dict(objectType='Inspection', objectId=body['objectId'], version=1), 'Inspection'), 'INVALID_REQUEST', 'Invalid object ID')
            require(_ref(dict(objectType='Location', objectId=body['locationId'], version=1), 'Location'), 'INVALID_REQUEST', 'Invalid location ID')
            require(_ref(body['drawingRef'], 'InformationItem'), 'INVALID_REQUEST', 'Exact Drawing reference required')
            require(isinstance(body['workName'], str) and 0 < len(body['workName'].strip()) <= 300, 'INVALID_REQUEST', 'Work name is required (300 characters maximum)')
            for field, kind in [('requirementRefs', 'Requirement'), ('evidenceRefs', 'Evidence')]:
                require(isinstance(body[field], list) and 0 < len(body[field]) <= 50 and all(_ref(r, kind) for r in body[field]), 'INVALID_REQUEST', 'Select current requirements and evidence')
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key) <= 160, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency key required')
            with store.transaction(True):
                engine = store.engine
                role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
                drawing = engine._current_reference(body['drawingRef'], project_id, object_type='InformationItem', subtype='Drawing')
                readable(engine, drawing, actor, role)
                scope(engine, project_id, role, drawing, body['locationId'])
                request_key = f"inspection-authoring:{project_id}:{actor['partyId']}:{key}"
                fingerprint = hashlib.sha256(json.dumps(dict(body, roleAssignmentId=role['id']), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                cached = store.requests.get(request_key)
                if cached:
                    require(cached['hash'] == fingerprint, 'IDEMPOTENCY_CONFLICT', 'Inspection authoring request changed')
                    return JSONResponse(deepcopy(cached['result']), status_code=200)
                work_scope, requirements, evidence = sources(engine, project_id, actor, role, drawing, body['locationId'])
                require(all(r in [o['domainRef'] for o in requirements] for r in body['requirementRefs']), 'REQUIREMENT_STALE', 'Requirement baseline is outside scope or no longer active')
                require(all(r in [o['domainRef'] for o in evidence] for r in body['evidenceRefs']), 'EVIDENCE_INVALID', 'Evidence version or work location does not match')
                payload = dict(work_scope, workName=body['workName'].strip(), selfInspectionComplete=body['selfInspectionComplete'], precheck=deepcopy(body['precheck']), holdPoint=body['holdPoint'], nextWorkAllowed=False, drawingRef=deepcopy(body['drawingRef']), requirementRefs=deepcopy(body['requirementRefs']), evidenceIds=list(dict.fromkeys(r['objectId'] for r in body['evidenceRefs'])))
                result = engine.create('inspection', body['objectId'], project_id, payload, actor['partyId'], role['id'], key)
                store.requests[request_key] = dict(hash=fingerprint, result=deepcopy(result))
                return JSONResponse(result, status_code=201)
        except ContractError as exc:
            return error(exc)
