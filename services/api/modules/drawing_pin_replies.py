"""Conversation/reply stream for a drawing pin, separate from formal Issue approval."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
import json

from fastapi import Request
from app.reference.validation import ContractError, require

COMMENT_ROLES = frozenset({"ADM", "SUP", "CON", "OWN", "DES"})
MAX_MESSAGE = 4000


def install_sheet_pin_reply_routes(app, store, *, identity, context, sheet_for,
                                   visible_pins, key_for, audit):
    def authorized_pin(project_id, sheet_id, pin_id, actor, role):
        sheet_for(project_id, sheet_id, actor, role)
        # Linked formal records must pass their existing read gate; being
        # a participant in the project is insufficient for a hidden Issue.
        visible = visible_pins(project_id, sheet_id, actor, role)
        pin = next((row for row in visible if row["id"] == pin_id), None)
        require(pin is not None, "NOT_FOUND", "도면 핀이 없거나 조회 권한이 없습니다")
        return pin

    def get_thread(project_id, sheet_id, pin_id):
        return store.meta.get("drawingPinReplies", {}).get(project_id, {}).get(sheet_id, {}).get(pin_id, [])

    @app.get("/projects/{project_id}/drawing-sheets/{sheet_id}/pins/{pin_id}/replies")
    def list_replies(project_id: str, sheet_id: str, pin_id: str, request: Request):
        actor = identity(request)
        with store.transaction():
            role = context(project_id, request, actor)
            authorized_pin(project_id, sheet_id, pin_id, actor, role)
            items = deepcopy(get_thread(project_id, sheet_id, pin_id))
            return {"items": items, "count": len(items)}

    @app.post("/projects/{project_id}/drawing-sheets/{sheet_id}/pins/{pin_id}/replies")
    async def add_reply(project_id: str, sheet_id: str, pin_id: str, request: Request):
        actor = identity(request)
        key = key_for(request)
        try:
            body = await request.json()
        except ValueError as exc:
            raise ContractError("INVALID_REQUEST", "올바른 JSON 본문이 아닙니다") from exc
        require(isinstance(body, dict) and set(body) == {"message", "parentId"},
                "INVALID_REQUEST", "댓글과 답글 대상이 필요합니다")
        message, parent = body["message"], body["parentId"]
        require(isinstance(message, str) and 1 <= len(message.strip()) <= MAX_MESSAGE,
                "INVALID_REQUEST", "댓글은 1~4000자로 작성하십시오")
        require(parent is None or (isinstance(parent, str) and 1 <= len(parent) <= 100),
                "INVALID_REQUEST", "잘못된 답글 대상입니다")
        fingerprint = sha256(json.dumps({"sheetId": sheet_id, "pinId": pin_id, "body": body}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        request_key = "drawing-pin-reply:" + project_id + ":" + actor["partyId"] + ":" + key
        with store.transaction(write=True):
            role = context(project_id, request, actor)
            require(role["actorGroup"] in COMMENT_ROLES,
                    "NOT_AUTHORIZED", "도면 대화에 참여할 수 없습니다")
            authorized_pin(project_id, sheet_id, pin_id, actor, role)
            existing = store.requests.get(request_key)
            if existing:
                require(existing["hash"] == fingerprint, "IDEMPOTENCY_CONFLICT",
                        "동일한 요청 번호로 다른 댓글을 등록할 수 없습니다")
                return deepcopy(existing["result"])
            thread = store.meta.setdefault("drawingPinReplies", {}).setdefault(
                project_id, {}).setdefault(sheet_id, {}).setdefault(pin_id, [])
            if parent is not None:
                require(any(entry["id"] == parent for entry in thread),
                        "NOT_FOUND", "이 도면 이슈의 답글 대상이 아닙니다")
            party = store.engine.get("Party", actor["partyId"])
            now = store.engine.at()
            entry = {
                "id": str(uuid4()), "version": 1, "projectId": project_id,
                "sheetId": sheet_id, "pinId": pin_id, "parentId": parent,
                "message": message.strip(), "authorPartyId": actor["partyId"],
                "authorName": str(party.get("name") or "현장 관계자")[:100],
                "authorRole": role["actorGroup"], "createdAt": now,
                "kind": "discussion", "officialDecision": False,
            }
            thread.append(entry)
            audit(store, project_id, "drawing_pin_reply_created", actor, role, {
                "sheetId": sheet_id, "pinId": pin_id, "replyId": entry["id"],
                "parentId": parent,
            })
            result = {"reply": deepcopy(entry), "count": len(thread)}
            store.requests[request_key] = {"hash": fingerprint, "result": deepcopy(result)}
            return result
