"""Atomic normalized source import. Caller owns the persistence transaction.

Product's source package contract supplies schemas, authority and initial states.
This module never promotes imported facts to technical approval or owner closure.
"""
from copy import deepcopy
from hashlib import sha256
import json
from app.reference.engine import load, canonical
from app.reference.validation import ContractError, instant, require, validate

CONTRACT = load('schema/schedule_source_import_contract_v1.json')
COMMAND = CONTRACT['operation']


def reference(kind, oid):
    return dict(objectType=kind, objectId=oid, version=1)


def portable(package):
    return dict(
        schedule={k: v for k, v in package['schedule'].items()
                  if k not in CONTRACT['source_identity']['normalized_document']['schedule_excludes']},
        activities=[dict(data=a['data'], predecessorActivityIds=a.get('predecessorActivityIds', []),
                         successorActivityIds=a.get('successorActivityIds', [])) for a in package['activities']],
        criticalActivityId=package['criticalActivityId'],
    )


def normalized(document):
    require(isinstance(document, dict) and set(document) == {'schedule', 'activities', 'criticalActivityId'},
            'SOURCE_CONTENT_INVALID', 'Normalized source document shape mismatch')
    require(isinstance(document['activities'], list), 'SOURCE_CONTENT_INVALID', 'Activities must be an array')
    result = deepcopy(document)
    for activity in result['activities']:
        require(isinstance(activity, dict) and not set(activity)-{'data', 'predecessorActivityIds', 'successorActivityIds'},
                'SOURCE_CONTENT_INVALID', 'Source activity contains request-envelope metadata')
        activity.setdefault('predecessorActivityIds', [])
        activity.setdefault('successorActivityIds', [])
    return result


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'SOURCE_CONTENT_INVALID', 'Duplicate JSON key')
        result[key] = value
    return result


