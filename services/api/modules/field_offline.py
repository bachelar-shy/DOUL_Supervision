"""Offline field-command preflight. Never auto-rebase authoritative work."""
from copy import deepcopy
from fastapi import Request
from app.reference.validation import ContractError, require

KINDS = ("Inspection", "Issue", "Action", "WorkItem", "Report", "Observation", "Approval", "Decision", "InformationItem")

def prepare_offline_intent(intent, *, project_id, party_id, role_id):
    require(isinstance(intent, dict), "INVALID_REQUEST", "Offline work item required")
    for field, expected in (("projectId", project_id), ("actorId", party_id), ("roleId", role_id)):
        require(intent.get(field) == expected, "NOT_AUTHORIZED", "Offline actor, role or project mismatch")
    require(isinstance(intent.get("requestKey"), str) and 8 <= len(intent["requestKey"]) <= 160,
            "INVALID_REQUEST", "Stable idempotency key required")
    require(type(intent.get("expectedVersion")) is int and intent["expectedVersion"] >= 1,
            "INVALID_REQUEST", "Expected version required")
    require(isinstance(intent.get("machine"), str) and 1 <= len(intent["machine"]) <= 80
            and isinstance(intent.get("itemId"), str) and bool(intent["itemId"])
            and isinstance(intent.get("command"), str) and 1 <= len(intent["command"]) <= 100
            and isinstance(intent.get("payload"), dict),
            "INVALID_REQUEST", "Original command intent required")
    require(isinstance(intent.get("evidenceIds", []), list) and
            len(intent.get("evidenceIds", [])) <= 20 and
            all(isinstance(x, str) for x in intent.get("evidenceIds", [])),
            "INVALID_REQUEST", "Evidence IDs invalid")
    return deepcopy(intent)

def replay_decision(intent, server_version, *, current_party_id, current_role_id, project_id):
    intent = prepare_offline_intent(intent, project_id=project_id,
                                   party_id=current_party_id, role_id=current_role_id)
    require(type(server_version) is int and server_version >= 1,
            "INVALID_REQUEST", "Current version required")
    return {"result": "ready" if intent["expectedVersion"] == server_version
            else "conflict_requires_user_review",
            "requestKey": intent["requestKey"],
            "expectedVersion": intent["expectedVersion"], "serverVersion": server_version,
            "autoSubmit": intent["expectedVersion"] == server_version}

def install_field_offline_routes(app, store, *, identity, role_for, body_json):
    @app.post("/projects/{project_id}/field/offline/preflight")
    async def offline_preflight(project_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and set(body) == {"intents"}
                and isinstance(body["intents"], list) and 1 <= len(body["intents"]) <= 40,
                "INVALID_REQUEST", "1-40 pending intents required")
        actor = identity(request)
        with store.transaction():
            role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
            require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Session role mismatch")
            store.engine.get("Project", project_id)
            result = []
            for request_intent in body["intents"]:
                intent = prepare_offline_intent(request_intent, project_id=project_id,
                        party_id=actor["partyId"], role_id=role["id"])
                matching = [(kind, record) for (kind, oid), record in store.engine._records.items()
                            if kind in KINDS and oid == intent["itemId"] and record["projectId"] == project_id
                            and store.engine._record_machines.get((kind, oid)) == intent["machine"]]
                require(len(matching) == 1, "NOT_FOUND", "Offline target unavailable")
                record = matching[0][1]
                store.engine.authorize_read(record, actor["partyId"], role["id"])
                # Server state is authoritative. Preflight is advisory and does
                # not replace the protected command endpoint's own checks.
                result.append({"itemId": intent["itemId"], **replay_decision(
                    intent, record["version"], current_party_id=actor["partyId"],
                    current_role_id=role["id"], project_id=project_id)})
            return {"projectId": project_id, "items": result, "officialCommandsExecuted": 0}
