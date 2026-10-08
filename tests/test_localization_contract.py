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


    def test_active_a4_form_fields_have_visible_terms_in_all_three_languages(self):
        catalog_source = (
            ROOT / "packages/localization/src/form-field-labels.ts"
        ).read_text()
        labels = re.findall(
            r'^\s+"([^"]+)": \{ ko: "([^"]+)", vi: "([^"]+)", en: "([^"]+)" \},',
            catalog_source,
            flags=re.MULTILINE,
        )
        self.assertEqual(len(labels), len({row[0] for row in labels}))
        schema = json.loads(
            (ROOT / "app/forms/form_data_schemas_v1.json").read_text()
        )["forms"]
        active = ["FM-09", "FM-12", "FM-19", "FM-20", "FM-21"]
        expected = {
            field
            for form_id in active
            for field in schema[form_id]["scalar_fields"]
        }
        self.assertEqual({row[0] for row in labels}, expected)
        for field, korean, vietnamese, english in labels:
            for language_label in (korean, vietnamese, english):
                self.assertTrue(language_label.strip(), field)
        doc_page = (ROOT / "apps/web/src/pages/DocumentPage.tsx").read_text()
        self.assertIn("formFieldLabel(f, i18n.resolvedLanguage", doc_page)
        self.assertIn("name={f}", doc_page)

    def test_field_capture_and_document_ui_have_no_hardcoded_korean(self):
        paths = [
            "apps/web/src/pages/CapturePage.tsx",
            "apps/web/src/pages/DocumentPage.tsx",
            "apps/web/src/pages/shared.tsx",
            "apps/web/src/pages/evidence-utils.ts",
            "apps/web/src/ui/index.tsx",
        ]
        offenders = [
            path
            for path in paths
            if re.search(r"[가-힣]", (ROOT / path).read_text())
        ]
        self.assertEqual(offenders, [])

    def test_new_locale_keys_have_korean_vietnamese_and_english_labels(self):
        src = (ROOT / "packages/localization/src/index.ts").read_text()
        relevant_files = [
            "apps/web/src/app/AppShell.tsx",
            "apps/web/src/pages/CapturePage.tsx",
            "apps/web/src/pages/DocumentPage.tsx",
            "apps/web/src/pages/shared.tsx",
            "apps/web/src/pages/evidence-utils.ts",
            "apps/web/src/ui/index.tsx",
        ]
        callsites = "\n".join((ROOT / path).read_text() for path in relevant_files)
        required_keys = set(re.findall(
            r'(?:\bt|i18n\.t)\("((?:capture|document|record|floorPlan|app|ui|evidence)\.[^"]+)"',
            callsites,
        ))
        required_keys.discard("document.form.")
        for form_id in ("FM-09", "FM-12", "FM-19", "FM-20", "FM-21"):
            required_keys.add(f"document.form.{form_id}")
        for key in sorted(required_keys):
            occurrences = re.findall(
                r'^\s*"' + re.escape(key) + r'":\s*"[^"]*",?',
                src,
                flags=re.MULTILINE,
            )
            self.assertEqual(len(occurrences), 3, f"Incomplete locale coverage for {key}")


    def test_contract_screen_uses_identical_translation_keys_in_all_locales(self):
        catalog = (ROOT / "packages/localization/src/contract-translations.ts").read_text()

        def translations(locale):
            block = re.search(
                r"export const contract" + locale + r" = \{([\s\S]*?)\} as const;",
                catalog,
            )
            self.assertIsNotNone(block, locale)
            return dict(re.findall(
                r'^\s*"(contract\.[^"]+)": "([^"]*)",?',
                block.group(1),
                flags=re.MULTILINE,
            ))

        masters = translations("Ko")
        self.assertGreaterEqual(len(masters), 90)
        for locale in ("Vi", "En"):
            draft = translations(locale)
            self.assertEqual(masters.keys(), draft.keys(), locale)
            for key, value in draft.items():
                self.assertTrue(value.strip(), (locale, key))
                self.assertEqual(
                    set(re.findall(r"\{\{([^}]+)\}\}", masters[key])),
                    set(re.findall(r"\{\{([^}]+)\}\}", value)),
                    (locale, key),
                )

        page = (ROOT / "apps/web/src/pages/ContractPage.tsx").read_text()
        self.assertIsNone(re.search(r"[가-힣]", page))
        used_keys = set(re.findall(r'tr\("(contract\.[^"]+)"', page))
        self.assertFalse(used_keys - masters.keys())
        self.assertIn('tr("contract.create.mockPreviewNotice")', page)
        self.assertIn('disabled={busy || !online || client.kind === "mock"}', page)

    def test_evidence_detail_master_and_draft_keys_match(self):
        catalog = (ROOT / "packages/localization/src/index.ts").read_text()
        drafts = (
            ROOT / "packages/localization/src/evidence-translations.ts"
        ).read_text()

        def from_block(source, start, end):
            block = source.split(start, 1)[1].split(end, 1)[0]
            return dict(re.findall(
                r'^\s*"(evidence\.[^"]+)": "([^"]*)",?',
                block,
                flags=re.MULTILINE,
            ))

        ko = from_block(catalog, "const ko = {", "} as const;")
        self.assertGreaterEqual(len(ko), 40)
        for locale, start, end in (
            ("Vi", "const vi: DraftTranslationDictionary = {", "};"),
            ("En", "const en: DraftTranslationDictionary = {", "};"),
        ):
            inline = from_block(catalog, start, end)
            extra = from_block(
                drafts, f"export const evidenceDraft{locale} = {{", "} as const;"
            )
            self.assertFalse(inline.keys() & extra.keys())
            translated = dict(inline, **extra)
            self.assertEqual(ko.keys(), translated.keys(), locale)
            for key, master in ko.items():
                self.assertTrue(translated[key].strip(), (locale, key))
                self.assertEqual(
                    set(re.findall(r"\{\{([^}]+)\}\}", master)),
                    set(re.findall(r"\{\{([^}]+)\}\}", translated[key])),
                    (locale, key),
                )

        page = (ROOT / "apps/web/src/pages/EvidenceDetailPreview.tsx").read_text()
        self.assertIsNone(re.search(r"[가-힣]", page))
        used_keys = set(re.findall(r'tr\("(evidence\.[^"]+)"', page))
        self.assertFalse(used_keys - ko.keys())
        self.assertIn('JSON.stringify(metadata, null, 2)', page)

    def test_draft_locales_remain_unapproved(self):
        src = (ROOT / "packages/localization/src/index.ts").read_text()
        for language in ("vi", "en"):
            block = src.split('code: "' + language + '"', 1)[1].split("},", 1)[0]
            self.assertIn('translationStatus: "draft"', block)
        for locale in ("vi", "en"):
            setting = next(
                item for item in self.contract["initialLocales"]
                if item["language"] == locale
            )
            self.assertEqual(setting["status"], "draft_requires_field_review")

if __name__ == "__main__":
    unittest.main()
