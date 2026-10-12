"""Version-linked task discussions with watchers, mentions and evidence.

Discussion is deliberately not an approval, site instruction, or inspection verdict.
"""
from copy import deepcopy
from fastapi import Request
from app.reference.engine import uid
from app.reference.validation import require

ALLOWED_SUBJECTS = frozenset({"WorkItem", "Issue", "Inspection", "Action", "Report", "InformationItem", "Observation", "Decision", "Approval", "AnalysisRun"})
WRITERS = frozenset({"SUP", "CON", "ADM", "OWN", "DES"})

def make_task_comment(*, project_id, work_ref, author_party_id, role_assignment_id,
                      message, mentions=(), evidence_refs=()):
    require(isinstance(work_ref, dict) and set(work_ref) == {"objectType", "objectId", "version"}
            and work_ref.get("objectType") in ALLOWED_SUBJECTS,
            "REFERENCE_TYPE_INVALID", "Unsupported discussion subject")
    require(isinstance(work_ref.get("objectId"), str) and bool(work_ref["objectId"])
            and type(work_ref.get("version")) is int and work_ref["version"] >= 1,
            "REFERENCE_INVALID", "Exact work reference required")
    require(isinstance(message, str) and 1 <= len(message.strip()) <= 4000,
            "INVALID_REQUEST", "Comment must be between 1 and 4000 characters")
    require(isinstance(mentions, (list, tuple)) and len(mentions) <= 30
            and all(isinstance(x, str) for x in mentions)
            and len(mentions) == len(set(mentions)),
            "INVALID_REQUEST", "Invalid project mentions")
    require(isinstance(evidence_refs, (list, tuple)) and len(evidence_refs) <= 20,
            "INVALID_REQUEST", "Too many attachments")
    for ref in evidence_refs:
        require(isinstance(ref, dict) and set(ref) == {"objectType", "objectId", "version"}
                and ref.get("objectType") == "Evidence"
                and isinstance(ref.get("objectId"), str)
                and type(ref.get("version")) is int and ref["version"] > 0,
                "REFERENCE_INVALID", "Exact Evidence reference required")
    return {"projectId": project_id, "subjectRef": deepcopy(work_ref),
            "authorPartyId": author_party_id, "roleAssignmentId": role_assignment_id,
            "message": message.strip(), "mentionPartyIds": list(mentions),
            "evidenceRefs": deepcopy(list(evidence_refs)), "kind": "collaboration_comment",
            "officialDecision": False}

def authorize_task_comment(engine, record, project_id, party_id, role_id):
    require(record.get("projectId") == project_id, "PROJECT_MISMATCH", "Other project")
    role = engine.get("RoleAssignment", role_id)
    require(role["partyId"] == party_id and role["projectId"] == project_id,
            "NOT_AUTHORIZED", "Other actor or project")
    engine.authorize_read(record, party_id, role_id)
    return True

