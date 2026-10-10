"""Read-only, project-scoped projection of existing in-app notifications.

The module deliberately does not create notifications, send deliveries, evaluate
deadlines, or mutate workflow/receipt state. Read receipts are supplied by the
caller as a separate UI projection keyed by recipient/project/notification.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from collections.abc import Iterable, Mapping
import json
from pathlib import Path
import re

from app.reference.validation import ContractError, validate


class NotificationProjectionError(ValueError):
    """An in-scope notification cannot be safely projected."""


_TIMESTAMP_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")

_SCHEMA_PATH = Path(__file__).resolve().parents[3] / "app" / "schema" / "domain_schemas_v2.json"
_SCHEMA_DOCUMENT = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
_SCHEMAS = _SCHEMA_DOCUMENT["components"]["schemas"]
_NOTIFICATION_SCHEMA = _SCHEMAS["Notification"]


def _parse_instant(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not _TIMESTAMP_RE.fullmatch(value):
        raise NotificationProjectionError(f"{field} must be an RFC3339 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise NotificationProjectionError(f"{field} must be an RFC3339 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise NotificationProjectionError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def project_notification_inbox(
    notifications: Iterable[Mapping[str, object]],
    *,
    recipient_party_id: str,
    accessible_project_ids: Iterable[str],
    read_receipts: Mapping[tuple[str, str, str], str] | None = None,
) -> dict[str, object]:
    """Return recipient-scoped in-app notifications in a stable newest-first order.

    `read_receipts` uses keys (recipientPartyId, projectId, notificationId).
    A receipt only decorates the projection; it never changes the Notification
    status or its acknowledgedAt field. The caller must provide projects already
    authorized for this recipient; an empty set yields an empty inbox.
    Structurally valid receipts outside that recipient/project scope are ignored
    before readAt validation; unscopable keys and malformed in-scope receipts
    remain errors, even when their notification is not visible.
    """
    if not isinstance(recipient_party_id, str) or not recipient_party_id:
        raise NotificationProjectionError("recipient_party_id is required")

    if isinstance(accessible_project_ids, (str, bytes)):
        raise NotificationProjectionError("accessible_project_ids must be an iterable of project ids, not a string")
    try:
        allowed_projects = frozenset(accessible_project_ids)
    except TypeError as error:
        raise NotificationProjectionError("accessible_project_ids must be an iterable of project ids") from error
    if any(not isinstance(project_id, str) or not project_id for project_id in allowed_projects):
        raise NotificationProjectionError("accessible_project_ids must contain non-empty strings")

    supplied_receipts = {} if read_receipts is None else read_receipts
    if not isinstance(supplied_receipts, Mapping):
        raise NotificationProjectionError("read_receipts must be a mapping")
    receipts: dict[tuple[str, str, str], str] = {}
    for key, read_at in supplied_receipts.items():
        if (
            not isinstance(key, tuple)
            or len(key) != 3
            or any(not isinstance(part, str) or not part for part in key)
        ):
            raise NotificationProjectionError("read receipt keys must be (recipientPartyId, projectId, notificationId)")
        # Invalid structural keys cannot establish a safe tenant scope.
        # Valid keys are scoped before validating their receipt content, so a
        # different recipient/project's corrupt timestamp cannot break this inbox.
        if key[0] != recipient_party_id or key[1] not in allowed_projects:
            continue
        _parse_instant(read_at, "readAt")
        receipts[key] = read_at

    visible: dict[tuple[str, str], tuple[datetime, dict[str, object], str | None]] = {}

    for candidate in notifications:
        if not isinstance(candidate, Mapping):
            raise NotificationProjectionError("notification must be an object")

        notification_id = candidate.get("id")
        project_id = candidate.get("projectId")
        candidate_recipient = candidate.get("recipientPartyId")
        if not all(isinstance(value, str) and value for value in (notification_id, project_id, candidate_recipient)):
            raise NotificationProjectionError("notification id, projectId and recipientPartyId are required")

        # Establish tenant and recipient scope before reading other fields.
        if candidate_recipient != recipient_party_id or project_id not in allowed_projects:
            continue
        channel = candidate.get("channel")
        if channel in ("push", "email_adapter"):
            continue
        if channel != "in_app":
            raise NotificationProjectionError("notification channel is outside the current contract")

        record = dict(candidate)
        try:
            validate(record, _NOTIFICATION_SCHEMA, _SCHEMAS, path="Notification")
        except ContractError as error:
            raise NotificationProjectionError(f"notification does not match the Notification DTO: {error}") from error

        created_at = _parse_instant(record["createdAt"], "createdAt")
        key = (project_id, notification_id)
        record = deepcopy(record)
        read_at = receipts.get((recipient_party_id, project_id, notification_id))

        prior = visible.get(key)
        if prior is not None:
            if prior[1] != record:
                raise NotificationProjectionError("conflicting duplicate notification id in project scope")
            continue
        visible[key] = (created_at, record, read_at)

    ordered = sorted(
        visible.values(),
        key=lambda item: (-item[0].timestamp(), item[1]["id"]),
    )
    items = [
        {
            "notification": record,
            "isRead": read_at is not None,
            "readAt": read_at,
        }
        for _, record, read_at in ordered
    ]
    return {
        "items": items,
        "total": len(items),
        "unreadCount": sum(1 for item in items if not item["isRead"]),
    }
