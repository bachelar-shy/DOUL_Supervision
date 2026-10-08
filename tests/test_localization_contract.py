import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class LocalizationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(
            (ROOT / "app/schema/localization_contract_v1.json").read_text()
        )
        cls.catalog = json.loads(
            (ROOT / "app/reference/terminology_catalog_v1.json").read_text()
        )

    def test_language_neutral_domain_identifiers_are_required(self):
        policy = self.contract["identifierPolicy"]
        self.assertTrue(policy["machineIdentifiersAreLanguageNeutral"])
        self.assertTrue(policy["localizedLabelsNeverBecomeDomainIdentifiers"])
        self.assertTrue(policy["termIdsAreStable"])

    def test_ui_project_and_document_locales_are_independent(self):
        policy = self.contract["localePolicy"]
        self.assertTrue(policy["uiLocaleIsUserPreference"])
        self.assertTrue(policy["projectPrimaryLocaleIsIndependent"])
        self.assertTrue(policy["documentOutputLocaleIsIndependentFromUiLocale"])

    def test_initial_locales_are_bcp47_and_expandable(self):
        locales = self.contract["initialLocales"]
        self.assertEqual(
            {(item["language"], item["tag"]) for item in locales},
            {("ko", "ko-KR"), ("vi", "vi-VN"), ("en", "en-US")},
        )
        self.assertFalse(
            self.contract["futureLocaleRule"]["newLocaleRequiresDomainLogicChange"]
        )

    def test_term_ids_are_unique_and_korean_master_is_approved(self):
        terms = self.catalog["terms"]
        term_ids = [term["termId"] for term in terms]
        self.assertEqual(len(term_ids), len(set(term_ids)))
        self.assertGreaterEqual(len(terms), 15)
        for term in terms:
            self.assertEqual(term["labels"]["ko"]["status"], "approved")
            self.assertTrue(term["labels"]["ko"]["text"])
            self.assertIn("vi", term["labels"])
            self.assertIn("en", term["labels"])

    def test_translations_do_not_chain_through_korean_wording(self):
        self.assertIn(
            "Term ID meaning directly",
            self.catalog["translationPolicy"],
        )
        self.assertTrue(
            self.contract["terminologyPolicy"]["translationsAreIndependentFromKoreanWording"]
        )

    def test_web_feature_components_do_not_hardcode_korean_intl_locale(self):
        web_src = ROOT / "apps/web/src"
        offenders = []
        for path in web_src.rglob("*.ts*"):
            text = path.read_text()
            if 'Intl.DateTimeFormat("ko-KR"' in text or 'toLocaleString("ko-KR"' in text:
                offenders.append(str(path.relative_to(ROOT)))
        self.assertEqual(offenders, [])

    def test_web_and_mobile_share_translation_resources(self):
        platform = self.contract["platformPolicy"]
        self.assertEqual(
            platform["sharedTranslationResourcesPackage"],
            "@doul/localization",
        )
        self.assertTrue(platform["webAndMobileShareTranslationKeys"])
        mobile_package = json.loads((ROOT / "apps/mobile/package.json").read_text())
        dependencies = mobile_package["dependencies"]
        self.assertIn("@doul/localization", dependencies)
        self.assertIn("i18next", dependencies)
        self.assertIn("react-i18next", dependencies)

    def test_mobile_locale_preference_uses_existing_sqlite_storage(self):
        platform = self.contract["platformPolicy"]
        self.assertEqual(
            platform["mobilePreferenceStorage"],
            "expo-sqlite/kv-store",
        )
        mobile_i18n = (ROOT / "apps/mobile/src/i18n.ts").read_text()
        self.assertIn('from "expo-sqlite/kv-store"', mobile_i18n)
        self.assertIn('import "intl-pluralrules"', mobile_i18n)
        self.assertIn('Storage.setItemSync(localeStorageKey', mobile_i18n)

    def test_mobile_ui_has_no_hardcoded_korean_labels(self):
        app = (ROOT / "apps/mobile/App.tsx").read_text()
        self.assertIsNone(re.search(r"[가-힣]", app))

    def test_web_domain_labels_are_owned_by_shared_localization_package(self):
        platform = self.contract["platformPolicy"]
        master_path = ROOT / platform["domainLabelMasterLocation"]
        adapter_path = ROOT / platform["webDomainLabelAdapter"]
        master = master_path.read_text()
        adapter = adapter_path.read_text()
        self.assertGreaterEqual(len(re.findall(r"[가-힣]", master)), 400)
        self.assertIsNone(re.search(r"[가-힣]", adapter))
        self.assertIn('from "@doul/localization"', adapter)
        self.assertIn("i18n.t", adapter)

    def test_localized_web_core_surfaces_do_not_hardcode_korean(self):
        paths = [
            "apps/web/src/pages/TodayPage.tsx",
            "apps/web/src/pages/WorkbenchPage.tsx",
            "apps/web/src/pages/CommandModal.tsx",
            "apps/web/src/pages/AdminPage.tsx",
            "apps/web/src/pages/RegisterPage.tsx",
            "apps/web/src/data/register-format.ts",
            "apps/web/src/app/routes.ts",
            "apps/web/src/app/register-navigation.ts",
        ]
        offenders = [
            path
            for path in paths
            if re.search(r"[가-힣]", (ROOT / path).read_text())
        ]
        self.assertEqual(offenders, [])

    def test_register_and_machine_korean_masters_live_in_shared_package(self):
        register_master = (ROOT / "packages/localization/src/register-labels.ts").read_text()
        machine_master = (ROOT / "packages/localization/src/machine-labels.ts").read_text()
        self.assertGreaterEqual(len(re.findall(r"[가-힣]", register_master)), 70)
        self.assertGreaterEqual(len(re.findall(r"[가-힣]", machine_master)), 15)


if __name__ == "__main__":
    unittest.main()
