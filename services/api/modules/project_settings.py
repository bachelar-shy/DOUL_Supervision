"""Administrative project foundation commands; workflow/qualification gates stay unchanged."""
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Request

from app.reference.engine import uid
from app.reference.validation import ContractError, require, validate

PROFILES = {
    'ADM': ('project_admin', '관리자'),
    'SUP': ('chief_supervisor', '감리자'),
    'OWN': ('owner_decision_maker', '발주처'),
    'CON': ('contractor_technical_lead', '시공사'),
}
DISCIPLINES = {'architecture': '건축', 'structure': '구조', 'civil': '토목',
               'mechanical': '기계', 'electrical': '전기', 'landscape': '조경'}
COMMANDS = {'update_project', 'add_organization', 'add_participant', 'update_assignment',
            'add_work_package', 'add_location', 'set_work_scope'}


def _text(value, maximum=200):
    require(isinstance(value, str) and 0 < len(value.strip()) <= maximum,
            'INVALID_REQUEST', '필수 항목을 입력하고 허용 길이를 확인하십시오.')
    return value.strip()


def _id(value):
    require(isinstance(value, str), 'INVALID_REQUEST', '현재 프로젝트의 등록 항목을 선택하십시오.')
    try:
        UUID(value)
    except (ValueError, TypeError):
        raise ContractError('INVALID_REQUEST', '등록 항목을 확인하십시오.')
    return value


def _fields(body, fields):
    require(set(body) == set(fields), 'INVALID_REQUEST', '필수 입력을 확인하십시오. 허용되지 않은 항목은 저장할 수 없습니다.')


def _dates(start, end, timezone):
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
        require(first <= last, 'INVALID_REQUEST', '배정 종료일은 시작일 이후여야 합니다.')
        zone = ZoneInfo(timezone)
        return (datetime.combine(first, time.min, zone).isoformat(),
                datetime.combine(last + timedelta(days=1), time.min, zone).isoformat())
    except (TypeError, ValueError, OverflowError, ZoneInfoNotFoundError):
        raise ContractError('INVALID_REQUEST', '배정 기간과 현장 시간대를 확인하십시오.')


