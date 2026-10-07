from copy import deepcopy
import unittest

from services.api.modules.notification_inbox import (
    NotificationProjectionError,
    project_notification_inbox,
)


RECIPIENT = "party-owner"
OTHER = "party-contractor"
PROJECT = "project-a"
OTHER_PROJECT = "project-b"
NOTIFICATION = {
    "id": "n-1",
    "projectId": PROJECT,
    "version": 1,
    "createdAt": "2026-10-07T08:00:00Z",
    "updatedAt": "2026-10-07T08:00:00Z",
    "createdBy": "party-supervisor",
    "recipientPartyId": RECIPIENT,
    "sourceRef": {"objectType": "InformationItem", "objectId": "report-1", "version": 2},
    "channel": "in_app",
    "status": "delivered",
    "dueAt": "2026-10-06T08:00:00+00:00",
    "retryCount": 0,
}


class NotificationInboxProjectionTests(unittest.TestCase):
    def project(self, records, **kwargs):
        return project_notification_inbox(
            records,
            recipient_party_id=RECIPIENT,
            accessible_project_ids={PROJECT},
            **kwargs,
        )

    def test_recipient_project_and_channel_scope_is_enforced(self):
        other_recipient = {**NOTIFICATION, "id": "n-other-party", "recipientPartyId": OTHER}
        other_project = {**NOTIFICATION, "id": "n-other-project", "projectId": OTHER_PROJECT}
        email = {**NOTIFICATION, "id": "n-email", "channel": "email_adapter"}

        result = self.project([NOTIFICATION, other_recipient, other_project, email])

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["notification"]["id"], "n-1")

    def test_read_receipt_is_recipient_scoped_and_does_not_acknowledge_or_mutate(self):
        original = deepcopy(NOTIFICATION)
        result = self.project(
            [NOTIFICATION],
            read_receipts={(RECIPIENT, PROJECT, "n-1"): "2026-10-07T09:00:00+07:00"},
        )

        item = result["items"][0]
        self.assertTrue(item["isRead"])
        self.assertEqual(item["readAt"], "2026-10-07T09:00:00+07:00")
        self.assertEqual(item["notification"]["status"], "delivered")
        self.assertNotIn("acknowledgedAt", item["notification"])
        self.assertEqual(NOTIFICATION, original)
        self.assertEqual(result["unreadCount"], 0)

    def test_deadline_is_preserved_without_overdue_classification(self):
        result = self.project([NOTIFICATION])
        item = result["items"][0]
        self.assertEqual(item["notification"]["dueAt"], NOTIFICATION["dueAt"])
        self.assertNotIn("overdue", item)
        self.assertNotIn("deadlineStatus", item)

    def test_order_is_newest_first_and_exact_duplicates_are_idempotent(self):
        older = {**NOTIFICATION, "id": "n-older", "createdAt": "2026-10-06T08:00:00Z"}
        result = self.project([older, NOTIFICATION, deepcopy(NOTIFICATION)])

        self.assertEqual([item["notification"]["id"] for item in result["items"]], ["n-1", "n-older"])
        self.assertEqual(result["total"], 2)

    def test_conflicting_duplicate_and_malformed_visible_record_are_rejected(self):
        conflict = {**NOTIFICATION, "reason": "changed"}
        with self.assertRaises(NotificationProjectionError):
            self.project([NOTIFICATION, conflict])

        malformed = {key: value for key, value in NOTIFICATION.items() if key != "sourceRef"}
        with self.assertRaises(NotificationProjectionError):
            self.project([malformed])

    def test_empty_authorized_scope_returns_no_records(self):
        result = project_notification_inbox(
            [NOTIFICATION],
            recipient_party_id=RECIPIENT,
            accessible_project_ids=(),
        )
        self.assertEqual(result, {"items": [], "total": 0, "unreadCount": 0})


if __name__ == "__main__":
    unittest.main()
