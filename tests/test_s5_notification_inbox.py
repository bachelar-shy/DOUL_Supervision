from copy import deepcopy
import unittest

from services.api.modules.notification_inbox import (
    NotificationProjectionError,
    project_notification_inbox,
)


RECIPIENT = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
PROJECT = "00000000-0000-4000-8000-000000000003"
OTHER_PROJECT = "00000000-0000-4000-8000-000000000004"
NOTIFICATION_ID = "00000000-0000-4000-8000-000000000005"
OLDER_NOTIFICATION_ID = "00000000-0000-4000-8000-000000000006"
NOTIFICATION = {
    "id": NOTIFICATION_ID,
    "projectId": PROJECT,
    "version": 1,
    "createdAt": "2026-10-07T08:00:00Z",
    "updatedAt": "2026-10-07T08:00:00Z",
    "createdBy": "00000000-0000-4000-8000-000000000007",
    "recipientPartyId": RECIPIENT,
    "sourceRef": {"objectType": "InformationItem", "objectId": "00000000-0000-4000-8000-000000000008", "version": 2},
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
        other_recipient = {**NOTIFICATION, "id": "00000000-0000-4000-8000-000000000009", "recipientPartyId": OTHER}
        other_project = {**NOTIFICATION, "id": "00000000-0000-4000-8000-000000000010", "projectId": OTHER_PROJECT}
        email = {**NOTIFICATION, "id": "00000000-0000-4000-8000-000000000011", "channel": "email_adapter"}

        result = self.project([NOTIFICATION, other_recipient, other_project, email])

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["notification"]["id"], NOTIFICATION_ID)

    def test_read_receipt_is_recipient_scoped_and_does_not_acknowledge_or_mutate(self):
        original = deepcopy(NOTIFICATION)
        result = self.project(
            [NOTIFICATION],
            read_receipts={(RECIPIENT, PROJECT, NOTIFICATION_ID): "2026-10-07T09:00:00+07:00"},
        )

        item = result["items"][0]
        self.assertTrue(item["isRead"])
        self.assertEqual(item["readAt"], "2026-10-07T09:00:00+07:00")
        self.assertEqual(item["notification"]["status"], "delivered")
        self.assertNotIn("acknowledgedAt", item["notification"])
        self.assertEqual(NOTIFICATION, original)
        self.assertEqual(result["unreadCount"], 0)

    def test_foreign_recipient_malformed_receipt_is_isolated(self):
        foreign = {**NOTIFICATION, "recipientPartyId": OTHER}
        receipts = {(OTHER, PROJECT, NOTIFICATION_ID): "not-a-timestamp"}
        result = self.project([NOTIFICATION, foreign], read_receipts=receipts)

        self.assertEqual(result, self.project([NOTIFICATION]))
        self.assertFalse(result["items"][0]["isRead"])
        self.assertIsNone(result["items"][0]["readAt"])
        self.assertEqual(receipts[(OTHER, PROJECT, NOTIFICATION_ID)], "not-a-timestamp")

    def test_foreign_project_malformed_receipt_is_isolated(self):
        foreign = {**NOTIFICATION, "projectId": OTHER_PROJECT}
        result = self.project(
            [NOTIFICATION, foreign],
            read_receipts={
                (RECIPIENT, OTHER_PROJECT, NOTIFICATION_ID): "not-a-timestamp",
                (OTHER, OTHER_PROJECT, NOTIFICATION_ID): None,
                (RECIPIENT, PROJECT, NOTIFICATION_ID): "2026-10-07T09:00:00Z",
            },
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["unreadCount"], 0)
        item = result["items"][0]
        self.assertEqual(item["notification"], NOTIFICATION)
        self.assertEqual(item["readAt"], "2026-10-07T09:00:00Z")
        self.assertNotIn("acknowledgedAt", item["notification"])

    def test_in_scope_malformed_receipt_without_visible_notification_still_fails(self):
        with self.assertRaisesRegex(NotificationProjectionError, "readAt"):
            self.project([], read_receipts={(RECIPIENT, PROJECT, NOTIFICATION_ID): "not-a-timestamp"})

    def test_unscopable_foreign_structural_receipt_keys_still_fail(self):
        for key in ((OTHER, OTHER_PROJECT), (OTHER, OTHER_PROJECT, ""), (OTHER, None, NOTIFICATION_ID)):
            with self.subTest(key=key), self.assertRaisesRegex(NotificationProjectionError, "read receipt keys"):
                self.project([NOTIFICATION], read_receipts={key: "not-a-timestamp"})

    def test_empty_authorized_scope_ignores_valid_foreign_keys_content(self):
        result = project_notification_inbox(
            [NOTIFICATION],
            recipient_party_id=RECIPIENT,
            accessible_project_ids=(),
            read_receipts={(RECIPIENT, PROJECT, NOTIFICATION_ID): "not-a-timestamp"},
        )
        self.assertEqual(result, {"items": [], "total": 0, "unreadCount": 0})

    def test_deadline_is_preserved_without_overdue_classification(self):
        result = self.project([NOTIFICATION])
        item = result["items"][0]
        self.assertEqual(item["notification"]["dueAt"], NOTIFICATION["dueAt"])
        self.assertNotIn("overdue", item)
        self.assertNotIn("deadlineStatus", item)

    def test_order_is_newest_first_and_exact_duplicates_are_idempotent(self):
        older = {**NOTIFICATION, "id": OLDER_NOTIFICATION_ID, "createdAt": "2026-10-06T08:00:00Z"}
        result = self.project([older, NOTIFICATION, deepcopy(NOTIFICATION)])

        self.assertEqual([item["notification"]["id"] for item in result["items"]], [NOTIFICATION_ID, OLDER_NOTIFICATION_ID])
        self.assertEqual(result["total"], 2)

    def test_conflicting_duplicate_and_malformed_visible_record_are_rejected(self):
        conflict = {**NOTIFICATION, "reason": "changed"}
        with self.assertRaises(NotificationProjectionError):
            self.project([NOTIFICATION, conflict])

        malformed = {key: value for key, value in NOTIFICATION.items() if key != "sourceRef"}
        with self.assertRaises(NotificationProjectionError):
            self.project([malformed])

    def test_all_notification_timestamps_and_receipts_fail_closed(self):
        for field in ("updatedAt", "dueAt"):
            malformed = {**NOTIFICATION, field: "2026-10-07T08:00:00"}
            with self.subTest(field=field), self.assertRaises(NotificationProjectionError):
                self.project([malformed])

        for receipts in (
            {(RECIPIENT, PROJECT, NOTIFICATION_ID): "not-a-timestamp"},
            {(RECIPIENT, PROJECT): "2026-10-07T08:00:00Z"},
            {"malformed-key": "2026-10-07T08:00:00Z"},
            [],
        ):
            with self.subTest(receipts=receipts), self.assertRaises(NotificationProjectionError):
                self.project([NOTIFICATION], read_receipts=receipts)

    def test_unknown_fields_and_unknown_channel_are_rejected(self):
        with self.assertRaises(NotificationProjectionError):
            self.project([{**NOTIFICATION, "unvalidatedPrivateData": "must not leak"}])
        with self.assertRaises(NotificationProjectionError):
            self.project([{**NOTIFICATION, "channel": "unknown"}])

    def test_optional_notification_timestamps_are_validated_and_preserved(self):
        notification = {**NOTIFICATION, "sentAt": "2026-10-07T08:01:00Z"}
        item = self.project([notification])["items"][0]
        self.assertEqual(item["notification"]["sentAt"], notification["sentAt"])

        malformed = {**notification, "acknowledgedAt": "not-a-timestamp"}
        with self.assertRaises(NotificationProjectionError):
            self.project([malformed])

    def test_schema_validation_covers_domain_refs_and_project_scope_input(self):
        invalid_ref = {**NOTIFICATION, "sourceRef": {"objectType": "InformationItem", "objectId": "bad", "version": 2}}
        with self.assertRaises(NotificationProjectionError):
            self.project([invalid_ref])

        with self.assertRaises(NotificationProjectionError):
            project_notification_inbox(
                [NOTIFICATION],
                recipient_party_id=RECIPIENT,
                accessible_project_ids=PROJECT,
            )

    def test_empty_authorized_scope_returns_no_records(self):
        result = project_notification_inbox(
            [NOTIFICATION],
            recipient_party_id=RECIPIENT,
            accessible_project_ids=(),
        )
        self.assertEqual(result, {"items": [], "total": 0, "unreadCount": 0})


if __name__ == "__main__":
    unittest.main()
