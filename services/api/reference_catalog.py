"""Readable current configuration references for draft selection, never approval."""
from copy import deepcopy

from app.reference.validation import ContractError, instant


def build_reference_catalog(engine, project_id, party_id, role_id):
    result = {'requirements': [], 'assets': []}
    now = instant(engine.at())
    for (kind, _), record in engine._records.items():
        if kind not in {'Requirement', 'Asset'} or record.get('projectId') != project_id:
            continue
        if kind == 'Requirement':
            if record.get('status') != 'active' or instant(record['effectiveFrom']) > now:
                continue
            if record.get('effectiveTo') and instant(record['effectiveTo']) <= now:
                continue
        try:
            engine.authorize_read(record, party_id, role_id)
        except ContractError:
            continue
        result['requirements' if kind == 'Requirement' else 'assets'].append({
            'ref': {'objectType': kind, 'objectId': record['id'], 'version': record['version']},
            'record': deepcopy(record),
        })
    for values in result.values():
        values.sort(key=lambda value: value['ref']['objectId'])
    return result
