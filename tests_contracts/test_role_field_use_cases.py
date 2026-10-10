"""Contract checks for role-specific DOUL field use cases.

This suite verifies catalogue integrity and source references. It deliberately
does not claim to execute real field users, backend commands or browser journeys.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "app/reference/role_field_use_cases_v1.json"


def load_json(relative_path: str):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


class RoleFieldUseCaseCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_json("app/reference/role_field_use_cases_v1.json")
        cls.registers = load_json("app/schema/register_catalog.json")
        cls.acceptance = load_json("app/schema/implementation_acceptance_catalog_v1.json")
        cls.terms = load_json("app/reference/terminology_catalog_v1.json")

    def test_primary_roles_and_supplementary_designer_are_explicit(self):
        scope = self.catalog["scope"]
        self.assertEqual(scope["primaryRoles"], ["SUP", "CON", "OWN", "ADM"])
        self.assertEqual(scope["supplementaryRole"], "DES")
        counts = Counter(x["role"] for x in self.catalog["cases"])
        self.assertGreaterEqual(counts["SUP"], 10)
        self.assertGreaterEqual(counts["CON"], 10)
        self.assertGreaterEqual(counts["OWN"], 8)
        self.assertGreaterEqual(counts["ADM"], 8)
        self.assertGreaterEqual(counts["DES"], 4)
        self.assertEqual(dict(counts), self.catalog["coverage"]["caseCountsByRole"])

    def test_identifiers_scenario_fields_and_unverified_status(self):
        ids = set()
        grouped = Counter()
        mandatory = [
            "title", "trigger", "operation", "expected", "exception", "evidence",
            "uiActionLabelCandidate",
        ]
        for case in self.catalog["cases"]:
            identifier = case["id"]
            self.assertRegex(identifier, r"^UC-(SUP|CON|OWN|ADM|DES)-\\d{2}$")
            self.assertNotIn(identifier, ids)
            ids.add(identifier)
            grouped[case["role"]] += 1
            for key in mandatory:
                self.assertTrue(isinstance(case[key], str) and case[key].strip(), (identifier, key))
            self.assertTrue(case["registerIds"], identifier)
            self.assertEqual(case["implementationStatus"], "unverified", identifier)
        for role, size in grouped.items():
            self.assertEqual(
                sorted(int(x.split("-")[-1]) for x in ids if x.startswith("UC-" + role + "-")),
                list(range(1, size + 1)),
            )
        self.assertEqual(self.catalog["scope"]["pilotStatus"], "not_started")
        self.assertEqual(self.catalog["scope"]["humanTermValidation"], "pending")

    def test_all_29_registers_covered_but_not_reinterpreted_as_permissions(self):
        ids = {item["id"] for item in self.registers["registers"]}
        self.assertEqual(len(ids), 29)
        seen = set()
        for case in self.catalog["cases"]:
            regs = case["registerIds"]
            self.assertTrue(set(regs) <= ids, (case["id"], regs))
            seen.update(regs)
        self.assertEqual(seen, ids)
        self.assertEqual(set(self.catalog["coverage"]["registerIds"]), ids)
        for register_id, expected in self.catalog["coverage"]["registerCaseCounts"].items():
            actual = sum(register_id in case["registerIds"] for case in self.catalog["cases"])
            self.assertEqual(actual, expected)
        self.assertTrue(any("권한" in rule for rule in self.catalog["commonConstraints"]))

    def test_acceptance_and_term_links_refer_to_existing_authorities(self):
        valid_ac = {x["id"] for x in self.acceptance["scenarios"]}
        valid_terms = {x["termId"] for x in self.terms["terms"]}
        self.assertTrue(valid_ac)
        for case in self.catalog["cases"]:
            self.assertTrue(set(case["acceptanceRefs"]) <= valid_ac, case["id"])
            self.assertTrue(set(case["approvedTermIds"]) <= valid_terms, case["id"])
        self.assertTrue(
            any(case["approvedTermIds"] for case in self.catalog["cases"]),
            "At least one case must trace an approved Korean Term ID",
        )

    def test_cross_role_handoffs_cover_five_required_workflows(self):
        all_cases = {c["id"]: c for c in self.catalog["cases"]}
        ac_ids = {a["id"] for a in self.acceptance["scenarios"]}
        flows = self.catalog["flows"]
        self.assertEqual(len({f["id"] for f in flows}), len(flows))
        self.assertEqual(
            {x["id"] for x in flows if x["id"] in self.catalog["coverage"]["mandatoryFlowIds"]},
            set(self.catalog["coverage"]["mandatoryFlowIds"]),
        )
        expected = {"AC-Q-01", "AC-S-01", "AC-SCH-01", "AC-PAY-01", "AC-HO-01"}
        self.assertEqual(
            {flow["acceptanceRef"] for flow in flows if flow["id"] in self.catalog["coverage"]["mandatoryFlowIds"]},
            expected,
        )
        for flow in flows:
            self.assertIn(flow["acceptanceRef"], ac_ids)
            self.assertGreaterEqual(len(flow["caseSteps"]), 4)
            self.assertTrue(flow["checks"] and flow["forbidden"])
            actors = set()
            for step in flow["caseSteps"]:
                self.assertIn(step["caseId"], all_cases, flow["id"])
                self.assertTrue(step["handoff"].strip())
                actors.add(all_cases[step["caseId"]]["role"])
            self.assertGreaterEqual(len(actors), 2, flow["id"])

    def test_known_field_gaps_are_pending_not_passed(self):
        known = self.catalog["knownUsabilityGaps"]
        self.assertEqual(len({g["id"] for g in known}), len(known))
        cases = {c["id"] for c in self.catalog["cases"]}
        flows = {f["id"] for f in self.catalog["flows"]}
        for gap in known:
            self.assertIn(gap["priority"], {"P0", "P1", "P2", "P3"})
            self.assertTrue(gap["evidence"] and gap["verifyWith"])
            self.assertTrue(set(gap["verifyWith"]) <= cases | flows, gap["id"])
        self.assertIn("GAP-DWG-01", {g["id"] for g in known})
        self.assertIn("GAP-TERM-01", {g["id"] for g in known})

    def test_human_readable_catalog_lists_all_cases_and_flows(self):
        doc = (ROOT / "79_Field_Role_Use_Case_and_Terminology_Review_v1.md").read_text(
            encoding="utf-8"
        )
        for item in self.catalog["cases"]:
            self.assertIn("#### " + item["id"] + " —", doc)
        for flow in self.catalog["flows"]:
            self.assertIn(flow["title"], doc)
        self.assertIn("pilot_verified", doc)
        self.assertIn("WWT", doc)


if __name__ == "__main__":
    unittest.main()
