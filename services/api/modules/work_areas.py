"""현장 공사구역 조회: authoritative Location IDs, never create a duplicate hierarchy."""
from copy import deepcopy
from app.reference.validation import require

def project_work_areas(engine, project_id, party_id, role_id, *, parent_id=None):
    from services.api.modules.location.query import query_location_tree
    data=query_location_tree(engine, project_id, party_id=party_id, role_id=role_id)
    rows=data.get("items",[])
    if parent_id is not None:
        require(isinstance(parent_id,str), "INVALID_REQUEST", "Invalid parent ID")
        rows=[i for i in rows if (i.get("treeParentRef") or {}).get("objectId")==parent_id]
    return {"projectId":project_id, "items":deepcopy(rows), "count":len(rows), "source":"Location", "displayName":"공사구역"}

def work_area_path(items, area_id):
    index={i.get("id") or i.get("ref",{}).get("objectId"):i for i in items}
    result=[];seen=set();cursor=area_id
    while cursor and cursor in index:
        require(cursor not in seen,"LOCATION_CYCLE","Cycle in work area path")
        seen.add(cursor);row=index[cursor]
        result.append(row["name"])
        cursor=(row.get("treeParentRef") or {}).get("objectId")
    return " / ".join(reversed(result))

