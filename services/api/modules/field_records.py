"""Project-scoped field record drafts. Never equate a draft with an approved site report."""
from copy import deepcopy
from datetime import date
from uuid import UUID

from fastapi import Request

from app.reference.engine import uid
from app.reference.validation import require

AUTHOR_ROLES = frozenset({'SUP', 'CON', 'ADM'})
RECORD_TYPES = frozenset({'daily', 'inspection_support', 'site_issue', 'other'})


def _text(value, field, limit):
    require(isinstance(value, str) and bool(value.strip()) and len(value.strip()) <= limit,
            'INVALID_REQUEST', field + ' is required and must not exceed ' + str(limit) + ' characters')
    return value.strip()


def _date(value):
    require(isinstance(value, str) and len(value) == 10, 'INVALID_REQUEST', 'Record date must be YYYY-MM-DD')
    try:
        parsed = date.fromisoformat(value)
        require(parsed.isoformat() == value, 'INVALID_REQUEST', 'Invalid field record date')
    except ValueError:
        require(False, 'INVALID_REQUEST', 'Invalid field record date')
    return value


def install_field_record_routes(app, store, *, identity, role_for, key_for, body_json):
    def context(project_id, request, actor):
        role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
        require(role['id'] == actor['roleAssignmentId'], 'NOT_AUTHORIZED',
                'Field records require the authenticated project role')
        store.engine.get('Project', project_id)
        return role

    @app.get('/projects/{project_id}/field-records')
    def field_records(project_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            records = store.meta.get('fieldRecordDrafts', {}).get(project_id, {})
            rows = sorted(
                (deepcopy(record) for record in records.values()
                 if role['actorGroup'] == 'ADM' or record['createdByPartyId'] == actor['partyId']),
                key=lambda record: (record['createdAt'], record['id']), reverse=True)
            return dict(projectId=project_id, items=rows, count=len(rows))

    @app.post('/projects/{project_id}/field-records')
    async def create_field_record(project_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {'recordType', 'title', 'recordDate', 'locationId', 'description', 'evidenceIds'},
                'INVALID_REQUEST', 'Unexpected or missing field record fields')
        require(isinstance(body['recordType'], str) and body['recordType'] in RECORD_TYPES,
                'INVALID_REQUEST', 'Unknown field record category')
        title = _text(body['title'], 'Title', 200)
        description = _text(body['description'], 'Description', 4000)
        record_date = _date(body['recordDate'])
        require(isinstance(body['locationId'], str), 'INVALID_REQUEST', 'Location must be selected')
        location_id = body['locationId']
        require(isinstance(body['evidenceIds'], list) and len(body['evidenceIds']) <= 20
                and all(isinstance(i, str) for i in body['evidenceIds'])
                and len(set(body['evidenceIds'])) == len(body['evidenceIds']),
                'INVALID_REQUEST', 'Evidence IDs must be a unique list (maximum 20)')
        for identifier in body['evidenceIds']:
            try:
                UUID(identifier)
            except (TypeError, ValueError):
                require(False, 'INVALID_REQUEST', 'Invalid evidence ID')
        if location_id:
            try:
                UUID(location_id)
            except (TypeError, ValueError):
                require(False, 'INVALID_REQUEST', 'Invalid location ID')
        actor = identity(request)
        key = key_for(request)
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role['actorGroup'] in AUTHOR_ROLES, 'NOT_AUTHORIZED',
                    'Only construction, supervision or project administration may draft field records')
            if location_id:
                location = store.engine.get('Location', location_id)
                require(location['projectId'] == project_id, 'PROJECT_MISMATCH', 'Location is in another project')
                require(role['actorGroup'] == 'ADM' or '*' in role.get('locationIds', [])
                        or location_id in role.get('locationIds', []),
                        'SCOPE_MISMATCH', 'Location outside assignment')
            for evidence_id in body['evidenceIds']:
                record = store.engine.get('Evidence', evidence_id)
                require(record['projectId'] == project_id, 'PROJECT_MISMATCH', 'Evidence is in another project')
                if location_id:
                    require(record.get('locationId') == location_id, 'SCOPE_MISMATCH',
                            'Evidence must belong to the selected field location')
                store.engine.authorize_read(record, actor['partyId'], role['id'])
            op = 'field_record:create'
            replay = store.engine._replay(project_id, actor['partyId'], op, key, body)
            if replay is not None:
                return replay
            now = store.engine.at()
            record = dict(
                id=uid(), version=1, projectId=project_id, status='draft',
                recordType=body['recordType'], title=title, description=description,
                recordDate=record_date, locationId=location_id or None,
                evidenceIds=list(body['evidenceIds']), createdAt=now, updatedAt=now,
                createdByPartyId=actor['partyId'],
                createdByName=store.engine.get('Party', actor['partyId'])['name'],
                createdByRole=role['actorGroup'])
            store.meta.setdefault('fieldRecordDrafts', {}).setdefault(project_id, {})[record['id']] = record
            store.meta.setdefault('fieldRecordAudit', {}).setdefault(project_id, []).append(dict(
                event='draft_created', at=now, recordId=record['id'], version=1,
                partyId=actor['partyId'], roleAssignmentId=role['id']))
            result = dict(record=deepcopy(record))
            store.engine._remember(project_id, actor['partyId'], op, key, body, result)
            return result
