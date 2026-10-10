"""Application-level read models for supervision workflows.

These projections only follow explicit domain references. They never infer a
relationship from a shared location, package, discipline, title, or timestamp.
That keeps the UI/application boundary useful without creating new authority or
workflow rules outside the domain engine.
"""
from copy import deepcopy
from hashlib import sha256

from app.reference.engine import uid
from app.reference.validation import require


def closeout_reporting_complete(reports):
    """Every non-cancelled closeout revision must close; labels replace nothing."""
    active = [report for report in reports if report.get('status') != 'cancelled']
    return bool(active) and all(report.get('status') == 'closed' for report in active)


def _record(engine, kind, object_id, project_id):
    record = engine.get(kind, object_id)
    require(
        record['projectId'] == project_id,
        'PROJECT_MISMATCH',
        'Linked workflow record belongs to another project',
    )
    return record


def _case_root(engine, inspection):
    """Resolve a stable root for both original inspections and reinspections."""
    issue_id = inspection.get('relatedIssueId')
    if not issue_id:
        return inspection
    issue = _record(engine, 'Issue', issue_id, inspection['projectId'])
    require(
        inspection['id'] in issue.get('inspectionIds', []),
        'CASE_LINK_INVALID',
        'Reinspection is not preserved on its related issue',
    )
    require(
        bool(issue.get('inspectionIds')),
        'CASE_LINK_INVALID',
        'Issue has no preserved inspection chain',
    )
    return _record(engine, 'Inspection', issue['inspectionIds'][0], inspection['projectId'])


