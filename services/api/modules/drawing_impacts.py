"""Exact-linked open work affected by unavailable drawing baselines.

Metadata notices preserve the original drawing and affected source versions;
canonical work state and references are never rewritten.
"""
from copy import deepcopy
import json
from uuid import uuid5, NAMESPACE_URL
from fastapi import Request
from app.reference.validation import ContractError, validate, instant

TERMINAL = {'Inspection': {'completed', 'cancelled'}, 'Issue': {'closed', 'cancelled', 'superseded'}, 'Action': {'verified', 'closed', 'cancelled'}}
MACHINES = {'Inspection': 'inspection', 'Issue': 'issue', 'Action': 'action'}


def ref(kind, record):
    return dict(objectType=kind, objectId=record['id'], version=record['version'])


def affected_records(store, drawing_ref):
    engine = store.engine
    drawing = engine.resolve(drawing_ref)
    project = drawing['projectId']
    records = {(kind, identifier): r for (kind, identifier), r in engine._records.items()
               if kind in MACHINES and r.get('projectId') == project}
    inspections = {identifier for (kind, identifier), r in records.items()
                   if kind == 'Inspection' and r.get('drawingRef') == drawing_ref}
    issues = {identifier for (kind, identifier), r in records.items() if kind == 'Issue'
              and (r.get('drawingRef') == drawing_ref or inspections.intersection(r.get('inspectionIds', [])))}
    # Explicit markup links are retained even when markup is edited/deleted.
    markups = {m['id'] for m in store.meta.get('drawingMarkups', []) if m.get('projectId') == project and m.get('drawingRef') == drawing_ref}
    actions = set()
    for link in store.meta.get('drawingMarkupIssueLinks', []):
        if link.get('projectId', project) == project and link.get('markupId') in markups:
            issues.add(link.get('issueRef', {}).get('objectId'))
            actions.add(link.get('actionRef', {}).get('objectId'))
    # Include reverse references, without using spatial proximity as a link.
    for identifier in inspections:
        issue_id = records[('Inspection', identifier)].get('relatedIssueId')
        if issue_id: issues.add(issue_id)
    for identifier in issues:
        issue = records.get(('Issue', identifier), {})
        actions.update(issue.get('actionIds', []))
    for (kind, identifier), record in records.items():
        if kind == 'Action' and record.get('relatedIssueId') in issues: actions.add(identifier)
    selected = [('Inspection', identifier) for identifier in inspections] + [('Issue', identifier) for identifier in issues] + [('Action', identifier) for identifier in actions]
    return [(kind, records[(kind, identifier)]) for kind, identifier in sorted({(kind, identifier) for kind, identifier in selected if isinstance(identifier, str)})
            if (kind, identifier) in records and records[(kind, identifier)].get('status') not in TERMINAL[kind]]


def unavailable_reason(engine, drawing):
    if engine.get('InformationItem', drawing['id'])['version'] != drawing['version']: return 'SOURCE_CHANGED'
    if not engine._drawing_has_approval(drawing): return 'APPROVAL_UNAVAILABLE'
    if not engine._drawing_field_usable(drawing): return 'FIELD_SOURCE_UNAVAILABLE'
    return None


