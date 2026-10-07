"""Read-only, project-scoped projection of existing in-app notifications.

The module deliberately does not create notifications, send deliveries, evaluate
deadlines, or mutate workflow/receipt state. Read receipts are supplied by the
caller as a separate UI projection keyed by recipient/project/notification.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from collections.abc import Iterable, Mapping


class NotificationProjectionError(ValueError):
    """An in-scope notification cannot be safely projected."""


_REQUIRED_FIELDS = {
    "id",
    "projectId",
    "version",
    "createdAt",
    "updatedAt",
    "createdBy",
    "recipientPartyId",
    "sourceRef",
    "channel",
    "status",
    "dueAt",
    "retryCount",
}
_CHANNELS = {"in_app", "push", "email_adapter"}
_STATUSES = {"queued", "sent", "delivered", "acknowledged", "failed"}


def _parse_instant(value: object, field: str) -> datetime:
    if not isinstance(value, str):
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
    """
    if not isinstance(recipient_party_id, str) or not recipient_party_id:
        raise NotificationProjectionError("recipient_party_id is required")

    allowed_projects = frozenset(accessible_project_ids)
    receipts = read_receipts or {}
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
        if candidate.get("channel") != "in_app":
            continue

        missing = _REQUIRED_FIELDS.difference(candidate)
        if missing:
            raise NotificationProjectionError(f"notification is missing required fields: {', '.join(sorted(missing))}")
        if candidate.get("channel") not in _CHANNELS or candidate.get("status") not in _STATUSES:
            raise NotificationProjectionError("notification channel or status is outside the current contract")
        if not isinstance(candidate.get("sourceRef"), Mapping):
            raise NotificationProjectionError("notification sourceRef must be an object")
        if isinstance(candidate.get("version"), bool) or not isinstance(candidate.get("version"), int) or candidate["version"] < 1:
            raise NotificationProjectionError("notification version must be a positive integer")
        if isinstance(candidate.get("retryCount"), bool) or not isinstance(candidate.get("retryCount"), int) or candidate["retryCount"] < 0:
            raise NotificationProjectionError("notification retryCount must be a non-negative integer")

        created_at = _parse_instant(candidate["createdAt"], "createdAt")
        _parse_instant(candidate["dueAt"], "dueAt")
        key = (project_id, notification_id)
        record = deepcopy(dict(candidate))
        read_at = receipts.get((recipient_party_id, project_id, notification_id))
        if read_at is not None:
            _parse_instant(read_at, "readAt")

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
