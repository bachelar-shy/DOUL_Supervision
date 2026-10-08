"""Persistence and read-receipt checks for the S5 in-app notification slice."""
import tempfile
import unittest
from pathlib import Path

from services.api.store import SQLiteSnapshotAdapter
from services.api.modules.notification_events import (
    mark_notification_read,
    notification_receipts_for_projection,
    reconcile_notification_events,
)
from services.api.modules.notification_inbox import project_notification_inbox


class NotificationEventsTests(unittest.TestCase):
    def test_audit_events_create_actor_scoped_notifications_and_receipts_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / "notifications.sqlite")
            store = SQLiteSnapshotAdapter(db, demo=True)
            try:
                first = reconcile_notification_events(store)
                self.assertTrue(first)
                self.assertTrue(all(row["channel"] == "in_app" and row["status"] == "queued" for row in first))
                events_by_id = {event["id"]: event for event in store.engine._audit}
                for row in first:
                    event = next(
                        event for event in events_by_id.values()
                        if event["actorPartyId"] == row["recipientPartyId"]
                        and event["objectRef"] == row["sourceRef"]
                        and event["at"] == row["dueAt"]
                    )
                    self.assertEqual(event["projectId"], row["projectId"])

                recipient = first[0]["recipientPartyId"]
                project = first[0]["projectId"]
                projection = project_notification_inbox(
                    [record for (kind, _), record in store.engine._records.items() if kind == "Notification"],
                    recipient_party_id=recipient,
                    accessible_project_ids=[project],
                    read_receipts=notification_receipts_for_projection(store.meta),
                )
                self.assertTrue(projection["items"])
                self.assertTrue(all(item["notification"]["recipientPartyId"] == recipient for item in projection["items"]))

                notification_id = first[0]["id"]
                receipt = mark_notification_read(
                    store,
                    notification_id=notification_id,
                    recipient_party_id=recipient,
                    project_id=project,
                    accessible_project_ids=[project],
                    read_at="2026-10-07T14:00:00Z",
                )
                repeated = mark_notification_read(
                    store,
                    notification_id=notification_id,
                    recipient_party_id=recipient,
                    project_id=project,
                    accessible_project_ids=[project],
                    read_at="2026-10-07T15:00:00Z",
                )
                self.assertEqual(repeated["readAt"], receipt["readAt"])
                self.assertEqual(store.engine.get("Notification", notification_id)["status"], "queued")
            finally:
                store.close()

            restored = SQLiteSnapshotAdapter(db, demo=True)
            try:
                self.assertEqual(reconcile_notification_events(restored), [])
                self.assertEqual(restored.engine.get("Notification", notification_id)["status"], "queued")
                self.assertEqual(
                    notification_receipts_for_projection(restored.meta)[(recipient, project, notification_id)],
                    receipt["readAt"],
                )
            finally:
                restored.close()


if __name__ == "__main__":
    unittest.main()
