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
from heapq import nsmallest
from collections.abc import Mapping
from app.reference.read_views import readonly
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
    readable: Callable[[Mapping[str, Any], dict[str, Any], dict[str, Any]], Any],
    preflight: Callable[[str, Mapping[str, Any], dict[str, Any], dict[str, Any]], list[dict[str, Any]]],
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    has_candidates: Callable[[str, Mapping[str, Any], dict[str, Any], dict[str, Any]], bool] | None = None,
) -> dict[str, Any]:
    """Build a page of records with existing command candidates for one role.

    readable is the existing API authorization guard. preflight is the
    existing engine-backed available-command projection, so a record appears
    only when the selected actor/role currently has at least one command
    candidate. A candidate is not a guarantee that work is ready or pending.
    The output intentionally preserves each machine's own status and candidate
    details rather than collapsing them into a new inbox state.

    Guard callbacks receive lazy read-only mappings during candidate exploration.
    Returned records are detached current reads. total is exact for this request;
    a cursor is a live keyset boundary, not a frozen snapshot across requests.
    Updates that cross the boundary can be missed/repeated until a fresh traversal.
    API callers hold a store transaction so authorization/sort/page reads agree.

    """
    if not isinstance(project_id, str) or not project_id:
        raise ValueError("project_id is required")
    if not isinstance(role, dict) or role.get("projectId") != project_id or role.get("active") is not True:
        raise ValueError("An active role assignment for this project is required")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_PAGE_SIZE:
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_SIZE}")

    after = _decode_cursor(cursor)
    # The production composition supplies a cheap authority/status membership
    # check. Compatibility callers without it must preflight to count matches,
    # but neither path deep-copies all records or retains all candidate payloads.
    total = 0

    def source_rows():
        adapter = getattr(engine, "iter_work_inbox_records", None)
        if adapter is not None:
            yield from adapter(project_id, INBOX_MACHINES)
            return
        for (kind, object_id), raw in engine._records.items():
            machine = engine._record_machines.get((kind, object_id))
            if machine in INBOX_MACHINES and raw.get("projectId") == project_id:
                yield kind, object_id, machine, readonly(raw)

    def eligible_entries():
        nonlocal total
        for kind, object_id, machine, record in source_rows():
            # Recheck project even when a future persistence adapter supplies rows.
            if machine not in INBOX_MACHINES or record.get("projectId") != project_id:
                continue
            try:
                readable(record, session, role)
            except ContractError as exc:
                if exc.code in _READ_DENIAL_CODES:
                    continue
                raise
            commands = None
            if has_candidates is None:
                commands = preflight(machine, record, session, role)
                if not commands:
                    continue
            elif not has_candidates(machine, record, session, role):
                continue
            total += 1
            updated_at = _updated_at(record)
            if after is not None and not (
                updated_at < after[0] or (updated_at == after[0] and object_id > after[1])
            ):
                continue
            yield updated_at, object_id, kind, machine, record.get("version"), commands

    # A streaming bounded heap retains at most limit+1 entries. Exact total still
    # requires examining visible project membership; it is not claimed to be O(limit).
    selected = nsmallest(limit + 1, eligible_entries(), key=lambda item: (-_micros(item[0]), item[1]))
    page = selected[:limit]
    has_more = len(selected) > limit
    next_cursor = _encode_cursor(page[-1][0], page[-1][1]) if has_more and page else None

    records = []
    for updated_at, object_id, kind, machine, version, commands in page:
        record = engine.get(kind, object_id)
        if (
            record.get("projectId") != project_id
            or record.get("version") != version
            or _updated_at(record) != updated_at
        ):
            raise ContractError("VERSION_CONFLICT", "Work inbox changed during projection; restart pagination")
        # Never return a record using only the earlier borrowed-view authorization.
        readable(record, session, role)
        if commands is None:
            commands = preflight(machine, record, session, role)
            if not commands:
                raise RuntimeError("has_candidates disagreed with preflight for a paged record")
        records.append(deepcopy({
            "machine": machine,
            "record": record,
            "commandCandidates": commands,
        }))

    return {
        "projectId": project_id,
        "roleAssignmentId": role["id"],
        "records": records,
        "total": total,
        "limit": limit,
        "nextCursor": next_cursor,
    }
