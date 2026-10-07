"""Role-scoped, paginated projection over existing authoritative work records.

The API caller must resolve the active project role and supply the same
readable and preflight functions used by detail/workspace endpoints.
This module adds no workflow state, deadline interpretation, or commands.
"""
from __future__ import annotations

import base64
import binascii
from copy import deepcopy
from datetime import datetime, timezone
import json
from typing import Callable, Any

from app.reference.validation import ContractError, instant


INBOX_MACHINES = frozenset(
    {
        "inspection",
        "issue",
        "action",
        "report",
        "decision",
        "safety_permit",
        "safety_stop_order",
        "safety_equipment_inspection",
    }
)
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
_READ_DENIAL_CODES = frozenset(
    {
        "NOT_AUTHORIZED",
        "NOT_FOUND",
        "SCOPE_MISMATCH",
        "ORGANIZATION_MISMATCH",
        "QUALIFICATION_INVALID",
    }
)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


class InboxCursorError(ValueError):
    """The pagination cursor is malformed or incompatible with this projection."""


def _updated_at(record: dict[str, Any]) -> datetime:
    value = record.get("updatedAt") or record.get("createdAt")
    if not isinstance(value, str):
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        return instant(value)
    except ContractError:
        # Legacy/imported records without a valid timestamp remain visible and
        # sort after dated records; they are never assigned an invented date.
        return datetime.min.replace(tzinfo=timezone.utc)


def _micros(value: datetime) -> int:
    delta = value - _EPOCH
    return delta.days * 86_400_000_000 + delta.seconds * 1_000_000 + delta.microseconds


def _encode_cursor(updated_at: datetime, object_id: str) -> str:
    payload = json.dumps(
        {"updatedAt": updated_at.isoformat().replace("+00:00", "Z"), "id": object_id},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if cursor is None:
        return None
    if not isinstance(cursor, str) or not cursor or len(cursor) > 1024:
        raise InboxCursorError("Invalid work inbox cursor")
    try:
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"updatedAt", "id"}:
            raise ValueError
        if not isinstance(payload["updatedAt"], str) or not isinstance(payload["id"], str) or not payload["id"]:
            raise ValueError
        return instant(payload["updatedAt"]), payload["id"]
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, ContractError, ValueError, TypeError) as exc:
        raise InboxCursorError("Invalid work inbox cursor") from exc


def build_work_inbox(
    engine: Any,
    project_id: str,
    session: dict[str, Any],
    role: dict[str, Any],
    *,
    readable: Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], Any],
    preflight: Callable[[str, dict[str, Any], dict[str, Any], dict[str, Any]], list[dict[str, Any]]],
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
) -> dict[str, Any]:
    """Build a page of records with existing command candidates for one role.

    readable is the existing API authorization guard. preflight is the
    existing engine-backed available-command projection, so a record appears
    only when the selected actor/role currently has at least one command
    candidate. A candidate is not a guarantee that work is ready or pending.
    The output intentionally preserves each machine's own status and candidate
    details rather than collapsing them into a new inbox state.
    """
    if not isinstance(project_id, str) or not project_id:
        raise ValueError("project_id is required")
    if not isinstance(role, dict) or role.get("projectId") != project_id or role.get("active") is not True:
        raise ValueError("An active role assignment for this project is required")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_PAGE_SIZE:
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_SIZE}")

    after = _decode_cursor(cursor)
    candidates: list[tuple[datetime, str, dict[str, Any]]] = []

    for (kind, object_id), raw_record in engine._records.items():
        machine = engine._record_machines.get((kind, object_id))
        if machine not in INBOX_MACHINES or raw_record.get("projectId") != project_id:
            continue

        record = engine.get(kind, object_id)
        try:
            readable(record, session, role)
        except ContractError as exc:
            # The engine deliberately uses NOT_FOUND to conceal records that
            # exist but are not visible to this role. Other contract errors
            # indicate a broken callback or record and must remain observable.
            if exc.code in _READ_DENIAL_CODES:
                continue
            raise

        command_candidates = preflight(machine, record, session, role)
        if not command_candidates:
            continue

        updated_at = _updated_at(record)
        candidates.append(
            (
                updated_at,
                object_id,
                {
                    "machine": machine,
                    "record": deepcopy(record),
                    "commandCandidates": deepcopy(command_candidates),
                },
            )
        )

    candidates.sort(key=lambda item: (-_micros(item[0]), item[1]))
    total = len(candidates)
    if after is not None:
        after_updated_at, after_id = after
        candidates = [
            item
            for item in candidates
            if item[0] < after_updated_at
            or (item[0] == after_updated_at and item[1] > after_id)
        ]
    page = candidates[:limit]
    next_cursor = _encode_cursor(page[-1][0], page[-1][1]) if len(candidates) > limit and page else None

    return {
        "projectId": project_id,
        "roleAssignmentId": role["id"],
        "records": [item for _, _, item in page],
        "total": total,
        "limit": limit,
        "nextCursor": next_cursor,
    }
