# 56. Field UI Localization Acceptance — Slice 1

## 1. Scope

Branch: `frontend/i18n-foundation-v1` (continuation of PR #120).

This slice expands the shared localization foundation from navigation and major
workspaces to field capture, device evidence, A4 draft creation, record lists,
status badges, KPI units and global page guidance.

In scope:
- `apps/web/src/app/AppShell.tsx`: page descriptions, offline boundary,
  refresh/capture/retry actions, errors, loading and footer
- `apps/web/src/pages/CapturePage.tsx`: device-original lifecycle, upload
  limits, evidence status and source/media terms
- `apps/web/src/pages/DocumentPage.tsx`: five A4 form titles, preview notices,
  source selection, field labels, draft-only / legally issued distinction
- `apps/web/src/pages/shared.tsx`, `evidence-utils.ts`, `ui/index.tsx`:
  common record rows, sample floor-plan captions, original/derived evidence
  and standard status/KPI fallbacks
- `apps/web/src/App.css`: human-readable field labels and narrow-viewport
  header controls

## 2. Form-field terminology

`packages/localization/src/form-field-labels.ts` has **57 distinct scalar-field
paths**, matching the source schema in `app/forms/form_data_schemas_v1.json`
across FM-09, FM-12, FM-19, FM-20 and FM-21.

The schema path (such as `urgent.fact`) remains the authority for the form
payload and is never translated. `formFieldLabel(path, locale)` returns
presentation text only and falls back to the Korean master label for languages
not yet implemented. Vietnamese and English labels are draft candidates
requiring local site/legal review.

The document HTML rendering call still uses its existing independent output
language. Switching UI language does **not** change a document's statutory
language, source record version or output hash.

Mock preview form fields are representative UI fixtures only. They cannot
issue legally effective documents and are not the official A4 schema.

## 3. UI switching and regression gates

Isolated browser suite:
```
npx playwright test --config=playwright.localization.config.ts
```

This uses UI-mock mode on port 5192, with no dependency on other worktrees'
Python environments, demo databases or running servers.

Checks:
- Korean → Vietnamese → English → Korean live switching
- HTML `lang` updates and stored preference across reload
- exact `FM-20` code and `urgent.fact` field path remain stable
- manually entered field values remain unchanged by locale switching
- locale switching does not trigger document-rendering POST
- Capture and Document views fit 390px and 1440px viewports

Static gates:
```
python3 -m unittest tests.test_localization_contract -v
npm run typecheck
npm run web:build
python3 scripts/validate_contracts.py
python3 scripts/check_ui_boundary.py
git diff --check
```

## 4. Explicit non-goals / remaining items

1. Full human validation of Vietnamese and English site/contract terminology.
2. Translation of remaining ContractPage creation-dialog text and
   EvidenceDetailPreview explanation/errors.
3. UI/Document locale independent output **selection** and A4 bilingual
   rendering; the statutory Vietnamese Final requirement remains authoritative.
4. Server-originated error messages and user-authored source records are not
   silently translated. Domain identifiers are never altered.
5. Authenticated end-to-end execution and legally effective approvals are
   **not** covered by the UI-mock browser suite.

Do not mark entire app translation as Final based on this slice. Remaining
work must pass local staff language review and role-based field pilot.