def import_source(store, project_id, package, party_id, role_id, key):
    engine = store.engine
    schemas = {**engine.schemas, **CONTRACT['schemas']}
    validate(package, schemas['ScheduleSourceImportPackage'], schemas)
    schedule = deepcopy(package['schedule'])
    kind = CONTRACT['kinds'][schedule['scheduleKind']]
    oid = package['clientObjectId']
    payload = dict(**package['scope'], title=package['title'], revision=schedule['revision'],
                   fileIds=[schedule['sourceFileRef']], evidenceIds=[package['sourceEvidenceRef']['objectId']],
                   schedule=schedule)
    project = engine.get('Project', project_id)
    ranks = [r['minimumRank'] for r in project.get('qualificationRules', []) if r['discipline'] in [package['scope']['discipline'], '*']]
    require(bool(ranks), 'QUALIFICATION_RULE_MISSING', 'Project discipline qualification rule required')
    payload['minimumQualificationRank'] = min(ranks)
    probe = dict(payload, id=oid, projectId=project_id)
    role = engine.authorize(probe, kind['authority'], party_id, role_id)
    cached = engine._replay(project_id, party_id, COMMAND, key, package)
    if cached is not None:
        return cached
    ids = [oid] + [a['clientObjectId'] for a in package['activities']]
    require(len(set(ids)) == len(ids), 'IDENTITY_COLLISION', 'Package object IDs must be unique')
    require(not any(i in ids for _, i in engine._records), 'OBJECT_EXISTS', 'Package identity already exists')
    evidence = engine._current_reference(package['sourceEvidenceRef'], project_id, object_type='Evidence')
    engine._evidence_access(evidence['id'], probe, role)
    require(evidence['sourceType'] == 'original', 'SOURCE_REFERENCE_INVALID', 'Import requires preserved original evidence')
    require(schedule['sourceFileRef'] == evidence['fileId'], 'SOURCE_REFERENCE_INVALID', 'Source file must belong to referenced evidence')
    try:
        raw = store.blob(evidence['fileId'])
    except (KeyError, OSError) as exc:
        raise ContractError('SOURCE_STORAGE_UNAVAILABLE', 'Original source bytes unavailable') from exc
    checksum = sha256(raw).hexdigest()
    require(schedule['sourceFileHash'].lower() == checksum == evidence['fileHash'].lower(),
            'SOURCE_HASH_MISMATCH', 'Source hash differs from preserved original')
    try:
        document = json.loads(raw, object_pairs_hook=reject_duplicate_keys,
                              parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except ContractError:
        raise
    except (ValueError, UnicodeError) as exc:
        raise ContractError('SOURCE_CONTENT_INVALID', 'Original must be valid normalized JSON') from exc
    require(canonical(normalized(document)) == canonical(portable(package)), 'SOURCE_CONTENT_MISMATCH', 'Original content differs from package')
    by_id = {a['data']['activityId']: a for a in package['activities']}
    require(len(by_id) == len(package['activities']), 'ACTIVITY_ID_DUPLICATE', 'Source activity IDs must be unique')
    critical = by_id.get(package['criticalActivityId'])
    require(critical is not None and critical['data'].get('critical') is True,
            'CRITICAL_ACTIVITY_INVALID', 'Critical activity must exist and be marked critical')
    source_ref = reference('InformationItem', oid)
    activity_refs = [reference('WorkItem', a['clientObjectId']) for a in package['activities']]
    schedule.update(activityCount=len(activity_refs), criticalPathRef=reference('WorkItem', critical['clientObjectId']))
    for field in ['baselineScheduleRef', 'previousScheduleRef', 'correctionOfRef', 'revisionBasisRef']:
        if field in schedule:
            engine._current_reference(schedule[field], project_id)
    records = []
    for activity in package['activities']:
        data = deepcopy(activity['data'])
        data['sourceScheduleRef'] = deepcopy(source_ref)
        for field, target in [('predecessorActivityIds', 'predecessorRefs'), ('successorActivityIds', 'successorRefs')]:
            logical = activity.get(field, [])
            require(all(i in by_id for i in logical), 'ACTIVITY_LOGIC_INVALID', 'Logic references must stay inside source')
            data[target] = [reference('WorkItem', by_id[i]['clientObjectId']) for i in logical]
        for start, finish in [('plannedStartAt', 'plannedFinishAt'), ('actualStartAt', 'actualFinishAt'), ('forecastStartAt', 'forecastFinishAt')]:
            if start in data and finish in data:
                require(instant(data[start]) <= instant(data[finish]), 'ACTIVITY_DATE_INVALID', 'Activity start exceeds finish')
        require('actualFinishAt' not in data or 'actualStartAt' in data,
                'ACTIVITY_DATE_INVALID', 'Actual finish requires actual start')
        for field in ['actualStartAt', 'actualFinishAt']:
            if field in data:
                require('dataDate' in schedule and instant(data[field]) <= instant(schedule['dataDate']),
                        'ACTIVITY_DATE_INVALID', 'Actual date exceeds Data Date')
        if 'responsibleOrganizationId' in data:
            require(data['responsibleOrganizationId'] == package['scope']['responsibleOrganizationId'],
                    'ORGANIZATION_MISMATCH', 'Activity organization differs from source scope')
        if 'baselineActivityRef' in data:
            baseline_activity = engine._current_reference(data['baselineActivityRef'], project_id,
                                                         object_type='WorkItem', subtype='ScheduleActivity')
            require('baselineScheduleRef' in schedule, 'ACTIVITY_BASELINE_INVALID', 'Baseline mapping requires baseline schedule')
            baseline = engine.resolve(schedule['baselineScheduleRef'], project_id)
            original_ref = baseline.get('metadata', {}).get('sourceImport', {}).get('sourceScheduleRef')
            require(original_ref is not None and baseline_activity['data']['sourceScheduleRef'] == original_ref,
                    'ACTIVITY_BASELINE_INVALID', 'Activity belongs to a different baseline source')
            require(all(baseline_activity.get(f) == package['scope'][f] for f in package['scope']),
                    'SCOPE_MISMATCH', 'Baseline activity scope mismatch')
        record = dict(id=activity['clientObjectId'], projectId=project_id, version=1,
                      createdAt=engine.at(), updatedAt=engine.at(), createdBy=party_id,
                      subtype='ScheduleActivity', status='snapshot', title=data['activityName'], data=data,
                      evidenceIds=activity.get('evidenceIds', []), **package['scope'])
        validate(record, engine.schemas['WorkItem'], engine.schemas)
        engine.authorize_read(record, party_id, role_id)
        engine._common(record, role)
        records.append(record)
    # All writes below are covered by the caller's single persistence transaction.
    audits = []
    for record in records:
        engine._save('WorkItem', record)
        audits.append(engine._event(record, COMMAND, party_id, role_id, key, package, None)['auditEvent'])
    if kind['machine']:
        result = engine.create(kind['machine'], oid, project_id, payload, party_id, role_id, key)
        record = result['record']
    else:
        record = dict(payload, id=oid, projectId=project_id, version=1, createdAt=engine.at(),
                      updatedAt=engine.at(), createdBy=party_id, subtype='Schedule', status=kind['initial_state'])
        record['schedule']['importedAt'] = engine.at()
        validate(record, engine.schemas['InformationItem'], engine.schemas)
        engine._common(record, role)
        engine._save('InformationItem', record)
        result = engine._event(record, COMMAND, party_id, role_id, key, package, None)
    record['metadata'] = {'sourceImport': dict(contractVersion=CONTRACT['version'], parserVersion=package['parserVersion'],
        inputMode=package['inputMode'], sourceEvidenceRef=deepcopy(package['sourceEvidenceRef']),
        sourceScheduleRef=source_ref, activityRefs=activity_refs)}
    validate(record, engine.schemas['InformationItem'], engine.schemas)
    engine._save('InformationItem', record)
    result.update(record=record, sourceScheduleRef=source_ref, activityRefs=activity_refs, activityAuditEvents=audits)
    engine._remember(project_id, party_id, COMMAND, key, package, result)
    return deepcopy(result)
