from services.api.store import SQLiteSnapshotAdapter
from services.api.modules.notification_events import (
    mark_notification_read,
    notification_receipts_for_projection,
    reconcile_notification_events,
)
from services.api.modules.notification_inbox import project_notification_inbox


def test_audit_events_create_actor_scoped_queued_notifications_and_dedupe_after_restart(tmp_path):
    db = str(tmp_path / "notifications.sqlite")
    store = SQLiteSnapshotAdapter(db, demo=True)
    first = reconcile_notification_events(store)
    assert first
    assert all(row["channel"] == "in_app" and row["status"] == "queued" for row in first)
    assert all(row["dueAt"] == next(e["at"] for e in store.engine._audit if e["id"] + ":" + e["actorPartyId"] in store.meta["notificationEventDedupe"] and e["actorPartyId"] == row["recipientPartyId"] and e["objectRef"] == row["sourceRef"]) for row in first)

    recipient = first[0]["recipientPartyId"]
    project = first[0]["projectId"]
    projection = project_notification_inbox(
        [record for (kind, _), record in store.engine._records.items() if kind == "Notification"],
        recipient_party_id=recipient,
        accessible_project_ids=[project],
        read_receipts=notification_receipts_for_projection(store.meta),
    )
    assert projection["items"]
    assert all(item["notification"]["recipientPartyId"] == recipient for item in projection["items"])

    original_status = store.engine.get("Notification", first[0]["id"])["status"]
    receipt = mark_notification_read(
        store,
        notification_id=first[0]["id"],
        recipient_party_id=recipient,
        project_id=project,
        accessible_project_ids=[project],
        read_at="2026-10-07T14:00:00Z",
    )
    repeated = mark_notification_read(
        store,
        notification_id=first[0]["id"],
        recipient_party_id=recipient,
        project_id=project,
        accessible_project_ids=[project],
        read_at="2026-10-07T15:00:00Z",
    )
    assert repeated["readAt"] == receipt["readAt"]
    assert store.engine.get("Notification", first[0]["id"])["status"] == original_status == "queued"
    store.close()

    restored = SQLiteSnapshotAdapter(db, demo=True)
    assert reconcile_notification_events(restored) == []
    assert restored.engine.get("Notification", first[0]["id"])["status"] == "queued"
    assert notification_receipts_for_projection(restored.meta)[(recipient, project, first[0]["id"])] == receipt["readAt"]
    restored.close()
