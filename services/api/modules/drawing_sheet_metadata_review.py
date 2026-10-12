"""Human verification of automatically extracted drawing identities (not release approval)."""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json

from fastapi import Request
from app.reference.validation import ContractError, require


REVIEWERS = frozenset({"ADM", "SUP"})
DECISIONS = frozenset({"verified", "needs_review"})


def install_sheet_metadata_review_routes(app, store, *, identity, context, sheet_for,
                                        set_for, key_for, audit):
    @app.post("/projects/{project_id}/drawing-sheets/{sheet_id}/metadata-review")
    async def review_sheet_metadata(project_id: str, sheet_id: str, request: Request):
        actor = identity(request)
        key = key_for(request)
        require(isinstance(key, str) and 0 < len(key) <= 160,
                "IDEMPOTENCY_KEY_INVALID", "A unique review request key is required")
        try:
            body = await request.json()
        except ValueError as exc:
            raise ContractError("INVALID_REQUEST", "Invalid review JSON") from exc
        require(isinstance(body, dict) and set(body) ==
                {"expectedVersion", "decision", "number", "title", "note"},
                "INVALID_REQUEST", "Required fields: expectedVersion, decision, number, title, note")
        require(type(body["expectedVersion"]) is int and body["expectedVersion"] > 0,
                "INVALID_REQUEST", "Positive expected sheet version required")
        require(body["decision"] in DECISIONS, "INVALID_REQUEST", "Unknown review decision")
        for field, maximum in (("number", 60), ("title", 220)):
            require(isinstance(body[field], str) and
                    0 < len(body[field].strip()) <= maximum and
                    not any(ord(char) < 32 for char in body[field]),
                    "INVALID_REQUEST", "Invalid drawing "+field)
        require(isinstance(body["note"], str) and
                2 <= len(body["note"].strip()) <= 500,
                "INVALID_REQUEST", "Review source or reason is required")
        if body["decision"] == "verified":
            require(not body["number"].strip().lower().startswith("sheet-"),
                    "INVALID_REQUEST", "Placeholder numbers cannot be verified")
        fingerprint = sha256(json.dumps(
            {"sheetId": sheet_id, "body": body}, sort_keys=True,
            ensure_ascii=False).encode("utf-8")).hexdigest()
        cache_key = ("drawing-metadata-review:" + project_id + ":" +
                     actor["partyId"] + ":" + key)
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in REVIEWERS, "NOT_AUTHORIZED",
                    "Only site administrators or supervisors can verify extracted drawing metadata")
            cached = store.requests.get(cache_key)
            if cached:
                require(cached["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT", "Request changed")
                return deepcopy(cached["result"])
            sheet = sheet_for(project_id, sheet_id)
            require(sheet["status"] == "ready", "INVALID_REQUEST", "Raster page not ready")
            require(sheet["version"] == body["expectedVersion"],
                    "VERSION_CONFLICT", "Sheet metadata has changed")
            drawing_set = set_for(project_id, sheet["setId"])
            require(drawing_set["status"] == "ready", "INVALID_REQUEST", "Source PDF is not ready")
            old = {"number": sheet["number"], "title": sheet["title"],
                   "review": deepcopy(sheet.get("metadataReview"))}
            decision = body["decision"]
            number, title = body["number"].strip(), body["title"].strip()
            if decision == "needs_review":
                require(number == sheet["number"] and title == sheet["title"],
                        "INVALID_REQUEST", "Flag for review without changing drawing identity")
            else:
                sheet["number"] = number
                sheet["title"] = title
            now = store.engine.at()
            sheet["version"] += 1
            sheet["updatedAt"] = now
            sheet["metadataReview"] = {
                "status": decision,
                "reviewedAt": now,
                "reviewedByPartyId": actor["partyId"],
                "reviewedByRole": role["actorGroup"],
                "sourcePdfHash": drawing_set["sha256"],
                "extractedNumber": sheet.get("extractedNumber"),
                "extractedTitle": sheet.get("extractedTitle"),
                "note": body["note"].strip(),
            }
            audit(store, project_id, "sheet_metadata_reviewed", actor, role, {
                "sheetId": sheet_id, "version": sheet["version"],
                "decision": decision, "sourcePdfHash": drawing_set["sha256"],
                "before": old, "number": sheet["number"], "title": sheet["title"],
            })
            result = {"sheet": deepcopy({k: v for k, v in sheet.items()
                                        if k not in {"thumbBlobId", "previewBlobId"}})}
            result["sheet"]["hasPreview"] = bool(sheet.get("previewBlobId"))
            result["sheet"]["hasThumb"] = bool(sheet.get("thumbBlobId"))
            store.requests[cache_key] = {"hash": fingerprint, "result": deepcopy(result)}
            return result
