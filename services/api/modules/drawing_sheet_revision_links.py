"""Explicit drawing-sheet revision links; never assert approval or replace source PDFs."""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
import json
import re

from fastapi import Request
from app.reference.validation import ContractError, require

REVISION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$")
WRITERS = frozenset({"ADM", "SUP"})


def install_sheet_revision_routes(app, store, *, identity, context, sheet_for, set_for,
                                  key_for, audit):
    def revisions(project_id):
        return store.meta.get("drawingSheetRevisionLinks", {}).get(project_id, {})

    def identity_number(sheet):
        number = sheet["number"].strip()
        require(number and not number.lower().startswith("sheet-")
                and number != "미확인", "INVALID_REQUEST",
                "Confirm the original drawing number for both pages before linking revisions")
        return number.casefold()

    def projected(project_id, entry, actor, role):
        """Report identity drift without modifying an immutable revision link."""
        value = deepcopy(entry)
        before = sheet_for(project_id, entry["fromSheetId"], actor, role)
        after = sheet_for(project_id, entry["toSheetId"], actor, role)
        number = entry["drawingNumber"].strip().casefold()
        value["metadataConsistent"] = all(
            sheet["number"].strip().casefold() == number
            for sheet in (before, after))
        value["sourceHashesConsistent"] = (
            set_for(project_id, before["setId"])["sha256"] == entry["fromPdfHash"]
            and set_for(project_id, after["setId"])["sha256"] == entry["toPdfHash"])
        return value

    @app.get("/projects/{project_id}/drawing-sheet-revisions")
    def list_sheet_revisions(project_id: str, request: Request, sheetId: str | None = None):
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            if sheetId is not None:
                sheet_for(project_id, sheetId, actor, role)
            records = revisions(project_id).values()
            if sheetId is not None:
                # Resolve the complete predecessor/successor chain for this sheet.
                related = {sheetId}
                links = list(records)
                while True:
                    size = len(related)
                    for edge in links:
                        if edge["fromSheetId"] in related or edge["toSheetId"] in related:
                            related.update((edge["fromSheetId"], edge["toSheetId"]))
                    if len(related) == size:
                        break
                records = [edge for edge in links if edge["fromSheetId"] in related]
            return {"items": sorted((projected(project_id, edge, actor, role) for edge in records),
                                    key=lambda row: (row["createdAt"], row["id"])),
                    "count": len(records)}

    @app.post("/projects/{project_id}/drawing-sheet-revisions", status_code=201)
    async def link_sheet_revisions(project_id: str, request: Request):
        actor = identity(request)
        key = key_for(request)
        require(isinstance(key, str) and 1 <= len(key) <= 160, "IDEMPOTENCY_KEY_INVALID",
                "Idempotency key required")
        try:
            body = await request.json()
        except ValueError as exc:
            raise ContractError("INVALID_REQUEST", "Malformed revision link JSON") from exc
        fields = {"fromSheetId", "toSheetId", "previousRevision", "newRevision",
                  "expectedFromVersion", "expectedToVersion", "note"}
        require(isinstance(body, dict) and set(body) == fields, "INVALID_REQUEST",
                "Explicit predecessor, successor, labels and versions required")
        for name in ("fromSheetId", "toSheetId"):
            require(isinstance(body[name], str) and 1 <= len(body[name]) <= 100,
                    "INVALID_REQUEST", "Invalid sheet ID")
        require(body["fromSheetId"] != body["toSheetId"], "INVALID_REQUEST", "Same sheet")
        for name in ("expectedFromVersion", "expectedToVersion"):
            require(type(body[name]) is int and body[name] > 0,
                    "INVALID_REQUEST", "Expected sheet version required")
        for name in ("previousRevision", "newRevision"):
            require(isinstance(body[name], str) and REVISION.fullmatch(body[name]) is not None,
                    "INVALID_REQUEST", "Version labels must be explicit")
        require(body["previousRevision"].casefold() != body["newRevision"].casefold(),
                "INVALID_REQUEST", "Version labels must differ")
        require(isinstance(body["note"], str) and 0 < len(body["note"].strip()) <= 500,
                "INVALID_REQUEST", "Revision rationale is required")
        fingerprint = sha256(json.dumps(body, sort_keys=True,
                    ensure_ascii=False).encode("utf-8")).hexdigest()
        request_key = "drawing-revision:" + project_id + ":" + actor["partyId"] + ":" + key

        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in WRITERS, "NOT_AUTHORIZED",
                    "Only project administrator or supervision can link drawing revisions")
            cached = store.requests.get(request_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return deepcopy(cached["result"])
            former = sheet_for(project_id, body["fromSheetId"], actor, role)
            later = sheet_for(project_id, body["toSheetId"], actor, role)
            require(former["status"] == later["status"] == "ready",
                    "INVALID_REQUEST", "Both pages must be ready")
            require(former["version"] == body["expectedFromVersion"] and
                    later["version"] == body["expectedToVersion"], "VERSION_CONFLICT",
                    "Sheet metadata changed; verify both drawing versions")
            require(identity_number(former) == identity_number(later), "INVALID_REQUEST",
                    "Drawing numbers differ; explicit matching page number required")
            former_set = set_for(project_id, former["setId"])
            later_set = set_for(project_id, later["setId"])
            require(former["setId"] != later["setId"] and
                    former_set["sha256"] != later_set["sha256"],
                    "INVALID_REQUEST", "A revision must reference a different original PDF")
            require(later.get("revision") in ("초안", "draft", "unverified", body["newRevision"]) and
                    former.get("revision") in ("초안", "draft", "unverified", body["previousRevision"]),
                    "VERSION_CONFLICT", "Confirmed drawing version conflicts with selected labels")
            entries = list(revisions(project_id).values())
            require(not any(row["fromSheetId"] == former["id"] for row in entries),
                    "VERSION_CONFLICT", "The predecessor already has a successor")
            require(not any(row["toSheetId"] == later["id"] for row in entries),
                    "VERSION_CONFLICT", "The target already has a predecessor")
            for existing in entries:
                if existing["toSheetId"] == former["id"]:
                    require(existing["drawingNumber"].strip().casefold() == identity_number(former),
                            "VERSION_CONFLICT", "Predecessor number changed after prior revision")
                    require(existing["newRevision"] == body["previousRevision"],
                            "VERSION_CONFLICT", "Previous revision label differs from history")
                if existing["fromSheetId"] == later["id"]:
                    require(existing["drawingNumber"].strip().casefold() == identity_number(later),
                            "VERSION_CONFLICT", "Successor number changed after prior revision")
                    require(existing["previousRevision"] == body["newRevision"],
                            "VERSION_CONFLICT", "Next revision label differs from history")
            ancestor = former["id"]
            previous_by_target = {edge["toSheetId"]: edge["fromSheetId"] for edge in entries}
            while ancestor in previous_by_target:
                ancestor = previous_by_target[ancestor]
                require(ancestor != later["id"], "VERSION_CONFLICT", "Cyclic revision history")
            now = store.engine.at()
            link = dict(id=str(uuid4()), projectId=project_id, version=1,
                        fromSheetId=former["id"], toSheetId=later["id"],
                        drawingNumber=former["number"].strip(),
                        previousRevision=body["previousRevision"], newRevision=body["newRevision"],
                        note=body["note"].strip(), createdAt=now,
                        createdByPartyId=actor["partyId"], createdByRole=role["actorGroup"],
                        fromPdfHash=former_set["sha256"], toPdfHash=later_set["sha256"],
                        classification="DRAFT_REVISION_LINK_NOT_APPROVED")
            store.meta.setdefault("drawingSheetRevisionLinks", {}).setdefault(project_id, {})[
                link["id"]] = link
            audit(store, project_id, "sheet_revision_linked", actor, role, {
                "linkId": link["id"], "fromSheetId": former["id"],
                "toSheetId": later["id"], "previousRevision": link["previousRevision"],
                "newRevision": link["newRevision"]})
            response = {"link": deepcopy(link)}
            store.requests[request_key] = {"hash": fingerprint, "result": deepcopy(response)}
            return response