def build_inspection_case(engine, inspection_id):
    """Return the explicit graph rooted at one inspection case.

    The caller may pass the original inspection or any later reinspection.
    caseId remains the original inspection ID. One original inspection may
    legitimately lead to more than one issue, so issues is an array.
    """
    requested = engine.get('Inspection', inspection_id)
    project_id = requested['projectId']
    root = _case_root(engine, requested)

    linked_issues = []
    for (kind, _), candidate in engine._records.items():
        if kind != 'Issue' or candidate['projectId'] != project_id:
            continue
        if root['id'] not in candidate.get('inspectionIds', []):
            continue

        observations = [
            _record(engine, 'Observation', oid, project_id)
            for oid in candidate.get('observationIds', [])
        ]
        corrective_actions = [
            _record(engine, 'Action', aid, project_id)
            for aid in candidate.get('actionIds', [])
        ]
        inspections = [
            _record(engine, 'Inspection', iid, project_id)
            for iid in candidate.get('inspectionIds', [])
        ]

        require(
            inspections and inspections[0]['id'] == root['id'],
            'CASE_LINK_INVALID',
            'Issue inspection chain must start with the case root inspection',
        )
        for action in corrective_actions:
            require(
                action.get('relatedIssueId') == candidate['id'],
                'CASE_LINK_INVALID',
                'Corrective action is not explicitly linked to the issue',
            )
        for index, inspection in enumerate(inspections):
            if index == 0:
                continue
            require(
                inspection.get('relatedIssueId') == candidate['id'],
                'CASE_LINK_INVALID',
                'Reinspection is not explicitly linked to the issue',
            )

        issue_object_ids={
            candidate['id'],
            *(record['id'] for record in observations),
            *(record['id'] for record in corrective_actions),
            *(record['id'] for record in inspections),
        }
        owner_reports=_explicit_owner_reports(engine,project_id,issue_object_ids)
        closeout_reports=[
            report for report in owner_reports
            if _is_closeout_report(engine,candidate,report)
        ]
        readiness=_issue_readiness(engine,candidate)
        readiness.update(
            closeoutReportIds=[report['id'] for report in closeout_reports],
            ownerReportDraftReady=(
                candidate.get('status')=='closed' and not closeout_reports
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
            ownerReportingComplete=closeout_reporting_complete(closeout_reports),
        )
        linked_issues.append(
            dict(
                issue=deepcopy(candidate),
                observations=deepcopy(observations),
                correctiveActions=deepcopy(corrective_actions),
                inspections=deepcopy(inspections),
                ownerReports=deepcopy(owner_reports),
                readiness=readiness,
                currentCorrectionCycle=candidate.get('correctionCycle', 0),
            )
        )

    linked_issues.sort(key=lambda x: (x['issue'].get('createdAt', ''), x['issue']['id']))
    linked_ids = {root['id'], requested['id']}
    for group in linked_issues:
        linked_ids.add(group['issue']['id'])
        for key in ('observations', 'correctiveActions', 'inspections', 'ownerReports'):
            linked_ids.update(record['id'] for record in group[key])

    owner_reports=_explicit_owner_reports(engine,project_id,linked_ids)
    linked_ids.update(report['id'] for report in owner_reports)
    timeline = [
        deepcopy(event)
        for event in engine.audit_events
        if event['projectId'] == project_id and event['objectRef']['objectId'] in linked_ids
    ]
    open_issues=[group['issue']['id'] for group in linked_issues if group['issue'].get('status')!='closed']
    reporting_pending=[
        group['issue']['id'] for group in linked_issues
        if group['issue'].get('status')=='closed' and not group['readiness']['ownerReportingComplete']
    ]

    return dict(
        caseId=root['id'],
        requestedInspectionId=requested['id'],
        projectId=project_id,
        rootInspection=deepcopy(root),
        issues=linked_issues,
        ownerReports=deepcopy(owner_reports),
        readiness=dict(
            openIssueIds=open_issues,
            ownerReportingPendingIssueIds=reporting_pending,
            complete=bool(linked_issues) and not open_issues and not reporting_pending,
        ),
        timeline=timeline,
    )


def _baseline(record):
    fields = (
        'packageId',
        'locationId',
        'discipline',
        'responsibleOrganizationId',
        'minimumQualificationRank',
        'requirementRefs',
        'drawingRef',
        'upstreamInspectionIds',
    )
    return {field: deepcopy(record[field]) for field in fields if field in record}


def _responsible_party(engine, party_id, project_id, organization_id):
    party = _record(engine, 'Party', party_id, project_id)
    require(party.get('kind') == 'PERSON', 'RESPONSIBLE_PARTY_INVALID', 'Responsible party must be a person')
    require(
        party.get('organizationId') == organization_id,
        'RESPONSIBLE_PARTY_INVALID',
        'Responsible party must belong to the issue contractor organization',
    )
    return party


def _owner_recipient(engine, party_id, project_id):
    party=_record(engine,'Party',party_id,project_id)
    assignments=[
        record for (kind,_),record in engine._records.items()
        if kind=='RoleAssignment'
        and record.get('projectId')==project_id
        and record.get('partyId')==party_id
        and record.get('actorGroup')=='OWN'
        and record.get('active') is True
    ]
    require(bool(assignments),'OWNER_RECIPIENT_INVALID','Report recipient must have an active owner assignment')
    return party


def _domain_ref(kind, record):
    return dict(objectType=kind, objectId=record['id'], version=record['version'])


def _explicit_owner_reports(engine, project_id, object_ids):
    """Find reports only through preserved sourceDomainRefs, never shared scope."""
    reports=[]
    for (kind,_),record in engine._records.items():
        if kind!='InformationItem' or record.get('subtype')!='Report' or record['projectId']!=project_id:
            continue
        references=record.get('report',{}).get('sourceDomainRefs',[])
        matched=[reference for reference in references if reference.get('objectId') in object_ids]
        if not matched:
            continue
        for reference in matched:
            engine.resolve(reference,project_id)
        reports.append(deepcopy(record))
    reports.sort(key=lambda record:(record.get('createdAt',''),record['id']))
    return reports


def _is_closeout_report(engine, issue, report):
    for reference in report.get('report',{}).get('sourceDomainRefs',[]):
        if reference.get('objectType')!='Issue' or reference.get('objectId')!=issue['id']:
            continue
        source=engine.resolve(reference,issue['projectId'])
        if source.get('status')=='closed':
            return True
    return False


def _issue_readiness(engine, issue):
    """Explain case progress without executing or bypassing independent decisions."""
    current_cycle=issue.get('correctionCycle',0)
    actions=[
        _record(engine,'Action',action_id,issue['projectId'])
        for action_id in issue.get('actionIds',[])
    ]
    current_actions=[action for action in actions if action.get('correctionCycle',0)==current_cycle]
    inspection_ids=issue.get('inspectionIds',[])
    root_id=inspection_ids[0] if inspection_ids else None
    reinspections=[
        _record(engine,'Inspection',inspection_id,issue['projectId'])
        for inspection_id in inspection_ids
        if inspection_id!=root_id
    ]
    current_reinspections=[
        inspection for inspection in reinspections
        if inspection.get('relatedIssueId')==issue['id'] and inspection.get('correctionCycle')==current_cycle
    ]
    latest_reinspection=current_reinspections[-1] if current_reinspections else None
    correction_submitted=bool(current_actions) and all(
        action.get('status') in ['submitted','verified','closed'] for action in current_actions
    )
    correction_verified=bool(current_actions) and all(
        action.get('status') in ['verified','closed'] for action in current_actions
    )
    reinspection_passed=bool(latest_reinspection) and (
        latest_reinspection.get('resultStatus')=='pass'
        and latest_reinspection.get('status')=='completed'
        and latest_reinspection.get('nextWorkAllowed') is True
    )
    action_evidence_ids=sorted({
        evidence_id
        for action in current_actions if action.get('status') in ['verified','closed']
        for evidence_id in action.get('evidenceIds',[])
    })
    reinspection_evidence_ids=[]
    if latest_reinspection:
        reinspection_evidence_ids=list(latest_reinspection.get('evidenceIds',[]))
        for result in latest_reinspection.get('checkResults',[]):
            reinspection_evidence_ids.extend(result.get('evidenceIds',[]))
        reinspection_evidence_ids=sorted(set(reinspection_evidence_ids))
    closure_evidence_candidate_ids=sorted(set(action_evidence_ids)|set(reinspection_evidence_ids))
    close_blocked=[]
    if issue.get('status')!='reinspection':close_blocked.append('ISSUE_NOT_IN_REINSPECTION')
    if not correction_verified:close_blocked.append('CURRENT_ACTIONS_NOT_VERIFIED')
    if not reinspection_passed:close_blocked.append('REINSPECTION_NOT_PASSED')
    if not action_evidence_ids:close_blocked.append('CLOSURE_ACTION_EVIDENCE_REQUIRED')
    if not reinspection_evidence_ids:close_blocked.append('CLOSURE_REINSPECTION_EVIDENCE_REQUIRED')
    stage={
        'assigned':'corrective_action',
        'in_progress':'reinspection_request' if correction_submitted else 'corrective_action',
        'ready_for_recheck':'reinspection',
        'reinspection':'closure' if reinspection_passed else 'reinspection',
        'rework_required':'corrective_action',
        'closed':'owner_report',
    }.get(issue.get('status'),'terminal')
    return dict(
        stage=stage,
        correctionCycle=current_cycle,
        currentActionIds=[action['id'] for action in current_actions],
        correctionSubmitted=correction_submitted,
        correctionVerified=correction_verified,
        currentReinspectionId=latest_reinspection['id'] if latest_reinspection else None,
        reinspectionPassed=reinspection_passed,
        closureEvidenceCandidateIds=closure_evidence_candidate_ids,
        closeReady=not close_blocked,
        closeBlockedReasons=close_blocked,
        ownerReportDraftReady=issue.get('status')=='closed',
        ownerReportIssuePending=False,
        ownerReceiptPending=False,
        ownerReceiptConfirmed=False,
        ownerReportingComplete=False,
    )


def create_issue_package(
    engine,
    inspection_id,
    issue_id,
    action_id,
    observation_ids,
    subtype,
    title,
    action_title,
    responsible_party_id,
    due_at,
    party_id,
    role_id,
    key,
):
    """Create and assign an official issue plus its initial corrective action.

    This service is deliberately narrow: it starts only from an original
    inspection that has already been judged failed. Domain create/command rules
    still perform all authority, scope, qualification, evidence and version
    checks.
    """
    inspection = engine.get('Inspection', inspection_id)
    project_id = inspection['projectId']
    require(
        not inspection.get('relatedIssueId'),
        'CASE_ROOT_REQUIRED',
        'A new issue package must start from an original inspection',
    )
    require(
        inspection.get('resultStatus') == 'fail' and inspection.get('status') in ['failed', 'completed'],
        'INSPECTION_NOT_FAILED',
        'Official issue package requires a failed inspection result',
    )
    require(bool(observation_ids), 'OBSERVATION_REQUIRED', 'At least one confirmed observation is required')
    require(bool(title.strip()) and bool(action_title.strip()), 'INVALID_REQUEST', 'Issue and action titles are required')

    contractor_id = inspection.get('responsibleOrganizationId')
    require(bool(contractor_id), 'RESPONSIBLE_ORGANIZATION_REQUIRED', 'Inspection contractor organization is required')
    _responsible_party(engine, responsible_party_id, project_id, contractor_id)

    evidence_ids = list(inspection.get('evidenceIds', []))
    for observation_id in observation_ids:
        observation = _record(engine, 'Observation', observation_id, project_id)
        require(observation.get('status') == 'confirmed', 'OBSERVATION_UNVERIFIED', observation_id)
        for field in ('packageId', 'locationId', 'discipline', 'responsibleOrganizationId'):
            if observation.get(field) is not None and inspection.get(field) is not None:
                require(
                    observation[field] == inspection[field],
                    'OBSERVATION_SCOPE_MISMATCH',
                    'Observation scope must match the failed inspection',
                )
        evidence_ids.extend(observation.get('evidenceIds', []))
        evidence_ids.extend(g['evidenceId'] for g in observation.get('grounding', []))
        evidence_ids.extend(g['evidenceId'] for g in observation.get('verificationGrounding', []))
    evidence_ids = list(dict.fromkeys(evidence_ids))

    issue_payload = dict(
        **_baseline(inspection),
        subtype=subtype,
        title=title,
        observationIds=list(dict.fromkeys(observation_ids)),
        actionIds=[],
        inspectionIds=[inspection['id']],
        correctionCycle=0,
        evidenceIds=evidence_ids,
    )
    issue_result = engine.create(
        'issue',
        issue_id,
        project_id,
        issue_payload,
        party_id,
        role_id,
        key + ':issue:create',
    )
    issue = issue_result['record']

    action_payload = dict(
        **_baseline(inspection),
        title=action_title,
        relatedIssueId=issue['id'],
        evidenceIds=evidence_ids,
    )
    action_result = engine.create(
        'action',
        action_id,
        project_id,
        action_payload,
        party_id,
        role_id,
        key + ':action:create',
    )
    action = action_result['record']
    action = engine.execute(
        'action',
        action['id'],
        'assign',
        action['version'],
        dict(
            responsiblePartyId=responsible_party_id,
            responsibleOrganizationId=contractor_id,
            dueAt=due_at,
        ),
        action.get('evidenceIds', []),
        party_id,
        role_id,
        key + ':action:assign',
    )['record']
    issue = engine.execute(
        'issue',
        issue['id'],
        'assign',
        issue['version'],
        dict(
            responsiblePartyId=responsible_party_id,
            responsibleOrganizationId=contractor_id,
            dueAt=due_at,
            actionIds=[action['id']],
        ),
        issue.get('evidenceIds', []),
        party_id,
        role_id,
        key + ':issue:assign',
    )['record']
    return dict(issue=issue, correctiveAction=action)


def create_reinspection_request(
    engine,
    case_inspection_id,
    issue_id,
    reinspection_id,
    work_name,
    requested_inspection_at,
    self_inspection_complete,
    precheck,
    evidence_ids,
    party_id,
    role_id,
    key,
):
    """Create, submit and link one reinspection request atomically."""
    root = engine.get('Inspection', case_inspection_id)
    root = _case_root(engine, root)
    project_id = root['projectId']
    issue = _record(engine, 'Issue', issue_id, project_id)
    require(
        root['id'] in issue.get('inspectionIds', []),
        'CASE_LINK_INVALID',
        'Issue does not belong to this inspection case',
    )
    require(issue.get('status') == 'in_progress', 'ISSUE_NOT_IN_CORRECTION', 'Issue must be in correction')
    require(self_inspection_complete is True, 'SELF_INSPECTION_COMPLETE', 'Contractor self-inspection must be complete')
    require(bool(work_name.strip()), 'INVALID_REQUEST', 'Reinspection work name is required')
    require(bool(evidence_ids), 'EVIDENCE_REQUIRED', 'Reinspection request requires corrective evidence')

    previous_id = issue['inspectionIds'][-1]
    previous = _record(engine, 'Inspection', previous_id, project_id)
    action_ids = issue.get('actionIds', [])
    require(isinstance(action_ids, list) and len(action_ids) == len(set(action_ids)),
            'REFERENCE_CYCLE_INCOMPLETE', 'Issue-linked corrective Action identities are invalid')
    linked_actions = [_record(engine, 'Action', action_id, project_id) for action_id in action_ids]
    current_actions = [
        action for action in linked_actions
        if action.get('correctionCycle') == issue.get('correctionCycle')
    ]
    require(bool(current_actions), 'CORRECTIVE_ACTION_SUBMITTED',
            'Current correction cycle must have linked corrective Actions')
    require(all(
        action.get('relatedIssueId') == issue['id']
        and action.get('correctionCycle') == issue.get('correctionCycle')
        and action.get('status') in {'submitted', 'verified', 'closed'}
        and all(action.get(field) == issue.get(field) for field in (
            'packageId', 'locationId', 'discipline', 'responsibleOrganizationId'
        ))
        for action in current_actions
    ), 'CORRECTIVE_ACTION_SUBMITTED',
        'Every current-cycle corrective Action must be submitted, verified or closed in the exact Issue scope')
    corrective_action_refs = [
        {'objectType': 'Action', 'objectId': action['id'], 'version': action['version']}
        for action in current_actions
    ]
    payload = dict(
        **_baseline(previous),
        workName=work_name,
        selfInspectionComplete=True,
        precheck=deepcopy(precheck),
        holdPoint=previous.get('holdPoint', False),
        nextWorkAllowed=False,
        evidenceIds=list(dict.fromkeys(evidence_ids)),
        relatedIssueId=issue['id'],
        previousInspectionId=previous['id'],
        correctionCycle=issue['correctionCycle'],
        correctiveActionRefs=corrective_action_refs,
    )
    created = engine.create(
        'inspection',
        reinspection_id,
        project_id,
        payload,
        party_id,
        role_id,
        key + ':inspection:create',
    )['record']
    requested = engine.execute(
        'inspection',
        created['id'],
        'request',
        created['version'],
        dict(
            requestedAt=engine.at(),
            requestedInspectionAt=requested_inspection_at,
            selfInspectionComplete=True,
            precheck=deepcopy(precheck),
            requirementRefs=deepcopy(previous.get('requirementRefs', [])),
            drawingRef=deepcopy(previous.get('drawingRef')),
        ),
        created.get('evidenceIds', []),
        party_id,
        role_id,
        key + ':inspection:request',
    )['record']
    linked = engine.execute(
        'issue',
        issue['id'],
        'request_reinspection',
        issue['version'],
        dict(inspectionIds=issue['inspectionIds'] + [requested['id']]),
        requested.get('evidenceIds', []),
        party_id,
        role_id,
        key + ':issue:request-reinspection',
    )['record']
    return dict(issue=linked, reinspection=requested)


def create_case_owner_report(
    engine,
    case_inspection_id,
    issue_id,
    report_id,
    title,
    revision,
    report_type,
    priority,
    recipient_ids,
    facts,
    cause,
    impact,
    immediate_actions,
    recommendation,
    due_at,
    receipt_due_at,
    party_id,
    role_id,
    key,
):
    """Create a traceable closeout report draft after the Issue is formally closed."""
    requested=engine.get('Inspection',case_inspection_id)
    root=_case_root(engine,requested)
    project_id=root['projectId']
    issue=_record(engine,'Issue',issue_id,project_id)
    require(root['id'] in issue.get('inspectionIds',[]),'CASE_LINK_INVALID','Issue does not belong to this inspection case')
    require(issue.get('status')=='closed','ISSUE_NOT_CLOSED','Closeout owner report requires a formally closed issue')
    require(report_type in ['regular','urgent'],'INVALID_REQUEST','Closeout owner report type must be regular or urgent')
    require(priority in ['P1','P2','P3','P4'],'INVALID_REQUEST','Unsupported owner report priority')
    require(isinstance(recipient_ids,list) and bool(recipient_ids),'OWNER_RECIPIENT_REQUIRED','At least one owner recipient is required')
    for recipient_id in list(dict.fromkeys(recipient_ids)):
        _owner_recipient(engine,recipient_id,project_id)
    require(isinstance(facts,str) and facts.strip(),'INVALID_REQUEST','Owner report facts are required')
    require(isinstance(impact,dict) and bool(impact),'INVALID_REQUEST','Owner report impact is required')
    require(isinstance(recommendation,str) and recommendation.strip(),'INVALID_REQUEST','Owner report recommendation is required')
    require(isinstance(title,str) and title.strip() and isinstance(revision,str) and revision.strip(),'INVALID_REQUEST','Report title and revision are required')

    observations=[
        _record(engine,'Observation',observation_id,project_id)
        for observation_id in issue.get('observationIds',[])
    ]
    actions=[
        _record(engine,'Action',action_id,project_id)
        for action_id in issue.get('actionIds',[])
    ]
    inspections=[
        _record(engine,'Inspection',inspection_id,project_id)
        for inspection_id in issue.get('inspectionIds',[])
    ]
    source_refs=[
        _domain_ref('Inspection',root),
        _domain_ref('Issue',issue),
        *(_domain_ref('Observation',record) for record in observations),
        *(_domain_ref('Action',record) for record in actions),
        *(_domain_ref('Inspection',record) for record in inspections if record['id']!=root['id']),
    ]
    source_refs=list({
        (reference['objectType'],reference['objectId']):reference
        for reference in source_refs
    }.values())
    evidence_ids=list(issue.get('evidenceIds',[]))+list(issue.get('closureEvidenceIds',[]))
    for record in [*observations,*actions,*inspections]:
        evidence_ids.extend(record.get('evidenceIds',[]))
    evidence_ids=list(dict.fromkeys(evidence_ids))
    report_data=dict(
        type=report_type,
        priority=priority,
        sourceDomainRefs=source_refs,
        recipients=list(dict.fromkeys(recipient_ids)),
        facts=facts,
        impact=deepcopy(impact),
        recommendation=recommendation,
        dueAt=due_at,
        receiptDueAt=receipt_due_at,
        actionIds=[],
        decisionIds=[],
        informationOnly=True,
    )
    if isinstance(cause,str) and cause.strip():
        report_data['cause']=cause
    if isinstance(immediate_actions,str) and immediate_actions.strip():
        report_data['immediateActions']=immediate_actions
    payload=dict(
        **_baseline(root),
        title=title,
        revision=revision,
        relatedRefs=[_domain_ref('Issue',issue)],
        report=report_data,
        evidenceIds=evidence_ids,
    )
    report=engine.create(
        'report',
        report_id,
        project_id,
        payload,
        party_id,
        role_id,
        key+':report:create',
    )['record']
    return dict(report=report)


def _media_scope(source):
    fields = (
        'packageId',
        'locationId',
        'discipline',
        'responsibleOrganizationId',
        'minimumQualificationRank',
        'requirementRefs',
        'drawingRef',
        'upstreamInspectionIds',
    )
    return {field: deepcopy(source[field]) for field in fields if field in source}


def _analysis_sources(engine, source_evidence_ids, mode):
    require(isinstance(source_evidence_ids,list) and bool(source_evidence_ids),'ANALYSIS_SOURCES_READY','Analysis requires at least one source')
    require(len(set(source_evidence_ids))==len(source_evidence_ids),'ANALYSIS_SOURCES_READY','Analysis source IDs must be unique')
    sources=[engine.get('Evidence',eid) for eid in source_evidence_ids]
    require(all(source['sourceType']=='original' for source in sources),'ANALYSIS_SOURCES_READY','Analysis starts from preserved originals')
    project_ids={source['projectId'] for source in sources}
    require(len(project_ids)==1,'PROJECT_MISMATCH','Analysis sources must belong to one project')
    base=sources[0]
    for source in sources[1:]:
        for field in ('packageId','locationId','discipline','responsibleOrganizationId'):
            require(source.get(field)==base.get(field),'ANALYSIS_SCOPE_MISMATCH','Analysis sources must share one work scope')
    media_types={source['mediaType'] for source in sources}
    if mode=='photo':
        require(media_types=={'photo'},'ANALYSIS_MODE_INVALID','Photo mode accepts only photos')
    elif mode=='audio':
        require(media_types<= {'audio','video'},'ANALYSIS_MODE_INVALID','Audio mode accepts audio or video sources')
    else:
        require(mode in ['keyframes','adaptive','every_frame'],'ANALYSIS_MODE_INVALID','Unknown analysis mode')
        require(media_types=={'video'},'ANALYSIS_MODE_INVALID','Frame analysis modes accept only video')
    for source in sources:
        if source['mediaType'] in ['audio','video']:
            require(type(source.get('durationMs')) is int and source['durationMs']>0,'MEDIA_NOT_INDEXED','Audio/video source requires trusted duration metadata')
        if source['mediaType']=='video':
            count=source.get('frameCount')
            manifest=source.get('metadata',{}).get('framePtsMs')
            require(type(count) is int and count>0 and isinstance(manifest,list) and len(manifest)==count,'MEDIA_NOT_INDEXED','Video source requires trusted frame count and PTS manifest')
    return sources


def queue_media_analysis(
    engine,
    run_id,
    source_evidence_ids,
    mode,
    languages,
    profile,
    party_id,
    role_id,
    key,
    inspection_id=None,
    retry_of_id=None,
):
    """Create a queued AnalysisRun with optional explicit Inspection context."""
    sources=_analysis_sources(engine,source_evidence_ids,mode)
    project_id=sources[0]['projectId']
    require(isinstance(languages,list) and bool(languages),'INVALID_REQUEST','At least one analysis language is required')
    require(all(language in ['ko','vi','en','auto'] for language in languages),'INVALID_REQUEST','Unsupported analysis language')
    payload=dict(
        **_media_scope(sources[0]),
        sourceEvidenceIds=list(source_evidence_ids),
        mode=mode,
        model=deepcopy(profile['model']),
        promptVersion=profile['promptVersion'],
        policyVersion=profile['policyVersion'],
        languages=list(dict.fromkeys(languages)),
    )
    inspection_ref=None
    if inspection_id:
        inspection=_record(engine,'Inspection',inspection_id,project_id)
        for field in ('packageId','locationId','discipline','responsibleOrganizationId'):
            if sources[0].get(field) is not None and inspection.get(field) is not None:
                require(
                    sources[0][field]==inspection[field],
                    'ANALYSIS_SCOPE_MISMATCH',
                    'Media evidence scope must match the explicitly selected inspection',
                )
        inspection_ref=dict(objectType='Inspection',objectId=inspection['id'],version=inspection['version'])
    if retry_of_id:
        previous=engine.get('AnalysisRun',retry_of_id)
        require(previous['projectId']==project_id,'PROJECT_MISMATCH','Retry run belongs to another project')
        require(previous['status'] in ['failed','cancelled'],'RETRY_INVALID','Only failed or cancelled analysis can be retried')
        require(previous['sourceEvidenceIds']==list(source_evidence_ids),'RETRY_INVALID','Retry must preserve the same source set')
        previous_ref=previous.get('inspectionRef')
        if inspection_ref is not None:
            require(
                previous_ref is not None and previous_ref['objectId']==inspection_ref['objectId'],
                'RETRY_INVALID',
                'Retry must preserve the same inspection context',
            )
        inspection_ref=deepcopy(previous_ref)
        payload['retryOfId']=retry_of_id
    if inspection_ref is not None:
        payload['inspectionRef']=inspection_ref
    return engine.create('analysis_run',run_id,project_id,payload,party_id,role_id,key)['record']


def start_media_analysis(engine, run_id, system_actor, key):
    run=engine.get('AnalysisRun',run_id)
    return engine.execute(
        'analysis_run',
        run_id,
        'start',
        run['version'],
        {},
        [],
        system_actor['partyId'],
        system_actor['roleAssignmentId'],
        key,
    )['record']


def fail_media_analysis(engine, run_id, reason, system_actor, key):
    require(isinstance(reason,str) and reason.strip(),'REASON_PRESENT','Worker failure reason is required')
    run=engine.get('AnalysisRun',run_id)
    return engine.execute(
        'analysis_run',
        run_id,
        'fail',
        run['version'],
        dict(reason=reason),
        [],
        system_actor['partyId'],
        system_actor['roleAssignmentId'],
        key,
    )['record']


def add_derived_frame(engine, run_id, frame_id, file_id, source_evidence_id, frame_index, pts_ms, content, mime_type, system_actor, key):
    """Preserve one decoded frame as derived Evidence tied to exact source PTS."""
    run=engine.get('AnalysisRun',run_id)
    require(run['status']=='running','ANALYSIS_NOT_RUNNING','Derived frames are accepted only while the run is active')
    require(source_evidence_id in run['sourceEvidenceIds'],'ANALYSIS_SOURCE_MISMATCH','Frame source is outside the run')
    source=engine.get('Evidence',source_evidence_id)
    require(source['mediaType']=='video','FRAME_INVALID','Derived frames require a video source')
    manifest=source.get('metadata',{}).get('framePtsMs',[])
    require(type(frame_index) is int and 0<=frame_index<len(manifest),'FRAME_INVALID','Frame index is outside the decoder manifest')
    require(manifest[frame_index]==pts_ms,'FRAME_INVALID','Frame PTS must match the trusted decoder manifest')
    require(mime_type in ['image/png','image/jpeg','image/webp'],'MIME_INVALID','Derived frame must be a supported image')
    payload=dict(
        **_media_scope(source),
        sourceType='derived',
        mediaType='photo',
        fileId=file_id,
        fileHash=sha256(content).hexdigest(),
        sourcePartyId=source['sourcePartyId'],
        originalEvidenceId=source['id'],
        sourceRange=dict(startMs=pts_ms,endMs=pts_ms,frameIndex=frame_index,ptsMs=pts_ms),
        derivationRunId=run['id'],
        metadata=dict(mimeType=mime_type,derivedKind='video_frame'),
    )
    return engine.add_evidence(
        frame_id,
        source['projectId'],
        payload,
        content,
        system_actor['partyId'],
        system_actor['roleAssignmentId'],
        key,
    )['record']


def complete_media_analysis(engine, run_id, outputs, coverage, completed_at, system_actor, ai_actor, key):
    """Complete one normalized worker run and materialize AI candidates as Observation records."""
    require(isinstance(outputs,list),'INVALID_REQUEST','Worker outputs must be an array')
    require(isinstance(coverage,dict),'INVALID_REQUEST','Worker coverage must be structured')
    run=engine.get('AnalysisRun',run_id)
    completed=engine.execute(
        'analysis_run',
        run_id,
        'complete',
        run['version'],
        dict(outputs=deepcopy(outputs),coverage=deepcopy(coverage),completedAt=completed_at),
        [],
        system_actor['partyId'],
        system_actor['roleAssignmentId'],
        key+':complete',
    )['record']
    observations=[]
    for index,output in enumerate(outputs):
        if output.get('kind')!='candidate':
            continue
        source=engine.get('Evidence',output['sourceEvidenceId'])
        evidence_ids=list(dict.fromkeys(g['evidenceId'] for g in output.get('grounding',[])))
        scope=_media_scope(source)
        if 'minimumQualificationRank' not in scope:
            project=engine.get('Project',completed['projectId'])
            ranks=[
                rule['minimumRank']
                for rule in project.get('qualificationRules',[])
                if rule['discipline'] in [source.get('discipline'),'*']
            ]
            require(bool(ranks),'QUALIFICATION_RULE_MISSING','AI candidate review needs the trusted project qualification rule')
            scope['minimumQualificationRank']=min(ranks)
        payload=dict(
            **scope,
            source='ai',
            description=output['description'],
            grounding=deepcopy(output['grounding']),
            analysisRunId=completed['id'],
            confidence=output['confidence'],
            reviewFlags=deepcopy(output.get('reviewFlags',[])),
            evidenceIds=evidence_ids,
        )
        observation=engine.create(
            'observation',
            uid(),
            completed['projectId'],
            payload,
            ai_actor['partyId'],
            ai_actor['roleAssignmentId'],
            key+':candidate:'+str(index),
        )['record']
        observations.append(observation)
    return dict(run=completed,candidates=observations)


def _media_issue_context(engine, run, candidates):
    inspection_ref=run.get('inspectionRef')
    if not inspection_ref:
        return None,dict(
            ready=False,
            confirmedObservationIds=[],
            issueEligibleObservationIds=[],
            blockedReasons=['INSPECTION_LINK_REQUIRED'],
        )
    require(inspection_ref.get('objectType')=='Inspection','INSPECTION_LINK_INVALID','Analysis inspectionRef must reference Inspection')
    inspection=_record(engine,'Inspection',inspection_ref['objectId'],run['projectId'])
    confirmed=[
        record
        for record in candidates
        if record.get('status')=='confirmed'
        and record.get('source')=='ai'
        and record.get('analysisRunId')==run['id']
    ]
    eligible=[
        record['id']
        for record in confirmed
        if any(
            grounding.get('channel')!='speech' and grounding.get('claimSupport')=='observed'
            for grounding in record.get('grounding',[])+record.get('verificationGrounding',[])
        )
    ]
    blocked=[]
    if run.get('status')!='succeeded':blocked.append('ANALYSIS_NOT_COMPLETE')
    if inspection.get('relatedIssueId'):blocked.append('CASE_ROOT_REQUIRED')
    if not (
        inspection.get('resultStatus')=='fail'
        and inspection.get('status') in ['failed','completed']
    ):
        blocked.append('INSPECTION_NOT_FAILED')
    if not confirmed:blocked.append('OBSERVATION_UNVERIFIED')
    elif not eligible:blocked.append('CLAIM_UNCORROBORATED')
    return inspection,dict(
        ready=not blocked,
        confirmedObservationIds=[record['id'] for record in confirmed],
        issueEligibleObservationIds=eligible,
        blockedReasons=blocked,
    )


def analysis_review_package(engine, run_id):
    run=engine.get('AnalysisRun',run_id)
    sources=[engine.get('Evidence',eid) for eid in run['sourceEvidenceIds']]
    candidates=[
        deepcopy(record)
        for (kind,_),record in engine._records.items()
        if kind=='Observation' and record.get('analysisRunId')==run_id
    ]
    target_inspection,issue_readiness=_media_issue_context(engine,run,candidates)
    outputs=run.get('outputs',[])
    return dict(
        run=deepcopy(run),
        sources=deepcopy(sources),
        candidates=candidates,
        targetInspection=deepcopy(target_inspection) if target_inspection else None,
        issueReadiness=issue_readiness,
        transcripts=[deepcopy(item) for item in outputs if item.get('kind')=='transcript'],
        frames=[deepcopy(item) for item in outputs if item.get('kind')=='frame'],
        photoResults=[deepcopy(item) for item in outputs if item.get('kind')=='photo_result'],
        coverage=deepcopy(run.get('coverage',{})),
    )


def create_media_issue_package(
    engine,
    run_id,
    issue_id,
    action_id,
    observation_ids,
    subtype,
    title,
    action_title,
    responsible_party_id,
    due_at,
    party_id,
    role_id,
    key,
):
    """Create an Issue package only from confirmed candidates of one explicitly linked run."""
    run=engine.get('AnalysisRun',run_id)
    require(run.get('status')=='succeeded','ANALYSIS_NOT_COMPLETE','Media analysis must complete before issue creation')
    inspection_ref=run.get('inspectionRef')
    require(bool(inspection_ref),'INSPECTION_LINK_REQUIRED','Media analysis must explicitly reference an inspection')
    require(inspection_ref.get('objectType')=='Inspection','INSPECTION_LINK_INVALID','Analysis inspectionRef must reference Inspection')
    require(bool(observation_ids),'OBSERVATION_REQUIRED','At least one confirmed media observation is required')
    for observation_id in observation_ids:
        observation=_record(engine,'Observation',observation_id,run['projectId'])
        require(
            observation.get('source')=='ai'
            and observation.get('analysisRunId')==run_id,
            'ANALYSIS_CANDIDATE_MISMATCH',
            'Media issue observations must come from this analysis run',
        )
        require(observation.get('status')=='confirmed','OBSERVATION_UNVERIFIED',observation_id)
    return create_issue_package(
        engine,
        inspection_ref['objectId'],
        issue_id,
        action_id,
        observation_ids,
        subtype,
        title,
        action_title,
        responsible_party_id,
        due_at,
        party_id,
        role_id,
        key,
    )
