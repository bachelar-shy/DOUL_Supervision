"""Static cross-reference validation for feature and document usability plans.

This verifies catalog structure against Product contracts, role cases and form
registries. It must never report that a browser journey or a field pilot passed.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import json
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> dict:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


class FeatureInteractionAndDocumentUsabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.roles = load("app/reference/role_field_use_cases_v1.json")
        cls.feature = load("app/reference/feature_interaction_use_cases_v1.json")
        cls.documents = load("app/reference/document_authoring_usability_v1.json")
        cls.acceptance = load("app/schema/implementation_acceptance_catalog_v1.json")
        cls.register = load("app/schema/register_catalog.json")
        cls.terms = load("app/reference/terminology_catalog_v1.json")
        cls.forms = load("app/forms/form_catalog.json")
        cls.schemas = load("app/forms/form_data_schemas_v1.json")
        cls.templates = load("app/forms/form_templates_v1.json")
        cls.legal = load("app/forms/legal_form_registry.json")

    def test_retained_role_cases_nine_proposals_and_six_independent_splits(self):
        cases = self.roles["cases"]
        ids = [x["id"] for x in cases]
        self.assertEqual(len(ids), 67)
        self.assertEqual(len(ids), len(set(ids)))
        retained = [x for x in cases if x["origin"]["kind"] in ("retained_v1", "retained_v1_narrowed")]
        self.assertEqual(len(retained), 47)
        new = [x for x in cases if x["origin"]["kind"] == "added_from_review"]
        self.assertEqual(len(new), 9)
        self.assertEqual(
            {x["origin"]["proposalId"] for x in new},
            {"A01", "A02", "A03", "A04", "A05", "A06", "A07", "A09", "A10"},
        )
        self.assertEqual({x["id"] for x in new}, set(self.roles["reviewAdditions"].values()))
        splits = self.roles["splitGroups"]
        self.assertEqual(len(splits), 6)
        self.assertEqual({x["anchorId"] for x in splits},
                         {"UC-SUP-05", "UC-SUP-09", "UC-SUP-11",
                          "UC-CON-08", "UC-OWN-02", "UC-ADM-08"})
        self.assertEqual(sum(len(x["caseIds"]) - 1 for x in splits), 11)
        children = [x for x in cases if x["origin"]["kind"] == "split_from_v1"]
        self.assertEqual(len(children), 11)
        index = {x["id"]: x for x in cases}
        for group in splits:
            self.assertEqual(group["caseIds"][0], group["anchorId"])
            anchor = index[group["anchorId"]]
            self.assertEqual(anchor["origin"]["splitGroupId"], group["id"])
            self.assertGreaterEqual(len(group["caseIds"]), 2)
            for sid in group["caseIds"]:
                self.assertIn(sid, index)
                child = index[sid]
                self.assertEqual(child["role"], anchor["role"])
                self.assertEqual(child["implementationStatus"], "unverified")
                self.assertGreaterEqual(len(child["testChecks"]), 4)
                for field in ["trigger", "operation", "expected", "exception", "evidence", "uiActionLabelCandidate"]:
                    self.assertTrue(child[field].strip(), (sid, field))
            titles = [index[sid]["title"] for sid in group["caseIds"]]
            self.assertEqual(len(titles), len(set(titles)), group["id"])
            for sid in group["caseIds"][1:]:
                child = index[sid]
                self.assertEqual(child["origin"]["sourceId"], group["anchorId"])
        self.assertEqual(sum(self.roles["coverage"]["caseCountsByRole"].values()), 67)

    def test_roles_are_categorized_and_referenced_by_functional_tests(self):
        roles = self.roles["cases"]
        role_ids = {x["id"] for x in roles}
        known_situations = set(self.roles["scope"]["situationTypes"])
        known_registers = {x["id"] for x in self.register["registers"]}
        known_ac = {x["id"] for x in self.acceptance["scenarios"]}
        known_terms = {x["termId"] for x in self.terms["terms"]}
        for case in roles:
            self.assertIn(case["situationType"], known_situations, case["id"])
            self.assertTrue(set(case["registerIds"]) <= known_registers, case["id"])
            self.assertTrue(set(case["acceptanceRefs"]) <= known_ac, case["id"])
            self.assertTrue(set(case["approvedTermIds"]) <= known_terms, case["id"])
            self.assertTrue(case["testChecks"], case["id"])
            self.assertEqual(case["implementationStatus"], "unverified")
        for flow in self.roles["flows"]:
            self.assertGreaterEqual(len(flow["caseSteps"]), 4)
            self.assertTrue(set(step["caseId"] for step in flow["caseSteps"]) <= role_ids, flow["id"])
            self.assertGreaterEqual(len(set(step["caseId"].split("-")[1] for step in flow["caseSteps"])), 2)
        for case in self.feature["scenarios"]:
            self.assertTrue(set(case["roleCaseRefs"]) <= role_ids, case["id"])

    def test_feature_catalog_has_full_groups_and_test_types(self):
        cases = self.feature["scenarios"]
        self.assertEqual(len(cases), 77)
        self.assertEqual(self.feature["counts"]["total"], len(cases))
        groups = {g["code"]:g for g in self.feature["featureGroups"]}
        self.assertEqual(set(groups),
                         {"NAV", "DWG", "EVD", "INS", "NCR", "SAF", "SCH", "PAY", "OWN", "HDO", "DOC", "ADM"})
        known_kinds = {x["id"] for x in self.feature["categories"]}
        known_ac = {x["id"] for x in self.acceptance["scenarios"]}
        kinds = Counter()
        grouped = Counter()
        ids = set()
        for case in cases:
            self.assertRegex(case["id"], r"^FC-[A-Z]{3}-\d{2}$")
            self.assertNotIn(case["id"], ids)
            ids.add(case["id"])
            self.assertIn(case["featureGroup"], groups)
            self.assertIn(case["kind"], known_kinds)
            self.assertIn(case["priority"], {"P0", "P1", "P2"})
            self.assertIn(case["implementationSurface"],
                          {"existing_surface_to_verify", "known_gap", "contract_target"})
            self.assertEqual(case["executionStatus"], "unverified")
            self.assertGreaterEqual(len(case["steps"]), 3, case["id"])
            for field in ["expected", "negative", "title"]:
                self.assertTrue(case[field].strip(), (case["id"], field))
            self.assertTrue(case["fixtureIds"])
            self.assertTrue(case["actors"])
            self.assertTrue(case["roleCaseRefs"])
            self.assertTrue(set(case["acceptanceRefs"]) <= known_ac)
            kinds[case["kind"]] += 1
            grouped[case["featureGroup"]] += 1
        self.assertTrue(all(kinds[k] for k in known_kinds))
        for group, count in grouped.items():
            self.assertEqual(groups[group]["scenarioCount"], count)
            self.assertEqual(self.feature["counts"]["groups"][group], count)

    def test_combined_journeys_refer_to_existing_features(self):
        cases = {x["id"]:x for x in self.feature["scenarios"]}
        journeys = self.feature["journeys"]
        self.assertEqual(len(journeys), 12)
        for j in journeys:
            self.assertRegex(j["id"], r"^J-(DWG|DOC|X)-\d{2}$")
            self.assertGreaterEqual(len(j["scenarioIds"]), 3)
            self.assertEqual(j["executionStatus"], "unverified")
            self.assertTrue(j["passCriterion"])
            self.assertTrue(set(j["scenarioIds"]) <= set(cases), j["id"])
        self.assertGreaterEqual(
            sum(j["id"].startswith("J-DWG") for j in journeys), 3
        )
        self.assertGreaterEqual(
            sum(j["id"].startswith("J-DOC") for j in journeys), 4
        )

    def test_36_forms_contract_vs_five_screen_selectable(self):
        forms = self.documents["forms"]
        index = {f["id"]:f for f in self.forms["forms"]}
        ids = {x["formId"] for x in forms}
        self.assertEqual(len(forms), 36)
        self.assertEqual(len(ids), 36)
        self.assertEqual(ids, set(index))
        self.assertEqual(ids, set(self.schemas["forms"]))
        self.assertEqual(ids, {t["id"] for t in self.templates["templates"]})
        supported = {"FM-09", "FM-12", "FM-19", "FM-20", "FM-21"}
        self.assertEqual(self.documents["formCoverage"]["documentPageSelectableCount"], 5)
        self.assertEqual(set(self.documents["formCoverage"]["documentPageSelectableFormIds"]), supported)
        self.assertEqual({f["formId"] for f in forms if f["selectableInDocumentPage"]}, supported)
        for row in forms:
            source = index[row["formId"]]
            self.assertEqual(row["title"], source["title"])
            self.assertEqual(row["legalMode"], source["legal_mode"])
            self.assertEqual(row["templateVersion"], source["template_version"])
            self.assertEqual(row["registerRefs"], source["registers"])
            self.assertTrue(row["schemaPresent"] and row["templatePresent"])

    def test_statutory_originals_and_pending_production_exports(self):
        fixed = self.legal["official_fixed"]
        self.assertEqual(self.documents["formCoverage"]["legalFixedCount"], len(fixed))
        self.assertEqual(self.documents["formCoverage"]["legalFixedRenderDisabledCount"],
                         sum(item["render_enabled"] is False for item in fixed))
        self.assertTrue(all(item["render_enabled"] is False for item in fixed))
        rendering = load("app/forms/rendering_contract.json")
        self.assertIn("pdf", rendering["production_adapters_pending"])
        self.assertIn("docx", rendering["production_adapters_pending"])
        self.assertTrue(self.documents["formCoverage"]["pdfDocxProductionAdaptersPending"])
        path = (ROOT / "apps/web/src/pages/DocumentPage.tsx").read_text(encoding="utf-8")
        for name in self.documents["formCoverage"]["documentPageSelectableFormIds"]:
            self.assertIn('"' + name + '"', path)
        for marker in ['document.action.docxPending', 'document.action.pdfPending']:
            self.assertIn(marker, path)

    def test_26_document_tasks_have_links_and_human_usability_metrics(self):
        tasks = self.documents["tasks"]
        self.assertEqual(len(tasks), 26)
        role_ids = {x["id"] for x in self.roles["cases"]}
        scenario_ids = {x["id"] for x in self.feature["scenarios"]}
        doc_ids = {x["formId"] for x in self.documents["forms"]}
        allIds = set()
        actor_counts = Counter()
        for task in tasks:
            self.assertRegex(task["id"], r"^DT-(SUP|CON|OWN|ADM|ALL)-\d{2}$")
            self.assertNotIn(task["id"], allIds)
            allIds.add(task["id"])
            actor_counts[task["actorGroup"]] += 1
            self.assertTrue(set(task["formIds"]) <= doc_ids)
            self.assertTrue(set(task["featureRefs"]) <= scenario_ids)
            self.assertTrue(set(task["roleRefs"]) <= role_ids)
            self.assertTrue(task["expected"] and task["negative"] and task["trigger"])
            self.assertGreaterEqual(len(task["steps"]), 3)
            self.assertEqual(task["executionStatus"], "unverified")
        self.assertEqual(dict(actor_counts), {"SUP":6, "CON":6, "OWN":3, "ADM":3, "ALL":8})
        labels = {c["id"] for c in self.documents["usabilityCriteria"]}
        self.assertEqual(labels, {
            "UX-COMPLETE", "UX-CLARITY", "UX-STEPS", "UX-TIME",
            "UX-ERROR", "UX-A4", "UX-SOURCE", "UX-DEVICE",
        })
        self.assertEqual(self.documents["criteriaStatus"], "targets_proposed_not_approved")
        self.assertEqual(self.documents["executionStatus"], "unverified")

    def test_markdown_covers_case_lists_and_explicit_unverified_disclaimer(self):
        roleDoc = (ROOT / "79_Field_Role_Use_Case_and_Terminology_Review_v1.md").read_text(encoding="utf-8")
        featureDoc = (ROOT / "80_Feature_Interaction_and_Document_Usability_v1.md").read_text(encoding="utf-8")
        for item in self.roles["cases"]:
            self.assertIn("#### " + item["id"] + " —", roleDoc)
        for item in self.feature["scenarios"]:
            self.assertIn("#### " + item["id"] + " —", featureDoc)
        for item in self.documents["tasks"]:
            self.assertIn("#### " + item["id"] + " —", featureDoc)
        for g in self.roles["splitGroups"]:
            self.assertIn(g["id"], roleDoc)
        for doc in [roleDoc,featureDoc]:
            self.assertIn("unverified", doc)
        self.assertIn("5종", featureDoc)
        self.assertIn("36종", featureDoc)
        self.assertIn("PDF", featureDoc)
        self.assertIn("DOCX", featureDoc)


if __name__ == "__main__":
    unittest.main()
