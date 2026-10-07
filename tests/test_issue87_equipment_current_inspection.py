import unittest

from app.reference.engine import uid
from tests.fixtures import Fixture


class EquipmentCurrentInspectionRegressionTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.equipment = self.f.engine.bootstrap(
            "Asset",
            {
                "id": uid(),
                "projectId": self.f.project,
                "subtype": "Equipment",
                "name": "Tower Crane",
                "certificateRequired": False,
                "calibrationRequired": False,
            },
        )
        self.equipment_ref = self.f.ref("Asset", self.equipment["id"])
        self.permit = {
            "projectId": self.f.project,
            "equipmentRefs": [self.equipment_ref],
        }

    def inspection(self, status, inspected_at, available, **data):
        return self.f.engine.bootstrap(
            "WorkItem",
            {
                "id": uid(),
                "projectId": self.f.project,
                "subtype": "SafetyEquipmentInspection",
                "status": status,
                "title": status,
                "data": {
                    "equipmentRef": self.equipment_ref,
                    "inspectionKind": "pre_use",
                    "inspectedAt": inspected_at,
                    "equipmentAvailable": available,
                    **data,
                },
                **self.f.scope(),
            },
        )

    def test_latest_failed_restricted_or_reinspection_state_blocks_old_pass(self):
        self.inspection("passed", "2026-10-01T00:00:00Z", True)
        self.assertTrue(self.f.engine._permit_equipment_ready(self.permit))

        self.inspection("failed", "2026-10-02T00:00:00Z", False, failureReason="brake")
        self.assertFalse(self.f.engine._permit_equipment_ready(self.permit))

        self.inspection("restricted", "2026-10-03T00:00:00Z", False, restrictionConditions=["no lifting"])
        self.assertFalse(self.f.engine._permit_equipment_ready(self.permit))

        self.inspection("reinspection_required", "2026-10-04T00:00:00Z", False)
        self.assertFalse(self.f.engine._permit_equipment_ready(self.permit))

        self.inspection("passed", "2026-10-05T00:00:00Z", True)
        self.assertTrue(self.f.engine._permit_equipment_ready(self.permit))

    def test_latest_expired_pass_blocks_old_valid_pass(self):
        from datetime import datetime, timezone
        self.f.clock = datetime(2026, 10, 6, tzinfo=timezone.utc)
        self.inspection("passed", "2026-09-01T00:00:00Z", True)
        self.inspection(
            "passed",
            "2026-10-01T00:00:00Z",
            True,
            validTo="2026-10-05T00:00:00Z",
        )
        self.assertFalse(self.f.engine._permit_equipment_ready(self.permit))


if __name__ == "__main__":
    unittest.main()
