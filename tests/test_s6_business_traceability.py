import copy
import unittest

from app.reference.validation import ContractError
from services.api.modules.business_traceability import build_safety_stop_traceability


def ref(object_type, object_id, version):
    return {"objectType": object_type, "objectId": object_id, "version": version}


class TraceEngine:
    def __init__(self):
        self.current = {}
        self.history = {}
        self.denied = set()

    def add(self, object_type, object_id, project_id, version=1, **values):
        record = {
            "id": object_id,
            "projectId": project_id,
            "version": version,
            **values,
        }
        self.current[(object_type, object_id)] = record
        self.history[(object_type, object_id, version)] = record
        return record

    def resolve(self, reference, project_id=None):
        key = (reference["objectType"], reference["objectId"], reference["version"])
        if key not in self.history:
            raise ContractError("OBJECT_NOT_FOUND", "missing")
        record = self.history[key]
        if project_id is not None and record["projectId"] != project_id:
            raise ContractError("PROJECT_MISMATCH", "foreign")
        return copy.deepcopy(record)

    def get(self, object_type, object_id, version=None):
        source = self.history if version is not None else self.current
        key = (object_type, object_id, version) if version is not None else (object_type, object_id)
        if key not in source:
            raise ContractError("OBJECT_NOT_FOUND", "missing")
        return copy.deepcopy(source[key])

    def authorize_read(self, record, party_id, role_id):
        if (record["id"], role_id) in self.denied:
            raise ContractError("NOT_FOUND", "hidden by scope policy")
        return {"id": role_id}


class SafetyStopTraceabilityTests(unittest.TestCase):
    def setUp(self):
        self.engine = TraceEngine()
        self.role = "sup-role"
        self.party = "sup-party"
        self.project = "project-a"

        self.engine.add("Location", "loc-a", self.project, version=8)
        self.engine.add("Evidence", "evidence-a", self.project, version=5)
        self.engine.add("InformationItem", "drawing-a", self.project, version=4, subtype="Drawing", status="released_for_use")
        self.engine.add("WorkItem", "permit-a", self.project, version=7, subtype="SafetyPermit", status="suspended",
                        locationId="loc-a", drawingRef=ref("InformationItem", "drawing-a", 4),
                        evidenceIds=["evidence-a"], data={})
        self.engine.add("Action", "action-a", self.project, version=3, status="in_progress",
                        locationId="loc-a", drawingRef=ref("InformationItem", "drawing-a", 4),
                        evidenceIds=["evidence-a"])
        self.engine.add("Inspection", "inspection-a", self.project, version=2, status="completed",
                        locationId="loc-a", drawingRef=ref("InformationItem", "drawing-a", 4),
                        evidenceIds=["evidence-a"])
        self.engine.add("Issue", "issue-a", self.project, version=6, status="reinspection",
                        locationId="loc-a", drawingRef=ref("InformationItem", "drawing-a", 4),
                        evidenceIds=["evidence-a"], actionIds=["action-a"], inspectionIds=["inspection-a"])
        self.engine.add("InformationItem", "report-a", self.project, version=9, subtype="OwnerReport", status="issued",
                        locationId="loc-a", evidenceIds=["evidence-a"],
                        report={"sourceDomainRefs": [ref("WorkItem", "stop-a", 2)]})
        self.stop = self.engine.add(
            "WorkItem", "stop-a", self.project, version=2, subtype="SafetyStopOrder", status="verification",
            locationId="loc-a", drawingRef=ref("InformationItem", "drawing-a", 4),
            evidenceIds=["evidence-a"],
            data={
                "affectedPermitRefs": [ref("WorkItem", "permit-a", 7)],
                "issueRefs": [ref("Issue", "issue-a", 6)],
                "correctiveActionRefs": [ref("Action", "action-a", 3)],
                "resumeVerificationRefs": [ref("Inspection", "inspection-a", 2)],
                "ownerReportRefs": [ref("InformationItem", "report-a", 9)],
            },
        )

    def run_trace(self):
        return build_safety_stop_traceability(
            self.engine, ref("WorkItem", "stop-a", 2), self.party, self.role
        )

    def test_follows_exact_domain_refs_and_explicit_issue_children(self):
        before = copy.deepcopy(self.engine.current)
        result = self.run_trace()
        pairs = {(row["relation"], row["reference"]["objectId"], row["reference"]["version"])
                 for row in result["links"]}
        self.assertIn(("affectedPermitRefs", "permit-a", 7), pairs)
        self.assertIn(("issueRefs", "issue-a", 6), pairs)
        self.assertIn(("correctiveActionRefs", "action-a", 3), pairs)
        self.assertIn(("resumeVerificationRefs", "inspection-a", 2), pairs)
        self.assertIn(("ownerReportRefs", "report-a", 9), pairs)
        self.assertIn(("issue.actionIds", "action-a", None), pairs)
        self.assertIn(("issue.inspectionIds", "inspection-a", None), pairs)
        drawing = next(row for row in result["links"] if row["relation"] == "stopOrder.drawing")
        self.assertEqual(drawing["reference"]["version"], 4)
        evidence = next(row for row in result["links"] if row["relation"] == "stopOrder.evidence")
        self.assertIsNone(evidence["reference"]["version"])
        self.assertEqual(evidence["versionResolution"], "current_lookup_only_no_version_in_source")
        location = next(row for row in result["links"] if row["relation"] == "stopOrder.location")
        self.assertEqual(location["versionResolution"], "current_lookup_only_no_version_in_source")
        self.assertTrue(result["readOnly"])
        self.assertFalse(result["officialStateChanged"])
        self.assertEqual(self.engine.current, before)

    def test_does_not_infer_issue_from_same_location(self):
        self.engine.add("Issue", "unlinked-issue", self.project, version=1, status="open", locationId="loc-a")
        result = self.run_trace()
        ids = {row["reference"]["objectId"] for row in result["links"]}
        self.assertNotIn("unlinked-issue", ids)

    def test_missing_and_foreign_links_are_sanitized(self):
        stop = self.engine.current[("WorkItem", "stop-a")]
        stop["data"]["issueRefs"] = [
            ref("Issue", "missing-issue", 1),
            ref("Issue", "foreign-issue", 1),
        ]
        self.engine.add("Issue", "foreign-issue", "project-b", version=1, status="open")
        result = self.run_trace()
        errors = [d for d in result["diagnostics"] if d["sourceField"] == "data.issueRefs"]
        self.assertEqual([d["status"] for d in errors], ["missing", "foreign_project"])
        self.assertTrue(all(d["target"] is None for d in errors))
        serialized = repr(errors)
        self.assertNotIn("missing-issue", serialized)
        self.assertNotIn("foreign-issue", serialized)

    def test_unauthorized_target_is_not_disclosed(self):
        self.engine.denied.add(("issue-a", self.role))
        result = self.run_trace()
        issue_rows = [r for r in result["links"] if r["relation"] == "issueRefs"]
        issue_errors = [d for d in result["diagnostics"] if d["sourceField"] == "data.issueRefs"]
        self.assertEqual(issue_rows, [])
        self.assertEqual(issue_errors[0]["status"], "unauthorized")
        self.assertIsNone(issue_errors[0]["target"])
        self.assertNotIn("issue-a", repr(issue_errors[0]))

    def test_root_must_be_exact_safety_stop_order_ref(self):
        with self.assertRaises(ContractError) as caught:
            build_safety_stop_traceability(
                self.engine, ref("Issue", "issue-a", 6), self.party, self.role
            )
        self.assertEqual(caught.exception.code, "REFERENCE_TYPE_INVALID")


if __name__ == "__main__":
    unittest.main()