def install_project_settings_routes(app, store, *, identity, role_for, key_for, body_json):
    def authorize(project_id, actor, request):
        role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
        require(role['actorGroup'] == 'ADM' and role['id'] == actor['roleAssignmentId'],
                'NOT_AUTHORIZED', 'Project settings require this session to be assigned as administrator')
        project = store.engine.get('Project', project_id)
        # Project-wide settings require explicit project-wide administration scope.
        store.engine.authorize(project, 'manage_project_roles', actor['partyId'], role['id'])
        return project, role

    def administration(project_id):
        return store.meta.get('projectAdministration', {}).get(project_id, {})

    def records(kind, project_id):
        return [deepcopy(r) for (k, _), r in store.engine._records.items()
                if k == kind and r['projectId'] == project_id]

    def snapshot(project_id, actor, role):
        project = store.engine.get('Project', project_id)
        data = administration(project_id)
        assignments = records('RoleAssignment', project_id)
        groups = dict(data.get('organizationGroups', {}))
        for assignment in assignments:
            if assignment['actorGroup'] in PROFILES:
                groups.setdefault(assignment['organizationId'], assignment['actorGroup'])
        zone = ZoneInfo(project['timezone'])
        for assignment in assignments:
            assignment['startDate'] = datetime.fromisoformat(assignment['validFrom'].replace('Z', '+00:00')).astimezone(zone).date().isoformat()
            end = datetime.fromisoformat(assignment['validTo'].replace('Z', '+00:00')).astimezone(zone)
            assignment['endDate'] = (end - timedelta(microseconds=1)).date().isoformat()
        context = store.meta.get('projectContexts', {}).get(project_id, {})
        scope = context.get('scope', store.meta.get('scope') if store.meta.get('projectId') == project_id else None)
        packages = list(deepcopy(data.get('workPackages', [])))
        known = {p['id'] for p in packages}
        for assignment in assignments:
            for package in assignment['packageIds']:
                if package != '*' and package not in known:
                    packages.append(dict(id=package, name='기존 공사범위 ' + str(len(packages) + 1))); known.add(package)
        return dict(project=project, availableCommands=sorted(COMMANDS),
                    canCreateProject=bool(actor.get('identityKey')) and role['actorGroup'] == 'ADM'
                        and not store.meta.get('identityBindings', {}).get(actor['identityKey'], {}).get('syntheticRoleShortcut'),
                    organizations=[dict(r, actorGroup=groups.get(r['id'])) for r in records('Party', project_id) if r['kind'] == 'ORGANIZATION'],
                    participants=[r for r in records('Party', project_id) if r['kind'] == 'PERSON'],
                    assignments=[r for r in assignments if r['actorGroup'] in PROFILES],
                    locations=records('Location', project_id), workPackages=packages,
                    disciplines=[dict(id=k, name=v) for k, v in DISCIPLINES.items()],
                    roleProfiles=[dict(actorGroup=g, roleCode=code, name=name) for g, (code, name) in PROFILES.items()],
                    scope=deepcopy(scope), currentRoleId=role['id'],
                    history=[deepcopy(e) for e in store.engine.audit_events if e['projectId'] == project_id and e['command'].startswith('project_settings:')][-50:])

    @app.get('/projects/{project_id}/settings')
    def get_settings(project_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            _, role = authorize(project_id, actor, request)
            return snapshot(project_id, actor, role)

    def save(kind, record, before, command, actor, role, key, body):
        validate(record, store.engine.schemas[kind], store.engine.schemas)
        store.engine._save(kind, record)
        store.engine._event(record, 'project_settings:' + command, actor['partyId'], role['id'], key, body, before)

    def new_record(project_id, actor, **values):
        return dict(id=uid(), projectId=project_id, version=1, createdAt=store.engine.at(),
                    updatedAt=store.engine.at(), createdBy=actor['partyId'], **values)

    @app.post('/projects/{project_id}/settings/projects')
    async def create_project(project_id: str, request: Request):
        actor = identity(request)
        body = await body_json(request)
        key = key_for(request)
        _fields(body, ['name', 'country', 'timezone', 'classification', 'organizationName'])
        require(isinstance(body['country'], str) and body['country'] in {'VN', 'KR'}, 'INVALID_REQUEST', '현장 국가를 확인하십시오.')
        name, organization_name, timezone = _text(body['name']), _text(body['organizationName']), _text(body['timezone'], 80)
        try: ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError): raise ContractError('INVALID_REQUEST', '현장 시간대를 확인하십시오.')
        require(isinstance(body['classification'], str) and len(body['classification']) <= 200, 'INVALID_REQUEST', '공사 종류를 확인하십시오.')
        with store.transaction(write=True):
            _, role = authorize(project_id, actor, request)
            require(role['actorGroup'] == 'ADM' and actor.get('identityKey'), 'NOT_AUTHORIZED', '승인된 관리자 로그인으로 프로젝트를 추가하십시오.')
            binding = store.meta.get('identityBindings', {}).get(actor['identityKey'], {})
            require(binding.get('active') is True, 'UNAUTHENTICATED', '관리자 로그인 배정을 확인하십시오.')
            require(not binding.get('syntheticRoleShortcut'), 'NOT_AUTHORIZED',
                    '시험 역할 계정으로 실제 프로젝트를 추가할 수 없습니다.')
            operation = 'project_settings:create_project'
            cached = store.engine._replay(project_id, actor['partyId'], operation, key, body)
            if cached is not None: return cached
            # Build a blank project, never copy synthetic records or memberships.
            new_id = uid()
            project = new_record(new_id, actor, name=name, country=body['country'], timezone=timezone,
                                 classification=body['classification'].strip(),
                                 qualificationRules=[dict(discipline=d, minimumRank=1) for d in DISCIPLINES])
            project['id'] = new_id
            organization = new_record(new_id, actor, kind='ORGANIZATION', name=organization_name, loginEnabled=False)
            existing_person = store.engine.get('Party', actor['partyId'])
            person = new_record(new_id, actor, kind='PERSON', name=existing_person['name'],
                                organizationId=organization['id'], loginEnabled=True)
            assignment = new_record(new_id, actor, partyId=person['id'], organizationId=organization['id'],
                actorGroup='ADM', roleCode='project_admin', authorityCodes=[code for code in ('manage_project_roles', 'render_document') if code in role['authorityCodes']],
                disciplines=['*'], packageIds=['*'], locationIds=['*'], qualificationIds=[],
                validFrom=role['validFrom'], validTo=role['validTo'], active=True, approvedBy=actor['partyId'])
            project['organizationIds'] = [organization['id']]
            for kind, record in [('Project', project), ('Party', organization), ('Party', person), ('RoleAssignment', assignment)]:
                save(kind, record, None, 'create_project', actor, role, key, body)
            store.meta.setdefault('projectAdministration', {})[new_id] = dict(organizationGroups={organization['id']: 'ADM'}, workPackages=[])
            store.meta.setdefault('projectContexts', {})[new_id] = dict(projectId=new_id)
            memberships = binding.setdefault('projectAssignments', {})
            memberships[new_id] = dict(partyId=person['id'], defaultRoleAssignmentId=assignment['id'])
            result = dict(project=deepcopy(project), setupRequired=True)
            store.engine._remember(project_id, actor['partyId'], operation, key, body, result)
            return result

    def scoped_values(body, project_id, group):
        data = administration(project_id)
        packages = {p['id'] for p in data.get('workPackages', [])}
        for assignment in records('RoleAssignment', project_id):
            packages.update(x for x in assignment['packageIds'] if x != '*')
        locations = {r['id'] for r in records('Location', project_id)}
        allowed = {'disciplines': set(DISCIPLINES), 'packageIds': packages, 'locationIds': locations}
        result = {}
        for field, choices in allowed.items():
            value = body[field]
            require(isinstance(value, list) and all(isinstance(x, str) for x in value)
                    and len(value) == len(set(value)) and len(value) <= 1000,
                    'INVALID_REQUEST', '담당하는 공종·공사범위·구역을 확인하십시오.')
            require(set(value) <= choices or (group == 'ADM' and value == ['*']),
                    'SCOPE_MISMATCH', '현재 프로젝트에 등록된 담당 범위만 배정할 수 있습니다.')
            result[field] = deepcopy(value)
        return result

    @app.post('/projects/{project_id}/settings/commands/{command}')
    async def settings_command(project_id: str, command: str, request: Request):
        actor = identity(request)
        body = await body_json(request)
        require(command in COMMANDS, 'NOT_FOUND', '프로젝트 설정 업무를 찾을 수 없습니다.')
        key = key_for(request)
        with store.transaction(write=True):
            project, role = authorize(project_id, actor, request)
            operation = 'project_settings:' + command
            cached = store.engine._replay(project_id, actor['partyId'], operation, key, body)
            if cached is not None:
                return cached
            require(type(body.get('expectedVersion')) is int and body['expectedVersion'] == project['version'],
                    'REFERENCE_STALE', '다른 관리자가 설정을 변경했습니다. 새로 불러온 뒤 저장하십시오.')
            proposed = deepcopy(project)
            data = store.meta.setdefault('projectAdministration', {}).setdefault(project_id, {})
            if command == 'update_project':
                _fields(body, ['expectedVersion', 'name', 'country', 'timezone', 'classification'])
                require(isinstance(body['country'], str) and body['country'] in {'VN', 'KR'}, 'INVALID_REQUEST', '현장 국가를 확인하십시오.')
                timezone = _text(body['timezone'], 80)
                try: ZoneInfo(timezone)
                except (ZoneInfoNotFoundError, ValueError): raise ContractError('INVALID_REQUEST', '현장 시간대를 확인하십시오.')
                require(isinstance(body['classification'], str) and len(body['classification']) <= 200, 'INVALID_REQUEST', '공사 종류를 확인하십시오.')
                proposed.update(name=_text(body['name']), country=body['country'], timezone=timezone, classification=body['classification'].strip())
            elif command == 'add_organization':
                _fields(body, ['expectedVersion', 'name', 'actorGroup'])
                require(isinstance(body['actorGroup'], str) and body['actorGroup'] in PROFILES, 'INVALID_REQUEST', '참여회사 구분을 확인하십시오.')
                company = new_record(project_id, actor, name=_text(body['name']), kind='ORGANIZATION', loginEnabled=False)
                save('Party', company, None, command, actor, role, key, body)
                data.setdefault('organizationGroups', {})[company['id']] = body['actorGroup']
            elif command == 'add_work_package':
                _fields(body, ['expectedVersion', 'name'])
                data.setdefault('workPackages', []).append(dict(id=uid(), name=_text(body['name'])))
            elif command == 'add_location':
                _fields(body, ['expectedVersion', 'name'])
                location = new_record(project_id, actor, name=_text(body['name']), semanticAnchor='project/' + project_id + '/' + uid())
                save('Location', location, None, command, actor, role, key, body)
            elif command == 'set_work_scope':
                _fields(body, ['expectedVersion', 'discipline', 'packageId', 'locationId', 'responsibleOrganizationId', 'minimumQualificationRank'])
                choices = scoped_values(dict(disciplines=[body['discipline']], packageIds=[body['packageId']], locationIds=[body['locationId']]), project_id, 'SUP')
                require(all(choices.values()), 'INVALID_REQUEST', '현장의 기본 담당 범위를 모두 선택하십시오.')
                contractor = store.engine.get('Party', _id(body['responsibleOrganizationId']))
                groups = {r['organizationId']: r['actorGroup'] for r in records('RoleAssignment', project_id)}
                groups.update(data.get('organizationGroups', {}))
                require(contractor['projectId'] == project_id and contractor['kind'] == 'ORGANIZATION' and groups.get(contractor['id']) == 'CON',
                        'ORGANIZATION_MISMATCH', '현재 프로젝트의 시공사를 선택하십시오.')
                rank = body['minimumQualificationRank']
                maximum = min([r['minimumRank'] for r in project.get('qualificationRules', []) if r['discipline'] in {body['discipline'], '*'}] or [3])
                require(type(rank) is int and 1 <= rank <= maximum, 'INVALID_REQUEST', '기존 자격 기준보다 낮은 기준으로 변경할 수 없습니다.')
                rules = deepcopy(project.get('qualificationRules', []))
                rules = [r for r in rules if r['discipline'] != body['discipline']]
                rules.append(dict(discipline=body['discipline'], minimumRank=rank)); proposed['qualificationRules'] = rules
                scope = {k: deepcopy(body[k]) for k in body if k != 'expectedVersion'}
                store.meta.setdefault('projectContexts', {}).setdefault(project_id, {})['scope'] = scope
                if store.meta.get('projectId') == project_id: store.meta['scope'] = deepcopy(scope)
            elif command == 'add_participant':
                _fields(body, ['expectedVersion', 'name', 'organizationId', 'actorGroup', 'startDate', 'endDate', 'disciplines', 'packageIds', 'locationIds'])
                group = body['actorGroup']
                require(isinstance(group, str) and group in PROFILES, 'INVALID_REQUEST', '담당 업무를 확인하십시오.')
                organization = store.engine.get('Party', _id(body['organizationId']))
                groups = {r['organizationId']: r['actorGroup'] for r in records('RoleAssignment', project_id)}
                groups.update(data.get('organizationGroups', {}))
                require(organization['projectId'] == project_id and organization['kind'] == 'ORGANIZATION' and groups.get(organization['id']) == group,
                        'ORGANIZATION_MISMATCH', '소속 회사와 담당 업무가 일치해야 합니다.')
                scopes = scoped_values(body, project_id, group)
                start, end = _dates(body['startDate'], body['endDate'], project['timezone'])
                person = new_record(project_id, actor, name=_text(body['name']), kind='PERSON', organizationId=organization['id'], loginEnabled=True)
                code = PROFILES[group][0]
                duties = [code_ for code_, p in store.engine.policies.items() if group in p['actor_groups'] and (not p['role_codes'] or code in p['role_codes'])]
                assignment = new_record(project_id, actor, partyId=person['id'], organizationId=organization['id'], actorGroup=group, roleCode=code,
                                        authorityCodes=duties, qualificationIds=[], validFrom=start, validTo=end, active=True, approvedBy=actor['partyId'], **scopes)
                save('Party', person, None, command, actor, role, key, body)
                save('RoleAssignment', assignment, None, command, actor, role, key, body)
            elif command == 'update_assignment':
                _fields(body, ['expectedVersion', 'roleId', 'expectedRoleVersion', 'active', 'startDate', 'endDate', 'disciplines', 'packageIds', 'locationIds'])
                current = store.engine.get('RoleAssignment', _id(body['roleId']))
                require(current['projectId'] == project_id, 'PROJECT_MISMATCH', '다른 프로젝트의 배정은 변경할 수 없습니다.')
                require(type(body['expectedRoleVersion']) is int and current['version'] == body['expectedRoleVersion'], 'REFERENCE_STALE', '담당자 배정이 변경되었습니다.')
                require(current['id'] != role['id'], 'NOT_AUTHORIZED', '접속 중인 본인의 관리자 배정은 변경할 수 없습니다.')
                require(type(body['active']) is bool, 'INVALID_REQUEST', '배정 상태를 확인하십시오.')
                scopes = scoped_values(body, project_id, current['actorGroup'])
                start, end = _dates(body['startDate'], body['endDate'], project['timezone'])
                updated = dict(current, version=current['version'] + 1, updatedAt=store.engine.at(), active=body['active'], validFrom=start, validTo=end, **scopes)
                save('RoleAssignment', updated, current, command, actor, role, key, body)
            proposed['version'] += 1
            proposed['updatedAt'] = store.engine.at()
            save('Project', proposed, project, command, actor, role, key, body)
            result = snapshot(project_id, actor, role)
            store.engine._remember(project_id, actor['partyId'], operation, key, body, result)
            return result
