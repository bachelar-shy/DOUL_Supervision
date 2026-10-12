"""Reusable, versioned construction checklists (not official Inspection approvals).

Published templates are immutable snapshots. Editing creates a new draft
revision; attached runs retain the exact published revision and checked-by/time.
"""
from copy import deepcopy
from datetime import datetime
from uuid import UUID
from fastapi import Request

from app.reference.engine import uid
from app.reference.validation import require

TYPES = frozenset({"pass_fail", "number", "text", "choice"})
SUBJECT_TYPES = frozenset({"WorkItem", "Issue", "Inspection", "Action", "InformationItem", "Report", "Observation", "Decision", "Approval", "AnalysisRun"})

def _text(value, limit=200):
    require(isinstance(value, str) and 1 <= len(value.strip()) <= limit,
            "INVALID_REQUEST", "Text is missing or too long")
    return value.strip()

def validate_template(template):
    require(isinstance(template, dict), "INVALID_REQUEST", "Checklist template required")
    require(isinstance(template.get("projectId"), str) and template["projectId"], "INVALID_REQUEST", "Project required")
    require(type(template.get("version")) is int and template["version"] >= 1, "INVALID_REQUEST", "Version required")
    require(template.get("status") in {"draft", "published", "superseded"}, "INVALID_REQUEST", "Invalid status")
    fields = template.get("items")
    require(isinstance(fields, list) and 1 <= len(fields) <= 500, "INVALID_REQUEST", "1-500 checklist items required")
    keys = set()
    for item in fields:
        require(isinstance(item, dict) and set(item) <= {"key", "label", "type", "required", "options"}
                and isinstance(item.get("key"), str) and 1 <= len(item["key"]) <= 64
                and item["key"] not in keys, "INVALID_REQUEST", "Duplicate or invalid checklist item")
        keys.add(item["key"])
        _text(item.get("label"), 240)
        require(item.get("type") in TYPES, "INVALID_REQUEST", "Unknown answer type")
        require(type(item.get("required", False)) is bool, "INVALID_REQUEST", "Required must be boolean")
        if item["type"] == "choice":
            options = item.get("options")
            require(isinstance(options, list) and 1 <= len(options) <= 30
                    and all(isinstance(v, str) and v and len(v) <= 150 for v in options)
                    and len(set(options)) == len(options),
                    "INVALID_REQUEST", "Choice options invalid")
    return deepcopy(template)

def prepare_answers(template, answers):
    template = validate_template(template)
    require(template["status"] == "published", "INVALID_REQUEST", "Only published checklists may be used")
    require(isinstance(answers, dict), "INVALID_REQUEST", "Answers must be an object")
    lookup = {i["key"]: i for i in template["items"]}
    require(set(answers) <= set(lookup), "INVALID_REQUEST", "Unknown item answers")
    normalized = {}
    for key, value in answers.items():
        field = lookup[key]
        if value is None:
            require(not field.get("required"), "INVALID_REQUEST", "Required item cannot be cleared")
            normalized[key] = None
            continue
        typ = field["type"]
        if typ == "number":
            require(type(value) in (int, float) and abs(value) < 1e12, "INVALID_REQUEST", "Number required")
        elif typ == "pass_fail":
            require(value in ("pass", "fail", "na"), "INVALID_REQUEST", "Pass, fail or N/A required")
        elif typ == "text":
            require(isinstance(value, str) and len(value) <= 4000, "INVALID_REQUEST", "Text too long")
        else:
            require(value in field["options"], "INVALID_REQUEST", "Invalid choice")
        normalized[key] = deepcopy(value)
    return {"projectId": template["projectId"], "templateVersion": template["version"],
            "answers": normalized, "status": "draft"}

