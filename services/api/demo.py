"""Synthetic development data and compatibility helpers. Never real site records."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from app.reference.engine import uid

HUMANS = {'SUP': 'chief_supervisor', 'CON': 'contractor_technical_lead',
          'OWN': 'owner_decision_maker', 'DES': 'designer', 'ADM': 'project_admin'}
SERVICE_ACTOR_NAMES = {
    'SYSTEM': '미디어 처리 시스템 · 예시',
    'AI': '분석 후보 생성기 · 예시',
}
ANALYSIS_PROFILE = dict(
    model=dict(provider='development-fixture', name='normalized-worker-contract', version='v1'),
    promptVersion='media-prompt-v1',
    policyVersion='1.1',
)


def ensure_media_demo_support(engine, meta):
    """Backfill media-only demo support into snapshots created before that feature."""
    changed = False
    if 'analysisProfile' not in meta:
        meta['analysisProfile'] = deepcopy(ANALYSIS_PROFILE)
        changed = True

    service_actors = dict(meta.get('serviceActors') or {})
    project = meta['projectId']
    scope = meta['scope']
    admin = meta['actors']['ADM']
    admin_role = engine.get('RoleAssignment', admin['roleAssignmentId'])

    for group, name in SERVICE_ACTOR_NAMES.items():
        current = service_actors.get(group)
        if current:
            party_key = ('Party', current.get('partyId'))
            role_key = ('RoleAssignment', current.get('roleAssignmentId'))
            if party_key in engine._records and role_key in engine._records:
                continue

        existing_role = next((
            record for (kind, _), record in engine._records.items()
            if kind == 'RoleAssignment'
            and record.get('projectId') == project
            and record.get('actorGroup') == group
            and record.get('roleCode') == 'service_worker'
            and ('Party', record.get('partyId')) in engine._records
        ), None)
        if existing_role:
            party = engine.get('Party', existing_role['partyId'])
            service_actors[group] = dict(
                partyId=party['id'],
                roleAssignmentId=existing_role['id'],
                name=party['name'],
                actorGroup=group,
            )
            changed = True
            continue

        party, role, organization = uid(), uid(), uid()
        engine.bootstrap('Party', dict(
            id=party,
            projectId=project,
            kind='ORGANIZATION',
            name=name,
            loginEnabled=False,
            organizationId=organization,
        ))
        engine.bootstrap('RoleAssignment', dict(
            id=role,
            projectId=project,
            partyId=party,
            organizationId=organization,
            actorGroup=group,
            roleCode='service_worker',
            authorityCodes=[code for code, policy in engine.policies.items() if group in policy['actor_groups']],
            disciplines=[scope['discipline']],
            packageIds=[scope['packageId']],
            locationIds=[scope['locationId']],
            qualificationIds=[],
            validFrom=admin_role['validFrom'],
            validTo=admin_role['validTo'],
            active=True,
            approvedBy=admin['partyId'],
        ))
        service_actors[group] = dict(
            partyId=party,
            roleAssignmentId=role,
            name=name,
            actorGroup=group,
        )
        changed = True

    if meta.get('serviceActors') != service_actors:
        meta['serviceActors'] = service_actors
        changed = True
    return changed


def seed(engine):
    now = datetime.now(timezone.utc)
    stamp = lambda dt: dt.isoformat().replace('+00:00', 'Z')
    start, end, due = stamp(now - timedelta(days=30)), stamp(now + timedelta(days=365)), stamp(now + timedelta(days=2))
    project, package, location, contractor = uid(), uid(), uid(), uid()
    engine.bootstrap('Project', dict(id=project, projectId=project, name='DOUL 시범현장 · 예시 데이터', country='VN', timezone='Asia/Ho_Chi_Minh', qualificationRules=[dict(discipline='architecture', minimumRank=3)]))
    engine.bootstrap('Location', dict(id=location, projectId=project, name='A동 2층 / C-5', semanticAnchor='demo/A/2F/C-5'))
    scope = dict(packageId=package, locationId=location, discipline='architecture', responsibleOrganizationId=contractor, minimumQualificationRank=3)
    actors = {}
    names = {'SUP': '김감리', 'CON': '시공사 담당자', 'OWN': '발주처 담당자', 'DES': '설계 담당자', 'ADM': '도울 관리자'}
    for group, role_code in HUMANS.items():
        party, role, qualification = uid(), uid(), uid()
        organization = contractor if group == 'CON' else uid()
        engine.bootstrap('Party', dict(id=party, projectId=project, kind='PERSON', name=names[group], loginEnabled=True, organizationId=organization))
        engine.bootstrap('Qualification', dict(id=qualification, projectId=project, partyId=party, number='DEMO-NOT-A-CERTIFICATE', rank=1, disciplines=['architecture'], validFrom=start, validTo=end, verified=True, revoked=False))
        engine.bootstrap('RoleAssignment', dict(id=role, projectId=project, partyId=party, organizationId=organization, actorGroup=group, roleCode=role_code, authorityCodes=[k for k, p in engine.policies.items() if group in p['actor_groups']], disciplines=['architecture'], packageIds=[package], locationIds=[location], qualificationIds=[qualification], validFrom=start, validTo=end, active=True, approvedBy=party))
        actors[group] = dict(partyId=party, roleAssignmentId=role, name=names[group], actorGroup=group)
    # Non-human service actors are explicit, scoped and never available to /dev/sessions.
    service_actors = {}
    for group, name in SERVICE_ACTOR_NAMES.items():
        party, role, organization = uid(), uid(), uid()
        engine.bootstrap('Party', dict(id=party, projectId=project, kind='ORGANIZATION', name=name, loginEnabled=False, organizationId=organization))
        engine.bootstrap('RoleAssignment', dict(
            id=role,
            projectId=project,
            partyId=party,
            organizationId=organization,
            actorGroup=group,
            roleCode='service_worker',
            authorityCodes=[k for k, p in engine.policies.items() if group in p['actor_groups']],
            disciplines=['architecture'],
            packageIds=[package],
            locationIds=[location],
            qualificationIds=[],
            validFrom=start,
            validTo=end,
            active=True,
            approvedBy=actors['ADM']['partyId'],
        ))
        service_actors[group] = dict(partyId=party, roleAssignmentId=role, name=name, actorGroup=group)
    # Source organizations survive exclusion from login/user groups.
    for kind in ['TEST_LAB', 'EXTERNAL_REVIEWER']:
        engine.bootstrap('Party', dict(id=uid(), projectId=project, kind=kind, name='예시 자료 발행기관', loginEnabled=False))
    requirement, drawing, evidence, file_id = uid(), uid(), uid(), uid()
    engine.bootstrap('Requirement', dict(id=requirement, projectId=project, kind='contract', title='예시 벽체 치수 확인', effectiveFrom=start, status='active', requiredFields=['dimension'], **scope))
    engine.bootstrap('InformationItem', dict(id=drawing, projectId=project, subtype='Drawing', title='도면 예시 A-201', revision='03', status='approved', **scope))
    # Measurement text deliberately labelled as synthetic, not a real photo.
    content = '예시 측정기록: 벽체 기준 치수 120 mm. 실제 현장 증빙이 아닙니다.'.encode()
    engine.add_evidence(evidence, project, dict(sourceType='original', mediaType='measurement', fileId=file_id, fileHash=sha256(content).hexdigest(), sourcePartyId=actors['CON']['partyId'], metadata={'demo': True, 'mimeType': 'text/plain', 'name': '예시 측정기록'}, **scope), content, actors['CON']['partyId'], actors['CON']['roleAssignmentId'], uid())
    ref = lambda kind, oid: dict(objectType=kind, objectId=oid, version=engine.get(kind, oid)['version'])
    def create(machine, payload, group='SUP'):
        a = actors[group]
        return engine.create(machine, uid(), project, dict(scope, **payload), a['partyId'], a['roleAssignmentId'], uid())['record']
    def command(machine, record, cmd, payload=None, group='SUP'):
        a = actors[group]
        return engine.execute(machine, record['id'], cmd, record['version'], payload or {}, [evidence], a['partyId'], a['roleAssignmentId'], uid())['record']
    inspections = []
    for title, stop in [('경량벽체 은폐 전 검측', 'scheduled'), ('방수 바탕 자체검측', 'requested'), ('천장 내부 종합검측', 'passed')]:
        r = create('inspection', dict(workName=title, selfInspectionComplete=True, precheck={k:True for k in ['drawing','material','test','previous','change']}, holdPoint=True, nextWorkAllowed=False, requirementRefs=[ref('Requirement',requirement)], drawingRef=ref('InformationItem',drawing), evidenceIds=[evidence]), 'CON')
        r = command('inspection',r,'request',dict(requestedAt=engine.at(),requestedInspectionAt=due),'CON')
        if stop != 'requested':
            r=command('inspection',r,'receive',dict(receivedAt=engine.at()))
            r=command('inspection',r,'schedule',dict(scheduledAt=engine.at()))
        if stop == 'passed':
            r=command('inspection',r,'start')
            r=command('inspection',r,'submit_results',dict(checkResults=[dict(itemId='dimension',requirementRef=ref('Requirement',requirement),result='pass',evidenceIds=[evidence],measuredValue=120,unit='mm')]))
            r=command('inspection',r,'pass')
        inspections.append(r)
    obs=create('observation',dict(source='supervisor',description='벽체 설치 치수 확인 필요 · 예시',grounding=[dict(evidenceId=evidence,channel='measurement',claimSupport='observed')],evidenceIds=[evidence]))
    obs=command('observation',obs,'begin_review')
    confirmed=command('observation',obs,'confirm',dict(verificationNote='예시 측정기록 확인. 실제 검측 아님.'))
    issue=create('issue',dict(subtype='NCR',title='벽체 치수 시정 · 예시',observationIds=[confirmed['id']],actionIds=[],inspectionIds=[inspections[0]['id']],correctionCycle=0,evidenceIds=[evidence]))
    action=create('action',dict(title='시정조치 작성 · 예시',relatedIssueId=issue['id'],evidenceIds=[evidence]))
    action=command('action',action,'assign',dict(responsiblePartyId=actors['CON']['partyId'],responsibleOrganizationId=contractor,dueAt=due))
    action=command('action',action,'start',group='CON')
    issue=command('issue',issue,'assign',dict(responsiblePartyId=actors['CON']['partyId'],responsibleOrganizationId=contractor,dueAt=due,actionIds=[action['id']]))
    command('issue',issue,'start_correction',group='CON')
    create('observation',dict(source='supervisor',description='사진·측정 근거를 검토할 관찰 후보 · 예시',grounding=[dict(evidenceId=evidence,channel='measurement',claimSupport='observed')],evidenceIds=[evidence]))
    report=create('report',dict(title='발주처 즉시보고 · 예시',revision='1',report=dict(type='urgent',priority='P1',sourceDomainRefs=[ref('Issue',issue['id'])],recipients=[actors['OWN']['partyId']],facts='벽체 위치 재확인 요청',cause='현장 확인 필요',impact={'quality':'미확정','schedule':'검토 필요','cost':'미확정'},recommendation='측정 후 대안 결정',dueAt=due,receiptDueAt=due,actionIds=[],decisionIds=[],informationOnly=False),evidenceIds=[evidence]))
    report=command('report',report,'submit');report=command('report',report,'issue')
    decision=create('decision',dict(title='벽체 시정 대안 결정 · 예시',targetRef=ref('Issue',issue['id']),reportId=report['id'],options=[{'id':'A','description':'재측정 후 국부 보수'},{'id':'B','description':'설계자 검토 후 재시공'}],impact={'quality':'확인 필요'},recommendation='A',actionIds=[],dueAt=due))
    command('decision',decision,'report')
    rfi=create('rfi',dict(title='벽체 기준 치수 질의 · 예시',data={}), 'CON')
    rfi=command('rfi',rfi,'submit',dict(question='A-201 치수 해석 확인',references=[ref('InformationItem',drawing)],dueAt=due),'CON')
    rfi=command('rfi',rfi,'receive');command('rfi',rfi,'refer',dict(responsiblePartyId=actors['DES']['partyId']))
    analysis_profile = deepcopy(ANALYSIS_PROFILE)
    return dict(
        projectId=project,
        actors=actors,
        serviceActors=service_actors,
        analysisProfile=analysis_profile,
        scope=scope,
        requirementRef=ref('Requirement',requirement),
        drawingRef=ref('InformationItem',drawing),
        evidenceId=evidence,
        blobs={file_id:content},
    )
