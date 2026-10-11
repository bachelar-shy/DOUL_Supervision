"""Contract checks for DOUL supervision menu usability evaluation.

This validates menu route expectations and test traceability. Only the
GitHub-hosted browser suite can report live navigation behavior.
Human task discovery/understanding is a separate future evaluation.
"""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLAN = json.loads((ROOT / "app/reference/menu_usability_v1.json").read_text(encoding="utf-8"))
ROLE = json.loads((ROOT / "app/reference/role_field_use_cases_v1.json").read_text(encoding="utf-8"))
FEATURE = json.loads((ROOT / "app/reference/feature_interaction_use_cases_v1.json").read_text(encoding="utf-8"))


class MenuUsabilityContractTests(unittest.TestCase):
    def test_30_scenarios_are_typed_and_never_pretend_to_have_run(self):
        cases = PLAN["scenarios"]
        self.assertEqual(len(cases), 30)
        self.assertEqual(len(set(x["id"] for x in cases)), 30)
        kinds = set(PLAN["scenarioTypes"])
        actors = {"SUP", "CON", "OWN", "ADM", "DES"}
        counts = Counter()
        for case in cases:
            self.assertRegex(case["id"], r"^MC-\d{2}$")
            self.assertIn(case["kind"], kinds)
            self.assertTrue(set(case["actors"]) <= actors)
            self.assertIn(case["priority"], ("P0", "P1"))
            self.assertIn(case["executionMode"], (
                "browser", "human", "browser_and_human", "browser_conditional",
            ))
            self.assertTrue(len(case["sequence"]) >= 2)
            self.assertTrue(case["title"] and case["expected"] and case["negative"])
            self.assertEqual(case["executionStatus"], "unverified")
            counts[case["kind"]] += 1
        self.assertEqual(set(counts), kinds)
        self.assertEqual(PLAN["humanEvaluationStatus"], "not_run")

    def test_menu_routes_match_route_dictionary_and_all_roles_have_core_paths(self):
        source = (ROOT / "apps/web/src/app/routes.ts").read_text(encoding="utf-8")
        first_section = source.split("const allRouteIds =", 1)[0]
        ids = re.findall(r'\bid:\s*"([^"]+)"', first_section)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("drawings", ids)
        roles = PLAN["roleMenus"]
        self.assertEqual(set(roles), {"SUP", "CON", "OWN", "ADM", "DES"})
        for role, detail in roles.items():
            visible = detail["visibleRouteIds"]
            self.assertEqual(len(visible), len(set(visible)), role)
            self.assertEqual(visible, [name for name in ids if name in visible], role)
            self.assertTrue({"today", "drawings", "documents"} <= set(visible), role)
            self.assertTrue({task["routeId"] for task in detail["mainTasks"]} <= set(visible))
            if role != "ADM":
                self.assertNotIn("admin", visible)
            if role in {"SUP", "ADM", "DES"}:
                self.assertEqual(detail["visibleRouteIds"][-1], "parallel-test")
            else:
                self.assertNotIn("parallel-test", detail["visibleRouteIds"])
        # The full-development menu intentionally omits the grouped release-only
        # "corrections" route; the release uses fieldCoreRoutes.
        self.assertEqual(set(roles["ADM"]["visibleRouteIds"]), set(ids) - {"corrections"})
        profiles = PLAN["menuProfiles"]
        self.assertEqual(profiles["full"]["navigationByRole"],
                         {role: detail["visibleRouteIds"] for role, detail in roles.items()})
        self.assertEqual(profiles["fieldCore"]["navigationByRole"]["SUP"],
                         ["today", "capture", "drawings", "inspections", "corrections", "owner"])
        self.assertEqual(profiles["fieldCore"]["navigationByRole"]["CON"],
                         ["today", "capture", "drawings", "inspections", "corrections"])

    def test_direct_drawing_view_uses_existing_components_and_role_permissions(self):
        source = (ROOT / "apps/web/src/pages/DrawingReviewPage.tsx").read_text(encoding="utf-8")
        shell = (ROOT / "apps/web/src/app/AppShell.tsx").read_text(encoding="utf-8")
        for widget in [
            "PdfViewerPanel", "DrawingComparePanel", "DrawingMarkupIssuePanel",
            "DrawingSourceRegistrationPanel", "DrawingFieldManagementPanel",
            "DrawingPdfBindingPanel",
        ]:
            self.assertIn(widget, source)
        self.assertIn('data-ui-page="drawings"', source)
        self.assertIn('workspace.role.actorGroup', source)
        self.assertIn('safeRoute === "drawings"', shell)
        self.assertIn('id="side-navigation"', shell)
        self.assertIn('aria-controls="side-navigation"', shell)
        self.assertIn('aria-expanded={menu}', shell)
        self.assertIn('setMenu(false)', shell)

    def test_sidebar_scroll_and_mobile_dismissal_have_structural_contract(self):
        css = (ROOT / "apps/web/src/App.css").read_text(encoding="utf-8")
        shell = (ROOT / "apps/web/src/app/AppShell.tsx").read_text(encoding="utf-8")
        nav = (ROOT / "apps/web/src/ui/catalog.tsx").read_text(encoding="utf-8")
        self.assertRegex(css, r'(?s)\.sidebar nav\s*\{[^}]*overflow-y:\s*auto')
        self.assertRegex(css, r'(?s)@media \(max-width:\s*620px\)\s*\{.*?\.sidebar\s*\{\s*visibility:\s*hidden')
        self.assertIn(".sidebar-backdrop", css)
        self.assertIn('className="sidebar-backdrop"', shell)
        self.assertIn('event.key === "Escape"', shell)
        self.assertIn("moreControls", nav)
        self.assertGreaterEqual(nav.count("data-route={item.id}"), 2)

    def test_localized_drawing_menu_has_three_explicit_entries(self):
        locale = (ROOT / "packages/localization/src/index.ts").read_text(encoding="utf-8")
        for key in [
            "navigation.drawings", "app.menuClose",
            "drawingReview.view", "drawingReview.compare", "drawingReview.manage",
            "drawingReview.description",
        ]:
            self.assertEqual(locale.count('"' + key + '":'), 3, key)

    def test_menu_cases_trace_the_existing_role_and_feature_ux_catalogs(self):
        self.assertEqual(len(ROLE["cases"]), 67)
        self.assertEqual(len(FEATURE["scenarios"]), 77)
        self.assertEqual(len(PLAN["findings"]), 6)
        seen = set()
        for item in PLAN["findings"]:
            self.assertNotIn(item["id"], seen)
            seen.add(item["id"])
            self.assertTrue(item["title"] and item["verification"])
            self.assertIn(item["priority"], {"P0", "P1", "P2"})
        self.assertEqual(len(PLAN["usabilityCriteria"]), 8)
        refs = {x["id"] for x in PLAN["scenarios"]}
        self.assertEqual(refs, {f"MC-{i:02d}" for i in range(1, 31)})
        markdown = (ROOT / "81_Menu_Usability_Evaluation_v1.md").read_text(encoding="utf-8")
        for case in PLAN["scenarios"]:
            self.assertIn(case["id"], markdown)
        for finding in PLAN["findings"]:
            self.assertIn(finding["id"], markdown)
        self.assertIn("미실행", markdown)
        self.assertIn("GitHub", markdown)


if __name__ == "__main__":
    unittest.main()
