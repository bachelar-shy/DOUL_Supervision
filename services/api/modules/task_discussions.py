"""Conversation entries are collaboration notes, not approvals, instructions or statutory signatures."""
from copy import deepcopy
from app.reference.validation import require

def make_task_comment(*, project_id, work_ref, author_party_id, role_assignment_id, message, mentions=(), evidence_refs=()):
    require(isinstance(work_ref,dict) and work_ref.get("objectType") in {"WorkItem","Issue","Inspection","Action","Report","InformationItem"},"REFERENCE_TYPE_INVALID","Unsupported subject")
    require(isinstance(work_ref.get("objectId"),str) and work_ref["objectId"] and isinstance(work_ref.get("version"),int) and not isinstance(work_ref["version"],bool) and work_ref["version"]>0,"REFERENCE_INVALID","Versioned work reference required")
    require(isinstance(message,str) and 1<=len(message.strip())<=4000,"INVALID_REQUEST","Comment length must be 1-4000")
    require(isinstance(mentions,(tuple,list)) and len(mentions)<=30 and all(isinstance(x,str) for x in mentions),"INVALID_REQUEST","Invalid mentions")
    require(len(set(mentions))==len(mentions),"INVALID_REQUEST","Duplicate mentions")
    require(isinstance(evidence_refs,(tuple,list)) and len(evidence_refs)<=20,"INVALID_REQUEST","Too many evidence references")
    return {"projectId":project_id,"subjectRef":deepcopy(work_ref),"authorPartyId":author_party_id,
            "roleAssignmentId":role_assignment_id,"message":message.strip(),"mentionPartyIds":list(mentions),
            "evidenceRefs":deepcopy(list(evidence_refs)),"kind":"collaboration_comment","officialDecision":False}

def authorize_task_comment(engine,record,project_id,party_id,role_id):
    require(record.get("projectId")==project_id,"PROJECT_MISMATCH","Task belongs to another project")
    role=engine.get("RoleAssignment",role_id)
    require(role["partyId"]==party_id and role["projectId"]==project_id,"NOT_AUTHORIZED","Role mismatch")
    engine.authorize_read(record,party_id,role_id)
    return True

