"""Authenticated, reversible raster-sheet markup records. Originals remain immutable."""
from __future__ import annotations
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
import json
import math
import re

from fastapi import Request
from app.reference.validation import ContractError, require

TOOLS = frozenset({"pen", "line", "arrow", "rectangle", "ellipse", "cloud", "text", "measure"})
WRITERS = frozenset({"ADM", "SUP", "CON"})
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_POINTS = 500


def _validate(body):
    require(isinstance(body, dict) and set(body) == {"sheetVersion", "tool", "points",
                "color", "lineWidth", "text"}, "INVALID_REQUEST", "Unexpected markup fields")
    require(type(body["sheetVersion"]) is int and body["sheetVersion"] > 0,
            "INVALID_REQUEST", "Current drawing version required")
    require(body["tool"] in TOOLS, "INVALID_REQUEST", "Unknown markup tool")
    require(isinstance(body["points"], list) and
            (2 <= len(body["points"]) <= MAX_POINTS if body["tool"] not in {"text"} else len(body["points"]) == 1),
            "INVALID_REQUEST", "Invalid markup point count")
    for point in body["points"]:
        require(isinstance(point, dict) and set(point) == {"x", "y"}
                and all(type(point.get(dim)) in (int, float)
                        and math.isfinite(point[dim]) and 0 <= point[dim] <= 1 for dim in ("x", "y")),
                "INVALID_REQUEST", "Markup coordinates must be normalized")
    require(isinstance(body["color"], str) and COLOR.fullmatch(body["color"]) is not None,
            "INVALID_REQUEST", "Markup color must be six-digit hex")
    require(type(body["lineWidth"]) in (float, int) and math.isfinite(body["lineWidth"])
            and 0.5 <= body["lineWidth"] <= 12, "INVALID_REQUEST", "Invalid line width")
    require(isinstance(body["text"], str) and len(body["text"]) <= 500,
            "INVALID_REQUEST", "Markup text too long")
    require(body["tool"] != "text" or body["text"].strip(),
            "INVALID_REQUEST", "Text markup requires content")


def install_sheet_markup_routes(app, store, *, identity, context, sheet_for, key_for, audit):
    def rows(project_id, sheet_id):
        return store.meta.setdefault("drawingSheetMarkups", {}).setdefault(project_id, {}).setdefault(sheet_id, {})

    @app.get("/projects/{project_id}/drawing-sheets/{sheet_id}/markups")
    def list_markups(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            sheet_for(project_id, sheet_id, actor, role)
            found = store.meta.get("drawingSheetMarkups", {}).get(project_id, {}).get(sheet_id, {})
            items = [deepcopy(x) for x in found.values() if x["status"] == "active"]
            return {"items": sorted(items, key=lambda x: x["createdAt"]), "count": len(items)}

    @app.post("/projects/{project_id}/drawing-sheets/{sheet_id}/markups")
    async def create_markup(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        key = key_for(request)
        body = await request.json()
        _validate(body)
        fingerprint = sha256(json.dumps({"sheetId": sheet_id, "body": body}, sort_keys=True).encode()).hexdigest()
        cache_key = f"sheet-markup:{project_id}:{actor['partyId']}:{key}"
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "Markup creation forbidden")
            cached = store.requests.get(cache_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return deepcopy(cached["result"])
            sheet = sheet_for(project_id, sheet_id, actor, role)
            require(sheet["status"] == "ready" and sheet["version"] == body["sheetVersion"],
                    "VERSION_CONFLICT", "Drawing sheet changed")
            now = store.engine.at()
            markup = dict(id=str(uuid4()), version=1, projectId=project_id, sheetId=sheet_id,
                          sheetVersion=sheet["version"], tool=body["tool"], points=deepcopy(body["points"]),
                          color=body["color"].lower(), lineWidth=float(body["lineWidth"]),
                          text=body["text"], status="active", createdAt=now,
                          updatedAt=now, createdByPartyId=actor["partyId"], createdByRole=role["actorGroup"])
            rows(project_id, sheet_id)[markup["id"]] = markup
            audit(store, project_id, "sheet_markup_created", actor, role,
                  {"sheetId": sheet_id, "markupId": markup["id"]})
            result = {"markup": deepcopy(markup)}
            store.requests[cache_key] = {"hash": fingerprint, "result": deepcopy(result)}
            return result

    @app.post("/projects/{project_id}/drawing-sheets/{sheet_id}/markups/{markup_id}/{action}")
    async def change_markup(project_id: str, sheet_id: str, markup_id: str, action: str, request: Request):
        require(action in {"archive", "restore"}, "INVALID_REQUEST", "Unknown markup action")
        actor = identity(request)
        key = key_for(request)
        body = await request.json()
        require(isinstance(body, dict) and set(body) == {"expectedVersion"}
                and type(body["expectedVersion"]) is int and body["expectedVersion"] > 0,
                "INVALID_REQUEST", "Markup version is required")
        cache_key = f"sheet-markup-{action}:{project_id}:{actor['partyId']}:{key}"
        fingerprint = sha256((sheet_id + ":" + markup_id + action + str(body["expectedVersion"])).encode()).hexdigest()
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED", "Markup editing forbidden")
            cached = store.requests.get(cache_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return deepcopy(cached["result"])
            sheet_for(project_id, sheet_id, actor, role)
            record = rows(project_id, sheet_id).get(markup_id)
            require(record is not None, "NOT_FOUND", "Markup not found")
            require(record["version"] == body["expectedVersion"], "VERSION_CONFLICT", "Markup changed")
            target_status = "archived" if action == "archive" else "active"
            require(record["status"] != target_status, "INVALID_REQUEST", "Markup already has that status")
            record["version"] += 1
            record["status"] = target_status
            record["updatedAt"] = store.engine.at()
            audit(store, project_id, f"sheet_markup_{action}", actor, role,
                  {"sheetId": sheet_id, "markupId": markup_id, "version": record["version"]})
            result = {"markup": deepcopy(record)}
            store.requests[cache_key] = {"hash": fingerprint, "result": deepcopy(result)}
            return result