def install_field_checklist_routes(app, store, *, identity, role_for, key_for, body_json):
    def context(project_id, request):
        actor = identity(request)
        role = role_for(actor, project_id, request.headers.get("x-roleassignment-id"))
        require(role["id"] == actor["roleAssignmentId"], "NOT_AUTHORIZED", "Session role mismatch")
        store.engine.get("Project", project_id)
        return actor, role

    def require_admin(project_id, actor, role):
        require(role["actorGroup"] == "ADM" and role["roleCode"] == "project_admin",
                "NOT_AUTHORIZED", "Only project administration manages checklist templates")
        store.engine.authorize(store.engine.get("Project", project_id),
                               "manage_project_roles", actor["partyId"], role["id"])

    def template_versions(project_id, template_id):
        return store.meta.get("fieldChecklistTemplates", {}).get(project_id, {}).get(template_id, [])

    def selected_template(project_id, template_id, version=None):
        history = template_versions(project_id, template_id)
        require(history, "NOT_FOUND", "Checklist template unavailable")
        if version is not None:
            require(type(version) is int and version > 0, "INVALID_REQUEST", "Version invalid")
            matches = [r for r in history if r["version"] == version]
        else:
            matches = history[-1:]
        require(matches, "NOT_FOUND", "Checklist version unavailable")
        return matches[0]

    def target(project_id, reference, actor, role, *, exact_version=True):
        require(isinstance(reference, dict) and set(reference) == {"objectType", "objectId", "version"}
                and reference.get("objectType") in SUBJECT_TYPES
                and isinstance(reference.get("objectId"), str)
                and type(reference.get("version")) is int and reference["version"] > 0,
                "REFERENCE_INVALID", "Exact work reference required")
        if exact_version:
            record = store.engine.resolve(reference, project_id=project_id)
        else:
            # Existing checklist retains the exact historical attachment;
            # current record permissions remain authoritative for reads.
            record = store.engine.get(reference["objectType"], reference["objectId"])
            require(record["projectId"] == project_id, "PROJECT_MISMATCH", "Wrong project")
        store.engine.authorize_read(record, actor["partyId"], role["id"])
        return record

    def replay(project_id, actor, key, body, operation):
        return store.engine._replay(project_id, actor["partyId"], operation, key, body)

    def remember(project_id, actor, key, body, operation, result):
        store.engine._remember(project_id, actor["partyId"], operation, key, body, result)

    @app.get("/projects/{project_id}/field/checklists/templates")
    def get_templates(project_id: str, request: Request):
        with store.transaction():
            actor, role = context(project_id, request)
            history = store.meta.get("fieldChecklistTemplates", {}).get(project_id, {})
            is_admin = role["actorGroup"] == "ADM" and role["roleCode"] == "project_admin"
            return {"projectId": project_id, "items": [deepcopy(item)
                for revisions in history.values() for item in revisions
                if item["status"] == "published" or (is_admin and item is revisions[-1])]}

    @app.post("/projects/{project_id}/field/checklists/templates")
    async def create_template(project_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"title", "items"}, "INVALID_REQUEST", "Title and items required")
        title = _text(body["title"])
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require_admin(project_id, actor, role)
            previous = replay(project_id, actor, key, body, "field_checklists:template_create")
            if previous is not None: return previous
            now = store.engine.at()
            item = {"id": uid(), "projectId": project_id, "title": title,
                    "version": 1, "status": "draft", "items": deepcopy(body["items"]),
                    "createdAt": now, "updatedAt": now, "createdBy": actor["partyId"]}
            validate_template(item)
            store.meta.setdefault("fieldChecklistTemplates", {}).setdefault(project_id, {})[item["id"]] = [item]
            result = {"template": deepcopy(item)}
            remember(project_id, actor, key, body, "field_checklists:template_create", result)
            return result

    @app.post("/projects/{project_id}/field/checklists/templates/{template_id}/publish")
    async def publish_template(project_id: str, template_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"expectedVersion"} and type(body["expectedVersion"]) is int,
                "INVALID_REQUEST", "Expected version required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require_admin(project_id, actor, role)
            op = "field_checklists:publish"
            previous = replay(project_id, actor, key, {"templateId": template_id, **body}, op)
            if previous is not None: return previous
            current = selected_template(project_id, template_id)
            require(current["version"] == body["expectedVersion"], "REFERENCE_STALE", "Checklist changed")
            require(current["status"] == "draft", "INVALID_REQUEST", "Only draft may be published")
            published = {**deepcopy(current), "version": current["version"] + 1,
                         "status": "published", "updatedAt": store.engine.at(),
                         "publishedBy": actor["partyId"]}
            history = store.meta["fieldChecklistTemplates"][project_id][template_id]
            history.append(published)
            result = {"template": deepcopy(published)}
            remember(project_id, actor, key, {"templateId": template_id, **body}, op, result)
            return result

    @app.post("/projects/{project_id}/field/checklists/templates/{template_id}/revise")
    async def revise_template(project_id: str, template_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"expectedVersion", "title", "items"}
                and type(body["expectedVersion"]) is int, "INVALID_REQUEST", "Revision fields required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require_admin(project_id, actor, role)
            op = "field_checklists:revise"
            previous = replay(project_id, actor, key, {"templateId": template_id, **body}, op)
            if previous is not None: return previous
            current = selected_template(project_id, template_id)
            require(current["version"] == body["expectedVersion"], "REFERENCE_STALE", "Checklist changed")
            item = {**deepcopy(current), "version": current["version"] + 1,
                    "status": "draft", "title": _text(body["title"]),
                    "items": deepcopy(body["items"]), "updatedAt": store.engine.at()}
            validate_template(item)
            store.meta["fieldChecklistTemplates"][project_id][template_id].append(item)
            result = {"template": deepcopy(item)}
            remember(project_id, actor, key, {"templateId": template_id, **body}, op, result)
            return result

    @app.post("/projects/{project_id}/field/checklists/templates/{template_id}/draft")
    async def update_template_draft(project_id: str, template_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"expectedVersion", "title", "items"}
                and type(body["expectedVersion"]) is int,
                "INVALID_REQUEST", "Draft revision and latest version required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require_admin(project_id, actor, role)
            op = "field_checklists:draft_update"
            fingerprint = {"templateId": template_id, **body}
            previous = replay(project_id, actor, key, fingerprint, op)
            if previous is not None:
                return previous
            current = selected_template(project_id, template_id)
            require(current["version"] == body["expectedVersion"], "REFERENCE_STALE", "Checklist revision changed")
            require(current["status"] == "draft", "INVALID_REQUEST", "Only draft revisions can be edited")
            proposed = {**deepcopy(current), "version": current["version"] + 1,
                        "title": _text(body["title"]), "items": deepcopy(body["items"]),
                        "updatedAt": store.engine.at()}
            validate_template(proposed)
            store.meta["fieldChecklistTemplates"][project_id][template_id].append(proposed)
            result = {"template": deepcopy(proposed)}
            remember(project_id, actor, key, fingerprint, op, result)
            return result

    @app.get("/projects/{project_id}/field/checklists/runs")
    def get_runs(project_id: str, request: Request, subjectId: str = ""):
        with store.transaction():
            actor, role = context(project_id, request)
            items = []
            for run in store.meta.get("fieldChecklistRuns", {}).get(project_id, {}).values():
                if subjectId and run["subjectRef"]["objectId"] != subjectId: continue
                try:
                    target(project_id, run["subjectRef"], actor, role, exact_version=False)
                except Exception as exc:
                    if getattr(exc, "code", None) in {"SCOPE_MISMATCH", "NOT_AUTHORIZED", "NOT_FOUND", "ORGANIZATION_MISMATCH", "QUALIFICATION_INVALID"}:
                        continue
                    raise
                items.append(deepcopy(run))
            return {"items": items, "count": len(items), "projectId": project_id}

    @app.post("/projects/{project_id}/field/checklists/runs")
    async def create_run(project_id: str, request: Request):
        body = await body_json(request)
        require(set(body) == {"templateId", "templateVersion", "subjectRef"}
                and type(body.get("templateVersion")) is int, "INVALID_REQUEST", "Template and work reference required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role["actorGroup"] in {"ADM", "SUP", "CON"},
                    "NOT_AUTHORIZED", "Checklist recording is restricted")
            target(project_id, body["subjectRef"], actor, role)
            op = "field_checklists:run"
            previous = replay(project_id, actor, key, body, op)
            if previous is not None: return previous
            template = selected_template(project_id, body["templateId"], body["templateVersion"])
            require(template["status"] == "published", "INVALID_REQUEST", "Published checklist required")
            now = store.engine.at()
            run = {"id": uid(), "projectId": project_id, "templateId": body["templateId"],
                   "templateVersion": template["version"], "templateSnapshot": deepcopy(template),
                   "subjectRef": deepcopy(body["subjectRef"]), "answers": {},
                   "version": 1, "status": "draft", "createdAt": now, "updatedAt": now,
                   "createdBy": actor["partyId"]}
            store.meta.setdefault("fieldChecklistRuns", {}).setdefault(project_id, {})[run["id"]] = run
            result = {"run": deepcopy(run)}
            remember(project_id, actor, key, body, op, result)
            return result

    @app.post("/projects/{project_id}/field/checklists/runs/{run_id}/answers")
    async def save_answers(project_id: str, run_id: str, request: Request):
        body = await body_json(request)
        require(isinstance(body, dict) and {"expectedVersion", "answers"} <= set(body)
                and set(body) <= {"expectedVersion", "answers", "evidenceRefs"}
                and type(body["expectedVersion"]) is int,
                "INVALID_REQUEST", "Expected version, answers and optional item photos required")
        key = key_for(request)
        with store.transaction(write=True):
            actor, role = context(project_id, request)
            require(role["actorGroup"] in {"ADM", "SUP", "CON"}, "NOT_AUTHORIZED", "Checklist recording is restricted")
            runs = store.meta.get("fieldChecklistRuns", {}).get(project_id, {})
            require(run_id in runs, "NOT_FOUND", "Checklist unavailable")
            run = runs[run_id]
            target(project_id, run["subjectRef"], actor, role, exact_version=False)
            op = "field_checklists:answer"
            previous = replay(project_id, actor, key, {"runId": run_id, **body}, op)
            if previous is not None: return previous
            require(run["version"] == body["expectedVersion"], "REFERENCE_STALE", "Checklist run changed")
            normalized = prepare_answers(run["templateSnapshot"], body["answers"])["answers"]
            attached = body.get("evidenceRefs", {})
            require(isinstance(attached, dict) and set(attached) <= set(normalized),
                    "INVALID_REQUEST", "Photos must correspond to answered checklist items")
            for item_key, refs in attached.items():
                require(isinstance(refs, list) and len(refs) <= 8,
                        "INVALID_REQUEST", "Maximum eight photos per checklist item")
                seen = set()
                for ref in refs:
                    require(isinstance(ref, dict)
                            and set(ref) == {"objectType", "objectId", "version"}
                            and ref.get("objectType") == "Evidence"
                            and isinstance(ref.get("objectId"), str)
                            and type(ref.get("version")) is int and ref["version"] >= 1
                            and ref["objectId"] not in seen,
                            "REFERENCE_INVALID", "Versioned, unique photo references required")
                    seen.add(ref["objectId"])
                    evidence = store.engine.resolve(ref, project_id)
                    require(evidence.get("mediaType") in {"photo", "video"},
                            "REFERENCE_TYPE_INVALID", "Only photo/video evidence is supported")
                    store.engine.authorize_read(evidence, actor["partyId"], role["id"])
            for item_key, value in normalized.items():
                previous_answer = run["answers"].get(item_key, {})
                refs = attached[item_key] if item_key in attached else previous_answer.get("evidenceRefs", [])
                run["answers"][item_key] = {"value": value, "checkedBy": actor["partyId"],
                                            "checkedAt": store.engine.at(),
                                            "evidenceRefs": deepcopy(refs)}
            run["version"] += 1
            run["updatedAt"] = store.engine.at()
            store.meta.setdefault("fieldChecklistAudit", {}).setdefault(project_id, []).append(
                {"runId": run_id, "partyId": actor["partyId"], "at": run["updatedAt"],
                 "version": run["version"], "keys": sorted(normalized)})
            result = {"run": deepcopy(run)}
            remember(project_id, actor, key, {"runId": run_id, **body}, op, result)
            return result
