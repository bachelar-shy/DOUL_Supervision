"""Project-scoped personnel addition requests. Requests never grant access or create accounts."""
from copy import deepcopy
from uuid import UUID

from fastapi import Request

from app.reference.engine import uid
from app.reference.validation import require

REQUEST_ROLES = frozenset({'SUP', 'CON', 'OWN'})
REQUESTERS = frozenset({'SUP', 'CON', 'OWN', 'DES'})
DECISIONS = frozenset({'approved', 'rejected'})


def _text(value, field, maximum, required=True):
    require(isinstance(value, str) and len(value.strip()) <= maximum
            and (not required or bool(value.strip())),
            'INVALID_REQUEST', f'{field} must be a string with at most {maximum} characters')
    return value.strip()


def install_personnel_request_routes(app, store, *, identity, role_for, key_for, body_json):
    def context(project_id, request):
        actor = identity(request)
        role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
        store.engine.get('Project', project_id)
        return actor, role

    def is_admin(actor, role, project_id):
        if role['actorGroup'] != 'ADM' or 'manage_project_roles' not in role['authorityCodes']:
            return False
        # Having the title 'admin' is not enough: validate the real project-wide grant.
        try:
            store.engine.authorize(store.engine.get('Project', project_id),
                                   'manage_project_roles', actor['partyId'], role['id'])
        except Exception:
            return False
        return True

    def visible(record, actor, admin):
        return admin or record['requesterPartyId'] == actor['partyId']

    @app.get('/projects/{project_id}/personnel-requests')
    def list_requests(project_id: str, request: Request):
        with store.transaction():
            actor, role = context(project_id, request)
            admin = is_admin(actor, role, project_id)
            records = store.meta.get('personnelRequests', {}).get(project_id, {})
            items = sorted((deepcopy(record) for record in records.values()
                            if visible(record, actor, admin)),
                           key=lambda record: (record['createdAt'], record['id']), reverse=True)
            return dict(projectId=project_id, canReview=admin,
                        pendingCount=sum(item['status'] == 'pending' for item in items),
                        items=items)

    @app.post('/projects/{project_id}/personnel-requests')
    async def request_personnel(project_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {'name', 'organization', 'requestedRole', 'reason'},
                'INVALID_REQUEST', 'Only personnel request fields are accepted')
        name = _text(body['name'], 'name', 120)
        organization = _text(body['organization'], 'organization', 160)
        reason = _text(body['reason'], 'reason', 1000)
        require(body['requestedRole'] in REQUEST_ROLES, 'INVALID_REQUEST',
                'Requests for administrator accounts are not allowed')
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role['actorGroup'] in REQUESTERS, 'NOT_AUTHORIZED',
                    'Only assigned non-administrators may request personnel')
            op = 'personnel_request:create'
            replay = store.engine._replay(project_id, actor['partyId'], op, key, body)
            if replay is not None:
                return replay
            now = store.engine.at()
            record = dict(id=uid(), projectId=project_id, version=1,
                          name=name, organization=organization, requestedRole=body['requestedRole'],
                          reason=reason, status='pending', createdAt=now, updatedAt=now,
                          requesterPartyId=actor['partyId'],
                          requesterName=store.engine.get('Party', actor['partyId'])['name'],
                          requesterRole=role['actorGroup'], reviewerPartyId=None,
                          reviewNote='', reviewedAt=None)
            store.meta.setdefault('personnelRequests', {}).setdefault(project_id, {})[record['id']] = record
            store.meta.setdefault('personnelRequestAudit', {}).setdefault(project_id, []).append(
                dict(requestId=record['id'], event='submitted', at=now,
                     partyId=actor['partyId'], roleAssignmentId=role['id'], version=1))
            result = dict(record=deepcopy(record), deliveredTo='project_admin_inbox')
            store.engine._remember(project_id, actor['partyId'], op, key, body, result)
            return result

    @app.post('/projects/{project_id}/personnel-requests/{request_id}/decision')
    async def review_request(project_id: str, request_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {'expectedVersion', 'status', 'note'},
                'INVALID_REQUEST', 'Only review fields are accepted')
        try:
            UUID(request_id)
        except (ValueError, TypeError):
            require(False, 'INVALID_REQUEST', 'Invalid request ID')
        require(type(body['expectedVersion']) is int and body['expectedVersion'] > 0,
                'INVALID_REQUEST', 'Expected request version is required')
        require(body['status'] in DECISIONS, 'INVALID_REQUEST', 'Invalid review decision')
        note = _text(body['note'], 'note', 500, required=body['status'] == 'rejected')
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(is_admin(actor, role, project_id), 'NOT_AUTHORIZED',
                    'Only this project administrator may review requests')
            operation = 'personnel_request:review'
            cached = store.engine._replay(project_id, actor['partyId'], operation, key, body)
            if cached is not None:
                return cached
            records = store.meta.get('personnelRequests', {}).get(project_id, {})
            record = records.get(request_id)
            require(record is not None, 'NOT_FOUND', 'Request not found in this project')
            require(record['version'] == body['expectedVersion'] and record['status'] == 'pending',
                    'REFERENCE_STALE', 'Request already reviewed or changed')
            now = store.engine.at()
            next_record = dict(record, version=record['version'] + 1,
                               status=body['status'], reviewNote=note, reviewedAt=now, updatedAt=now,
                               reviewerPartyId=actor['partyId'])
            records[request_id] = next_record
            store.meta.setdefault('personnelRequestAudit', {}).setdefault(project_id, []).append(
                dict(requestId=request_id, event=body['status'], at=now,
                     partyId=actor['partyId'], roleAssignmentId=role['id'],
                     previousVersion=record['version'], version=next_record['version']))
            result = dict(record=deepcopy(next_record), accountCreated=False)
            store.engine._remember(project_id, actor['partyId'], operation, key, body, result)
            return result
