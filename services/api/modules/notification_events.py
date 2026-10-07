"""Explicit in-app notification intent reconciliation and UI-only read receipts.

Audit events are not notification instructions by themselves. This module consumes
only explicit, persisted intents in Engine._notifications and requires each one to
reference an exact existing audit event and source version. It never synthesizes
contractual deadlines or changes delivery/acknowledgement state.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Mapping
from uuid import UUID, uuid5, NAMESPACE_URL

from app.reference.validation import ContractError, validate


MAX_RECONCILE = 500
RECEIPTS_KEY = "notificationReadReceipts"
DEDUPE_KEY = "notificationEventDedupe"


def _iso_now(engine):
    return engine.at()


def _uuid(value, field):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError(f"{field} must be a UUID") from exc


def _intent_entries(engine):
    intents = engine._notifications
    if not isinstance(intents, Mapping):
        raise ValueError("notification intents must be a mapping")
    return list(intents.items())


def _active_recipient_role(engine, project_id, recipient_id, role_id, now):
    role = engine.get("RoleAssignment", role_id)
    if (role.get("partyId") != recipient_id or role.get("projectId") != project_id
            or role.get("active") is not True
            or not (datetime.fromisoformat(role["validFrom"].replace("Z", "+00:00")) <= now
                    < datetime.fromisoformat(role["validTo"].replace("Z", "+00:00")))):
        raise PermissionError("recipient role is not active for this project")
    return role


def _matching_audit(engine, intent):
    event_id = intent.get("sourceEventId")
    if not event_id:
        raise ValueError("notification intent must identify sourceEventId")
    matches = [event for event in engine._audit if event.get("id") == event_id]
    if len(matches) != 1:
        raise PermissionError("notification source event is unavailable")
    event = matches[0]
    ref = intent.get("sourceRef")
    if (not isinstance(ref, dict) or event.get("projectId") != intent.get("projectId")
            or event.get("objectRef") != ref):
        raise PermissionError("notification source event reference does not match")
    return event


def reconcile_notification_events(store, *, limit=MAX_RECONCILE):
    """Create canonical queued in-app Notifications from verified audit events.

    Each event is addressed only to its recorded actor, using the event's own
    active role assignment. The fixed event channel is "내 업무 변경" and dueAt
    is the immutable event occurrence time; neither implies a delivery or a
    contractual deadline. Events whose exact historical source is not readable
    by that actor are skipped.
    """
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RECONCILE:
        raise ValueError(f"limit must be between 1 and {MAX_RECONCILE}")
    created = []
    with store.transaction(write=True):
        engine = store.engine
        dedupe = store.meta.setdefault(DEDUPE_KEY, {})
        if not isinstance(dedupe, dict):
            raise ValueError(f"{DEDUPE_KEY} must be an object")
        now_value = engine.at()
        now = datetime.fromisoformat(now_value.replace("Z", "+00:00"))
        audits = engine._audit
        cursor = store.meta.get("notificationEventCursor", 0)
        if not isinstance(cursor, int) or isinstance(cursor, bool) or cursor < 0:
            raise ValueError("notificationEventCursor must be a non-negative integer")
        if cursor >= len(audits):
            cursor = 0
        batch = audits[cursor:cursor + limit]
        store.meta["notificationEventCursor"] = 0 if cursor + len(batch) >= len(audits) else cursor + len(batch)
        for event in batch:
            recipient_id = event.get("actorPartyId")
            project_id = event.get("projectId")
            ref = event.get("objectRef")
            role_id = event.get("roleAssignmentId")
            if not all(isinstance(v, str) and v for v in (recipient_id, project_id, role_id)) or not isinstance(ref, dict):
                continue
            dedupe_key = f"{event['id']}:{recipient_id}"
            if dedupe_key in dedupe:
                continue
            try:
                _active_recipient_role(engine, project_id, recipient_id, role_id, now)
                source = engine.get(ref["objectType"], ref["objectId"], ref["version"])
                if source.get("projectId") != project_id:
                    continue
                engine.authorize_read(source, recipient_id, role_id)
            except (PermissionError, KeyError, ContractError):
                continue
            identifier = str(uuid5(NAMESPACE_URL, "doul-notification:" + dedupe_key))
            record = {
                "id": identifier,
                "projectId": project_id,
                "version": 1,
                "createdAt": now_value,
                "updatedAt": now_value,
                "createdBy": recipient_id,
                "recipientPartyId": recipient_id,
                "sourceRef": deepcopy(ref),
                "channel": "in_app",
                "status": "queued",
                "dueAt": event["at"],
                "retryCount": 0,
            }
            validate(record, engine.schemas["Notification"], engine.schemas, path="Notification")
            # Trusted generated records use the engine's persistence primitive;
            # no client CRUD route is exposed.
            engine._save("Notification", record)
            dedupe[dedupe_key] = identifier
            created.append(deepcopy(record))
    return created


def _receipt_key(recipient_id, project_id, notification_id):
    return f"{recipient_id}|{project_id}|{notification_id}"


def notification_receipts_for_projection(meta):
    """Adapt JSON-safe nested string keys to the inbox projector tuple map."""
    receipts = meta.get(RECEIPTS_KEY, {})
    if not isinstance(receipts, dict):
        raise ValueError(f"{RECEIPTS_KEY} must be an object")
    result = {}
    for key, read_at in receipts.items():
        parts = key.split("|")
        if len(parts) != 3:
            raise ValueError("invalid notification read receipt key")
        result[tuple(parts)] = read_at
    return result


def mark_notification_read(store, *, notification_id, recipient_party_id, project_id, accessible_project_ids, read_at=None):
    """Record an idempotent UI read timestamp, leaving Notification unchanged."""
    notification_id = _uuid(notification_id, "notification_id")
    recipient_party_id = _uuid(recipient_party_id, "recipient_party_id")
    project_id = _uuid(project_id, "project_id")
    if project_id not in set(accessible_project_ids):
        raise PermissionError("project is not accessible")
    with store.transaction(write=True):
        record = store.engine.get("Notification", notification_id)
        if record.get("projectId") != project_id or record.get("recipientPartyId") != recipient_party_id:
            raise PermissionError("notification is not accessible to this recipient")
        receipts = store.meta.setdefault(RECEIPTS_KEY, {})
        if not isinstance(receipts, dict):
            raise ValueError(f"{RECEIPTS_KEY} must be an object")
        key = _receipt_key(recipient_party_id, project_id, notification_id)
        if key not in receipts:
            value = read_at or _iso_now(store.engine)
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            receipts[key] = value
        return {"notificationId": notification_id, "readAt": receipts[key], "isRead": True}


def read_receipts_for_projection(store):
    """Expose durable receipts in the projector's required tuple-key format."""
    return notification_receipts_for_projection(store.meta)
