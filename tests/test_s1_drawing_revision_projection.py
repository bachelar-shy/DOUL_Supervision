import unittest

from app.reference.engine import uid
from services.api.modules.drawing_revisions import (
    build_drawing_revision_context,
    list_drawing_revision_records,
)
from app.reference.validation import ContractError
from tests.fixtures import Fixture


class DrawingRevisionProjectionTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.engine = self.f.engine
        self.party, self.role = self.f.actors["SUP"]

    def test_list_returns_authorized_drawing_items_without_claiming_current(self):
        rows = list_drawing_revision_records(
            self.engine, self.f.project, self.party, self.role
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["domainRef"], self.f.ref("InformationItem", self.f.drawing))
        self.assertEqual(rows[0]["revision"], "A")
        self.assertEqual(rows[0]["sourceStatus"], "approved")
        self.assertNotIn("currentForConstruction", rows[0])

    def test_exact_approval_reference_is_included_but_release_readiness_stays_unknown(self):
        approval_id = uid()
        self.engine.bootstrap("Approval", dict(
            id=approval_id,
            projectId=self.f.project,
            status="approved",
            targetRef=self.f.ref("InformationItem", self.f.drawing),
            requestedBy=self.party,
            approvedBy=self.party,
            approvedAt="2026-10-04T12:00:00Z",
            approvalKind="technical",
            **self.f.scope(),
        ))

        context = build_drawing_revision_context(
            self.engine,
            self.f.project,
            self.f.ref("InformationItem", self.f.drawing),
            self.party,
            self.role,
        )

        self.assertEqual(len(context["exactLinkedRecords"]), 1)
        self.assertEqual(context["exactLinkedRecords"][0]["domainRef"]["objectId"], approval_id)
        self.assertEqual(context["releaseReadinessDiagnostic"]["result"], "unknown")
        self.assertFalse(context["releaseReadinessDiagnostic"]["isOfficialWorkflowState"])

    def test_same_title_or_revision_does_not_implicitly_group_drawings(self):
        other_id = uid()
        self.engine.bootstrap("InformationItem", dict(
            id=other_id,
            projectId=self.f.project,
            subtype="Drawing",
            title="승인도면",
            revision="A",
            status="approved",
            **self.f.scope(),
        ))

        rows = list_drawing_revision_records(
            self.engine, self.f.project, self.party, self.role
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {row["domainRef"]["objectId"] for row in rows},
            {self.f.drawing, other_id},
        )
        self.assertTrue(all("currentForConstruction" not in row for row in rows))

    def test_context_uses_the_requested_historical_information_item_version(self):
        old_ref = self.f.ref("InformationItem", self.f.drawing)
        old_record = self.engine.get("InformationItem", self.f.drawing)
        changed = dict(old_record, version=2, revision="B", status="submitted")
        self.engine._save("InformationItem", changed)
        approval_id = uid()
        self.engine.bootstrap("Approval", dict(
            id=approval_id,
            projectId=self.f.project,
            status="approved",
            targetRef=old_ref,
            requestedBy=self.party,
            approvedBy=self.party,
            approvedAt="2026-10-04T12:00:00Z",
            approvalKind="technical",
            **self.f.scope(),
        ))

        context = build_drawing_revision_context(
            self.engine, self.f.project, old_ref, self.party, self.role
        )

        self.assertEqual(context["drawing"]["domainRef"], old_ref)
        self.assertEqual(context["drawing"]["revision"], "A")
        self.assertEqual(context["drawing"]["sourceStatus"], "approved")
        self.assertEqual(
            context["exactLinkedRecords"][0]["domainRef"]["objectId"], approval_id
        )
        current_context = build_drawing_revision_context(
            self.engine,
            self.f.project,
            self.f.ref("InformationItem", self.f.drawing),
            self.party,
            self.role,
        )
        self.assertEqual(current_context["exactLinkedRecords"], [])

    def test_context_rejects_cross_project_and_non_drawing_refs(self):
        wrong_type = self.f.ref("Requirement", self.f.requirement)
        with self.assertRaises(ContractError) as caught:
            build_drawing_revision_context(
                self.engine, self.f.project, wrong_type, self.party, self.role
            )
        self.assertEqual(caught.exception.code, "REFERENCE_TYPE_INVALID")

        other_project = uid()
        self.engine.bootstrap("Project", dict(
            id=other_project,
            projectId=other_project,
            name="다른 현장",
            country="VN",
            timezone="Asia/Ho_Chi_Minh",
            qualificationRules=[dict(discipline="architecture", minimumRank=3)],
        ))
        foreign_id = uid()
        foreign = self.engine.bootstrap("InformationItem", dict(
            id=foreign_id,
            projectId=other_project,
            subtype="Drawing",
            title="타 프로젝트 도면",
            revision="A",
            status="approved",
            **self.f.scope(),
        ))
        with self.assertRaises(ContractError) as caught:
            build_drawing_revision_context(
                self.engine,
                self.f.project,
                dict(objectType="InformationItem", objectId=foreign_id, version=foreign["version"]),
                self.party,
                self.role,
            )
        self.assertEqual(caught.exception.code, "PROJECT_MISMATCH")


if __name__ == "__main__":
    unittest.main()
