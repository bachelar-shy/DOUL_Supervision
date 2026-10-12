"""Offline intent envelope validator: never silently rebase approved business commands."""
from copy import deepcopy
from app.reference.validation import require

def prepare_offline_intent(intent, *, project_id, party_id, role_id):
    require(isinstance(intent, dict), "INVALID_REQUEST", "Offline intent required")
    for field,expected in (("projectId",project_id),("actorId",party_id),("roleId",role_id)):
        require(intent.get(field)==expected,"NOT_AUTHORIZED","Offline author/project mismatch")
    require(isinstance(intent.get("requestKey"),str) and 8<=len(intent["requestKey"])<=160,"INVALID_REQUEST","Stable idempotency key required")
    require(isinstance(intent.get("expectedVersion"),int) and not isinstance(intent["expectedVersion"],bool) and intent["expectedVersion"]>=1,"INVALID_REQUEST","Expected version required")
    require(isinstance(intent.get("command"),str) and bool(intent["command"]) and isinstance(intent.get("payload"),dict),"INVALID_REQUEST","Command payload required")
    return deepcopy(intent)

def replay_decision(intent, server_version, *, current_party_id, current_role_id, project_id):
    intent=prepare_offline_intent(intent,project_id=project_id,party_id=current_party_id,role_id=current_role_id)
    require(isinstance(server_version,int) and server_version>=1,"INVALID_REQUEST","Current server version required")
    return {"result":"ready" if intent["expectedVersion"]==server_version else "conflict_requires_user_review",
            "requestKey":intent["requestKey"], "expectedVersion":intent["expectedVersion"], "serverVersion":server_version,
            "autoSubmit":intent["expectedVersion"]==server_version}

