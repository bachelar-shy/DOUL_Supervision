"""Read projections with explicit source joins and conservative calculated values."""
from .validation import get_path,instant


def calculate(rule,record):
    op=rule['operator']
    if op=='coalesce':return next((get_path(record,p) for p in rule['paths'] if get_path(record,p) is not None),None)
    if op=='validity':
        start,end=get_path(record,rule['from_path']),get_path(record,rule['to_path'])
        if start is None or end is None:return None
        now=rule['_now']
        valid=instant(start)<=instant(now)<instant(end)
        for k in ['active_path','verified_path']:
            if k in rule:
                value=get_path(record,rule[k])
                if value is None:return None
                valid=valid and value is True
        if 'revoked_path' in rule:
            value=get_path(record,rule['revoked_path'])
            if value is None:return None
            valid=valid and value is False
        return valid
    if op in ['elapsed_seconds','elapsed_days']:
        start,end=get_path(record,rule['start_path']),get_path(record,rule['end_path'])
        if start is None or end is None:return None
        seconds=(instant(end)-instant(start)).total_seconds()
        return seconds if op=='elapsed_seconds' else seconds/86400
    raise ValueError('Unknown projection calculation '+op)


def joined_refs(projection,kind,record,visible):
    refs=[]
    for join in projection['joins']:
        if join['left_object']!=kind:continue
        values=get_path(record,join['left_path'])
        if values is None:continue
        values=values if isinstance(values,list) else [values]
        for value in values:
            for (other_kind,oid),other in visible.items():
                if join['right_object'] not in [other_kind,'*'] or other['projectId']!=record['projectId']:continue
                match=(isinstance(value,dict) and value.get('objectType')==other_kind and value.get('objectId')==oid) if join['right_key']=='versioned_ref' else value==other.get(join['right_key'])
                if match:
                    # An exact historical reference is never quietly rewritten to current.
                    refs.append(value.copy() if join['right_key']=='versioned_ref' else dict(objectType=other_kind,objectId=oid,version=other['version']))
    return [dict(t) for t in {tuple(sorted(r.items())) for r in refs}]
