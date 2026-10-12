"""Checklist version validation, answers and release gates. Never issue official Inspection approval."""
from copy import deepcopy
from app.reference.validation import require

ALLOWED_TYPES = frozenset(("pass_fail", "number", "text", "choice"))
def validate_template(template):
    require(isinstance(template, dict), "INVALID_REQUEST", "Checklist template must be an object")
    require(isinstance(template.get("projectId"), str) and template["projectId"], "INVALID_REQUEST", "Project required")
    require(isinstance(template.get("version"), int) and not isinstance(template["version"], bool) and template["version"] > 0, "INVALID_REQUEST", "Version required")
    require(template.get("status") in {"draft", "published", "superseded"}, "INVALID_REQUEST", "Invalid lifecycle")
    fields=template.get("items")
    require(isinstance(fields, list) and 1 <= len(fields) <= 200, "INVALID_REQUEST", "Checklist requires 1-200 items")
    keys=set()
    for item in fields:
        require(isinstance(item, dict) and isinstance(item.get("key"), str) and item["key"] and item["key"] not in keys, "INVALID_REQUEST", "Duplicate/empty checklist item key")
        keys.add(item["key"])
        require(item.get("type") in ALLOWED_TYPES and isinstance(item.get("label"), str) and bool(item["label"].strip()), "INVALID_REQUEST", "Invalid item")
        if item["type"]=="choice":require(isinstance(item.get("options"), list) and bool(item["options"]), "INVALID_REQUEST", "Choice options required")
    return deepcopy(template)

def prepare_answers(template, answers):
    template=validate_template(template)
    require(template["status"] == "published", "INVALID_REQUEST", "Only published checklist can be used")
    require(isinstance(answers, dict) and set(answers) <= {i["key"] for i in template["items"]}, "INVALID_REQUEST", "Unknown answers")
    normalized={}
    for item in template["items"]:
        key=item["key"]
        if item.get("required", False):require(key in answers and answers[key] is not None, "INVALID_REQUEST", "Required answer missing")
        if key not in answers:continue
        value=answers[key]
        typ=item["type"]
        if typ=="number":require(isinstance(value,(int,float)) and not isinstance(value,bool), "INVALID_REQUEST", "Number required")
        if typ=="pass_fail":require(value in ("pass","fail","na"), "INVALID_REQUEST", "Invalid judgement")
        if typ=="text":require(isinstance(value,str) and len(value)<=4000, "INVALID_REQUEST", "Invalid text")
        if typ=="choice":require(value in item["options"], "INVALID_REQUEST", "Unknown option")
        normalized[key]=deepcopy(value)
    return {"templateVersion": template["version"], "projectId":template["projectId"], "answers":normalized, "status":"draft"}