def install_task_discussion_routes(app, store, *, identity, role_for, key_for, body_json):
    def context(project_id, request):
        actor = identity(request)
        role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
        require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Session role mismatch")
        store.engine.get("Project", project_id)
        return actor, role

    def subject(project_id, ref, actor, role):
        require(isinstance(ref, dict) and set(ref) == {"objectType", "objectId", "version"}
                and ref.get("objectType") in ALLOWED_SUBJECTS
                and isinstance(ref.get("objectId"), str)
                and type(ref.get("version")) is int and ref["version"] >= 1,
                "REFERENCE_INVALID", "Exact work reference required")
        record = store.engine.resolve(ref, project_id)
        authorize_task_comment(store.engine, record, project_id, actor["partyId"], role["id"])
        return record

    def thread_id(ref):
        return ref["objectType"] + ":" + ref["objectId"]

    def can_read_person(subject_record, project_id, person_id):
        for (kind, _), role in store.engine._records.items():
            if kind != "RoleAssignment" or role.get("projectId") != project_id or role.get("partyId") != person_id:
                continue
            try:
                store.engine.authorize_read(subject_record, person_id, role["id"])
                return True
            except Exception as exc:
                if getattr(exc, "code", None) not in {"NOT_AUTHORIZED", "SCOPE_MISMATCH", "QUALIFICATION_INVALID", "ORGANIZATION_MISMATCH", "NOT_FOUND", "ASSIGNMENT_EXPIRED"}:
                    raise
        return False

    @app.get("/projects/{project_id}/field/discussions")
    def discussion(project_id: str, request: Request,
                   subjectType: str = "", subjectId: str = "", version: int = 0,
                   sort: str = "oldest"):
        require(sort in {"oldest", "newest"}, "INVALID_REQUEST", "Invalid order")
        with store.transaction():
            actor, role = context(project_id, request)
            ref = {"objectType": subjectType, "objectId": subjectId, "version": version}
            subject(project_id, ref, actor, role)
            thread = store.meta.get("fieldTaskDiscussions", {}).get(project_id, {}).get(thread_id(ref), {})
            comments = deepcopy(thread.get("comments", []))
            if sort == "newest":
                comments.reverse()
            return {"projectId": project_id, "subjectRef": ref, "items": comments,
                    "count": len(comments), "watcherCount": len(thread.get("watchers", [])),
                    "watching": actor["partyId"] in thread.get("watchers", [])}

    @app.post("/projects/{project_id}/field/discussions/comments")
    async def post_comment(project_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"subjectRef", "message", "mentionPartyIds", "evidenceRefs"},
                "INVALID_REQUEST", "Comment, subject, mentions and attachments required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "No discussion permission")
            subject_record = subject(project_id, body["subjectRef"], actor, role)
            message = make_task_comment(project_id=project_id, work_ref=body["subjectRef"],
                author_party_id=actor["partyId"], role_assignment_id=role["id"],
                message=body["message"], mentions=body["mentionPartyIds"],
                evidence_refs=body["evidenceRefs"])
            for mentioned in message["mentionPartyIds"]:
                require(can_read_person(subject_record, project_id, mentioned),
                        "NOT_AUTHORIZED", "Mentioned person lacks project or subject access")
            for ref in message["evidenceRefs"]:
                evidence = store.engine.resolve(ref, project_id)
                store.engine.authorize_read(evidence, actor["partyId"], role["id"])
            op = "field_discussions:comment"
            previous = store.engine._replay(project_id, actor["partyId"], op, key, body)
            if previous is not None: return previous
            threads = store.meta.setdefault("fieldTaskDiscussions", {}).setdefault(project_id, {})
            thread = threads.setdefault(thread_id(body["subjectRef"]), {"comments": [], "watchers": []})
            watchers = set(thread["watchers"])
            watchers.add(actor["partyId"])
            watchers.update(message["mentionPartyIds"])
            thread["watchers"] = sorted(watchers)
            now = store.engine.at()
            entry = {"id": uid(), "createdAt": now, **message}
            thread["comments"].append(entry)
            # In-app pending alert projection, not a formal Notification or service-delivery receipt.
            for receiver in sorted(watchers - {actor["partyId"]}):
                if can_read_person(subject_record, project_id, receiver):
                    store.meta.setdefault("fieldDiscussionAlerts", {}).setdefault(project_id, []).append({
                        "id": uid(), "recipientPartyId": receiver, "commentId": entry["id"],
                        "subjectRef": deepcopy(body["subjectRef"]), "createdAt": now,
                        "kind": "collaboration_alert"})
            store.meta.setdefault("fieldDiscussionAudit", {}).setdefault(project_id, []).append({
                "event": "collaboration_comment_added", "id": entry["id"],
                "actorPartyId": actor["partyId"], "subjectRef": deepcopy(body["subjectRef"]),
                "at": now})
            result = {"comment": deepcopy(entry), "watcherCount": len(watchers)}
            store.engine._remember(project_id, actor["partyId"], op, key, body, result)
            return result

    @app.post("/projects/{project_id}/field/discussions/watch")
    async def watch(project_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"subjectRef", "watch"} and type(body["watch"]) is bool,
                "INVALID_REQUEST", "Watch choice and subject required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            subject(project_id, body["subjectRef"], actor, role)
            op = "field_discussions:watch"
            previous = store.engine._replay(project_id, actor["partyId"], op, key, body)
            if previous is not None: return previous
            thread = store.meta.setdefault("fieldTaskDiscussions", {}).setdefault(project_id, {}).setdefault(
                thread_id(body["subjectRef"]), {"comments": [], "watchers": []})
            watchers = set(thread["watchers"])
            if body["watch"]: watchers.add(actor["partyId"])
            else: watchers.discard(actor["partyId"])
            thread["watchers"] = sorted(watchers)
            result = {"watching": body["watch"], "watcherCount": len(watchers)}
            store.engine._remember(project_id, actor["partyId"], op, key, body, result)
            return result
