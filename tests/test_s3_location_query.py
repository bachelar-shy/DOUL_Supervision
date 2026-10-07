import unittest

from app.reference.engine import Engine, uid
from app.reference.validation import ContractError
from services.api.modules.location.query import query_location_tree


class LocationTreeQueryTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.project_id = uid()
        self.other_project_id = uid()
        self.engine.bootstrap(
            "Project",
            {
                "id": self.project_id,
                "projectId": self.project_id,
                "name": "DOUL 현장",
                "country": "VN",
                "timezone": "Asia/Ho_Chi_Minh",
                "qualificationRules": [],
            },
        )
        self.engine.bootstrap(
            "Project",
            {
                "id": self.other_project_id,
                "projectId": self.other_project_id,
                "name": "다른 현장",
                "country": "VN",
                "timezone": "Asia/Ho_Chi_Minh",
                "qualificationRules": [],
            },
        )

    def add_location(
        self,
        location_id=None,
        *,
        project_id=None,
        name="위치",
        parent_id=None,
        semantic_anchor=None,
        version=1,
        drawing_anchors=None,
    ):
        location_id = location_id or uid()
        record = {
            "id": location_id,
            "projectId": project_id or self.project_id,
            "name": name,
            "semanticAnchor": semantic_anchor or f"site/{location_id}",
            "version": version,
        }
        if parent_id is not None:
            record["parentId"] = parent_id
        if drawing_anchors is not None:
            record["drawingAnchors"] = drawing_anchors
        return self.engine.bootstrap("Location", record)

    def test_returns_only_project_locations_with_versioned_stable_refs(self):
        parent_id = uid()
        child_id = uid()
        foreign_id = uid()
        self.add_location(parent_id, name="1동", version=4)
        self.add_location(
            child_id,
            name="2층",
            parent_id=parent_id,
            semantic_anchor="building/1/floor/2",
            drawing_anchors=[
                {
                    "drawingRef": {
                        "objectType": "InformationItem",
                        "objectId": uid(),
                        "version": 3,
                    },
                    "page": 2,
                    "x": 0.25,
                    "y": 0.75,
                    "coordinateSystem": "normalized",
                }
            ],
        )
        self.add_location(
            foreign_id,
            project_id=self.other_project_id,
            name="비공개 위치",
        )

        result = query_location_tree(self.engine, self.project_id)

        self.assertEqual(
            result["rootRefs"],
            [{"objectType": "Location", "objectId": parent_id, "version": 4}],
        )
        self.assertEqual(
            [item["name"] for item in result["items"]],
            ["1동", "2층"],
        )
        child = result["items"][1]
        self.assertEqual(child["depth"], 1)
        self.assertEqual(
            child["reference"],
            {"objectType": "Location", "objectId": child_id, "version": 1},
        )
        self.assertEqual(
            child["parentRef"],
            {"objectType": "Location", "objectId": parent_id, "version": 4},
        )
        self.assertEqual(child["semanticAnchor"], "building/1/floor/2")
        self.assertEqual(len(child["drawingAnchors"]), 1)
        serialized = repr(result)
        self.assertNotIn(foreign_id, serialized)
        self.assertNotIn("비공개 위치", serialized)

    def test_missing_or_foreign_project_parent_is_detached_without_id_leak(self):
        hidden_parent_id = uid()
        child_id = uid()
        self.add_location(
            hidden_parent_id,
            project_id=self.other_project_id,
            name="다른 프로젝트 부모",
        )
        self.add_location(
            child_id,
            name="고아 위치",
            parent_id=hidden_parent_id,
        )

        result = query_location_tree(self.engine, self.project_id)

        self.assertEqual(
            result["rootRefs"],
            [{"objectType": "Location", "objectId": child_id, "version": 1}],
        )
        item = result["items"][0]
        self.assertIsNone(item["parentRef"])
        self.assertIsNone(item["treeParentRef"])
        self.assertEqual(item["hierarchyIssues"], ["PARENT_NOT_IN_PROJECT"])
        self.assertEqual(result["hierarchyIssues"][0]["code"], "PARENT_NOT_IN_PROJECT")
        self.assertNotIn(hidden_parent_id, repr(result))
        self.assertNotIn("다른 프로젝트 부모", repr(result))

    def test_parent_cycle_is_broken_deterministically_and_reported(self):
        first_id = "00000000-0000-4000-8000-000000000001"
        second_id = "00000000-0000-4000-8000-000000000002"
        child_id = "00000000-0000-4000-8000-000000000003"
        self.add_location(first_id, name="A", parent_id=second_id)
        self.add_location(second_id, name="B", parent_id=first_id)
        self.add_location(child_id, name="C", parent_id=second_id)

        result = query_location_tree(self.engine, self.project_id)

        by_id = {item["reference"]["objectId"]: item for item in result["items"]}
        self.assertEqual(len(result["items"]), 3)
        self.assertEqual(
            result["rootRefs"],
            [{"objectType": "Location", "objectId": first_id, "version": 1}],
        )
        self.assertIsNone(by_id[first_id]["treeParentRef"])
        self.assertEqual(
            by_id[first_id]["parentRef"],
            {"objectType": "Location", "objectId": second_id, "version": 1},
        )
        self.assertEqual(by_id[second_id]["depth"], 1)
        self.assertEqual(by_id[child_id]["depth"], 2)
        self.assertEqual(by_id[first_id]["hierarchyIssues"], ["PARENT_CYCLE"])
        self.assertEqual(by_id[second_id]["hierarchyIssues"], ["PARENT_CYCLE"])
        self.assertEqual(
            [ref["objectId"] for ref in result["cycleRefs"][0]],
            [first_id, second_id],
        )

    def test_deep_hierarchy_uses_iterative_traversal(self):
        parent_id = None
        for index in range(1200):
            parent_id = self.add_location(
                name=f"level-{index:04d}",
                parent_id=parent_id,
            )["id"]

        result = query_location_tree(self.engine, self.project_id)

        self.assertEqual(len(result["items"]), 1200)
        self.assertEqual(result["items"][-1]["depth"], 1199)

    def test_project_not_found_uses_domain_not_found_error(self):
        with self.assertRaises(ContractError) as raised:
            query_location_tree(self.engine, uid())
        self.assertEqual(raised.exception.code, "OBJECT_NOT_FOUND")


if __name__ == "__main__":
    unittest.main()