def reconcile_drawing_impacts_in_transaction(store, project_id):
    engine = store.engine
    snapshots = store.meta.setdefault('drawingImpactIncidents', {})
    notice_meta = store.meta.setdefault('drawingImpactNotices', {})
    # Include historical versions referenced by work and retained field copies.
    references = [r.get('drawingRef') for (kind, _), r in engine._records.items()
                  if kind in MACHINES and r.get('projectId') == project_id]
    references += [r.get('drawingRef') for r in store.meta.get('drawingFieldRevisions', []) if r.get('projectId') == project_id]
    seen = set()
    for drawing_ref in references:
        if not isinstance(drawing_ref, dict): continue
        packed = json.dumps(drawing_ref, sort_keys=True)
        if packed in seen: continue
        seen.add(packed)
        try: drawing = engine.resolve(drawing_ref, project_id)
        except ContractError: continue
        reason = unavailable_reason(engine, drawing)
        source_key = project_id + ':' + packed
        if not reason:
            if source_key in snapshots: snapshots[source_key]['active'] = False
            continue
        current = snapshots.get(source_key)
        if not current or not current['active']:
            generation = (current or {}).get('generation', 0) + 1
            incident_id = str(uuid5(NAMESPACE_URL, f'doul-drawing-impact:{source_key}:{generation}'))
            current = dict(id=incident_id, active=True, generation=generation, drawingRef=deepcopy(drawing_ref),
                           reason=reason, occurredAt=engine.at())
            snapshots[source_key] = current
        current['reason'] = reason
        for kind, record in affected_records(store, drawing_ref):
            recipient = record.get('responsiblePartyId') or record.get('createdBy')
            if not recipient: continue
            key = f"{current['id']}:{kind}:{record['id']}:{recipient}"
            notification_id = str(uuid5(NAMESPACE_URL, 'doul-drawing-impact-notice:' + key))
            if notification_id in notice_meta: continue
            now = instant(engine.at())
            roles = [r for (rk, _), r in engine._records.items() if rk == 'RoleAssignment'
                     and r.get('projectId') == project_id and r.get('partyId') == recipient and r.get('active') is True
                     and r.get('actorGroup') in {'SUP', 'CON', 'DES', 'OWN', 'ADM'}
                     and instant(r['validFrom']) <= now < instant(r['validTo'])]
            readable = False
            for role in roles:
                try:
                    engine.authorize_read(drawing, recipient, role['id'])
                    engine.authorize_read(record, recipient, role['id'])
                    readable = True; break
                except ContractError: continue
            if not readable: continue
            notification = dict(id=notification_id, projectId=project_id, version=1, createdAt=engine.at(),
                                updatedAt=engine.at(), createdBy=recipient, recipientPartyId=recipient,
                                sourceRef=ref(kind, record), channel='in_app', status='queued',
                                dueAt=current['occurredAt'], retryCount=0)
            validate(notification, engine.schemas['Notification'], engine.schemas)
            engine._save('Notification', notification)
            notice_meta[notification_id] = dict(incidentId=current['id'], drawingRef=deepcopy(drawing_ref),
                title='도면 변경에 따른 업무 재확인', message=f"{drawing.get('title', '도면')} · 개정 {drawing.get('revision', '')}의 사용 조건이 변경되었습니다. 연결 업무의 적용 기준을 다시 확인하십시오.",
                reason=reason, occurredAt=current['occurredAt'])


def install_drawing_impact_routes(app, store, *, identity, role_for):
    @app.get('/projects/{project_id}/parallel/drawing-impacts')
    def impacts(project_id: str, request: Request):
        actor = identity(request)
        with store.transaction(True):
            role = role_for(actor, project_id, request.headers.get('x-roleassignment-id'))
            reconcile_drawing_impacts_in_transaction(store, project_id)
            engine = store.engine
            result = []
            for incident in store.meta.get('drawingImpactIncidents', {}).values():
                if not incident.get('active'): continue
                try:
                    drawing = engine.resolve(incident['drawingRef'], project_id)
                    engine.authorize_read(drawing, actor['partyId'], role['id'])
                except ContractError: continue
                reason = unavailable_reason(engine, drawing)
                if not reason: continue
                rows = []
                for kind, record in affected_records(store, incident['drawingRef']):
                    try: engine.authorize_read(record, actor['partyId'], role['id'])
                    except ContractError: continue
                    rows.append(dict(sourceRef=ref(kind, record), machine=MACHINES[kind], title=record.get('workName') or record.get('title') or record['id'],
                                     status=record.get('status'), responsiblePartyId=record.get('responsiblePartyId') or record.get('createdBy')))
                result.append(dict(incidentId=incident['id'], drawingRef=deepcopy(incident['drawingRef']), title=drawing.get('title'),
                                   revision=drawing.get('revision'), reason=reason, occurredAt=incident['occurredAt'], items=rows))
            return dict(items=result, total=sum(len(item['items']) for item in result))
