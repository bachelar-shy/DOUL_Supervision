"""Authorized immutable Drawing authoring and explicit review requests."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
from fastapi import Request
from fastapi.responses import JSONResponse
from app.reference.validation import ContractError, require, validate
from services.api.modules.drawing_markups import _json_body, _valid_uuid, _domain_ref, _fingerprint, _error


def install_drawing_source_routes(app, store, *, identity, role_for, key_for, demo_enabled):
    @app.post("/projects/{project_id}/parallel/drawing-sources")
    async def register_source(project_id, request: Request):
        try:
            require(demo_enabled, "DEMO_ONLY", "Drawing authoring is available only in demo mode")
            actor = identity(request)
            body = await _json_body(request)
            require(set(body) == {"objectId", "title", "revision", "evidenceRef", "predecessorRef", "requestReview"}, "INVALID_REQUEST", "Unexpected source fields")
            require(_valid_uuid(body['objectId']) and _domain_ref(body['evidenceRef'], 'Evidence'), "INVALID_REQUEST", "Invalid source identity")
            require(body['predecessorRef'] is None or _domain_ref(body['predecessorRef'], 'InformationItem'), "INVALID_REQUEST", "Invalid predecessor")
            require(type(body['requestReview']) is bool, "INVALID_REQUEST", "requestReview must be boolean")
            require(isinstance(body['title'], str) and 0 < len(body['title'].strip()) <= 240 and isinstance(body['revision'], str) and 0 < len(body['revision'].strip()) <= 80, "INVALID_REQUEST", "Title or revision is invalid")
            key = key_for(request)
            require(isinstance(key, str) and 0 < len(key.strip()) <= 160, 'IDEMPOTENCY_KEY_INVALID', 'Request key is required')
            with store.transaction(True):
                role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
                require(role['actorGroup'] == 'DES' and role['roleCode'] == 'designer', 'NOT_AUTHORIZED', 'Designer required')
                source = store.engine.resolve(body['evidenceRef'], project_id)
                store.engine.authorize_read(source, actor['partyId'], role['id'])
                require(source['sourceType'] == 'original' and source['mediaType'] == 'document' and source.get('metadata', {}).get('mimeType') == 'application/pdf', 'SOURCE_INVALID', 'Original PDF required')
                scope = {name: deepcopy(source[name]) for name in ['packageId', 'locationId', 'discipline', 'responsibleOrganizationId', 'minimumQualificationRank'] if name in source}
                project = store.engine.get('Project', project_id)
                ranks = [rule['minimumRank'] for rule in project.get('qualificationRules', []) if rule.get('discipline') in [scope.get('discipline'), '*']]
                require(bool(ranks), 'QUALIFICATION_RULE_MISSING', 'Project must define the drawing discipline qualification')
                scope['minimumQualificationRank'] = min(ranks)
                store.engine.authorize(dict(scope, projectId=project_id), 'issue_revised_information', actor['partyId'], role['id'])
                request_key = f"drawing-source:{project_id}:{actor['partyId']}:{key}"
                fingerprint = _fingerprint(project_id, actor['partyId'], 'register-source', body)
                cached = store.requests.get(request_key)
                if cached is not None:
                    require(cached['hash'] == fingerprint, 'IDEMPOTENCY_CONFLICT', 'Source request changed')
                    drawing = store.engine.get('InformationItem', cached['result']['drawing']['id'])
                    store.engine.authorize_read(drawing, actor['partyId'], role['id'])
                    return JSONResponse(deepcopy(cached['result']), status_code=200)
                require(store.engine.get('Evidence', source['id'])['version'] == source['version'], 'REFERENCE_STALE', 'Source Evidence changed')
                content = store.blob(source['fileId'])
                require(len(content) <= 20 * 1024 * 1024 and content.startswith(b'%PDF-') and sha256(content).hexdigest() == source['fileHash'], 'SOURCE_INVALID', 'PDF identity is invalid')
                predecessor = body['predecessorRef']
                if predecessor:
                    previous = store.engine.resolve(predecessor, project_id)
                    store.engine.authorize_read(previous, actor['partyId'], role['id'])
                    require(previous.get('subtype') == 'Drawing' and store.engine.get('InformationItem', previous['id'])['version'] == previous['version'], 'REFERENCE_STALE', 'Predecessor is unavailable')
                    require(all(previous.get(field) == scope.get(field) for field in ['packageId', 'locationId', 'discipline']), 'SCOPE_MISMATCH', 'Predecessor scope differs')
                    require(previous.get('revision') != body['revision'].strip(), 'REVISION_CONFLICT', 'A successor needs a different revision')
                require(not any(oid == body['objectId'] for (_, oid) in store.engine._records), 'OBJECT_EXISTS', 'Drawing ID already exists')
                drawing = dict(scope, id=body['objectId'], projectId=project_id, version=1, subtype='Drawing', title=body['title'].strip(), revision=body['revision'].strip(), status='draft', fileIds=[source['fileId']], evidenceIds=[source['id']], relatedRefs=[deepcopy(predecessor)] if predecessor else [], createdAt=store.engine.at(), updatedAt=store.engine.at(), createdBy=actor['partyId'])
                validate(drawing, store.engine.schemas['InformationItem'], store.engine.schemas)
                store.engine._common(drawing, role)
                store.engine._save('InformationItem', drawing)
                store.engine._event(drawing, 'register_drawing_source', actor['partyId'], role['id'], key, body, None)
                binding = dict(id=str(uuid4()), projectId=project_id, drawingRef=dict(objectType='InformationItem', objectId=drawing['id'], version=1), evidenceRef=deepcopy(body['evidenceRef']), fileHash=source['fileHash'], createdAt=store.engine.at(), createdBy=actor['partyId'])
                store.meta.setdefault('drawingPdfBindings', []).append(binding)
                approval = None
                if body['requestReview']:
                    approval = store.engine.create('approval', str(uuid4()), project_id, dict(scope, targetRef=deepcopy(binding['drawingRef']), requestedBy=actor['partyId'], approvalKind='technical', evidenceIds=[source['id']]), actor['partyId'], role['id'], key + ':review')['record']
                result = dict(drawing=drawing, binding=binding, approval=approval)
                store.requests[request_key] = dict(hash=fingerprint, result=deepcopy(result))
                return JSONResponse(result, status_code=201)
        except ContractError as exc:
            status = 401 if exc.code == 'UNAUTHENTICATED' else 403 if exc.code in ['NOT_AUTHORIZED', 'DEMO_ONLY', 'SCOPE_MISMATCH', 'ASSIGNMENT_EXPIRED'] else 404 if exc.code in ['OBJECT_NOT_FOUND', 'PROJECT_MISMATCH', 'NOT_FOUND'] else 409 if exc.code in ['REFERENCE_STALE', 'IDEMPOTENCY_CONFLICT', 'OBJECT_EXISTS', 'REVISION_CONFLICT'] else 413 if exc.code == 'PAYLOAD_TOO_LARGE' else 422
            return _error(exc.code, str(exc), status)
        except (KeyError, TypeError, ValueError):
            return _error('INVALID_REQUEST', 'Drawing source request is invalid', 422)
