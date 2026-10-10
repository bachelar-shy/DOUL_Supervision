# Media analysis browser handoff

The media analysis browser work is on `goal/media-analysis-browser-v1`. It is based on current main commit `6a24662bd6c63d82d8c890a8f02044e77cd84b12` (merged as `e1feea4`) and includes feature checkpoints `74ff50e` and `ec08049`. The panel is reachable from Capture and uses the existing supervision client and server commands for upload, queue/status, human review, and Issue creation. It does not add a worker, provider, server schema, or dependencies.

The branch adds stable idempotency keys and payloads for uncertain queue/Issue responses, prevents duplicate submission after a known successful mutation whose refresh fails, and guards asynchronous run loads against stale responses. Project or role changes clear the previous review state. Coverage and evidence references remain visible when a run is incomplete or returns no findings. Run/candidate/inspection statuses use the shared localization catalog with media-specific fallbacks; media readiness blockers and Issue subtype labels are also localized. The Issue subtype selector sends the exact values in the server Issue enum: `NCR`, `Defect`, and `Safety` (see `app/schema/domain_model_v2.json` and `app/types/supervision.ts`).

## Verification

The local verification used Node 24.19.0, npm 12.2.0, Python 3.12.14, an isolated worktree and ephemeral API/SQLite fixture. npm's cache was outside the repository at `/tmp/doul-media-npm-cache`.

```sh
npm_config_cache=/tmp/doul-media-npm-cache npx --yes --package=npm@12.2.0 npm ci
npm_config_cache=/tmp/doul-media-npm-cache npx --yes --package=npm@12.2.0 -c 'python3 scripts/dependency_environment.py --node-only'
npm_config_cache=/tmp/doul-media-npm-cache npx --yes --package=npm@12.2.0 npm run test:braces-backport
npm_config_cache=/tmp/doul-media-npm-cache npx --yes --package=npm@12.2.0 npm run test:node-forge-backport
DOUL_MEDIA_PYTHON=/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 CHROMIUM_PATH=/usr/bin/chromium ./node_modules/.bin/playwright test -c .local/media-analysis-playwright.config.ts --reporter=line
```

On the merged current-main base, `npm ci` completed and its postinstall applied both pinned local backports. The node-only dependency guard reported `ok: true`, including verified braces and node-forge patch hashes. Both backport regression suites passed, including Expo signing compatibility for node-forge. The media browser acceptance passed on the merged base before the final localization assertions, then was rerun with explicit ko/vi/en status and blocker assertions, plus a successful `Defect` Issue creation and persisted subtype check. The browser config is intentionally ignored local state at `.local/media-analysis-playwright.config.ts`; it starts its own web/API fixture and does not belong in source control. The broader `check:dependencies` command was also attempted, but its Python inventory check reports that this shared runtime lacks the dedicated virtualenv and several locked Python distributions; its Node section showed no dependency errors. This does not waive or alter that check.

## Fixture and trust boundaries

Browser-created evidence and worker results are explicitly synthetic demonstration data. The fixture's development worker marks its output `synthetic_fixture`; it is not a real media provider, live pilot, or production analysis. This run verifies request wiring, policy gates, persistence, review commands, source binding, and eligible-only Issue behavior. It provides no claim about model accuracy, detection quality, completeness on real recordings, or production-provider readiness.

The browser does not simulate official approval or verification. Candidate confirm/reject operations use server-provided command descriptors, authority checks, and the existing human-confirmation API. Issue creation is offered only for candidates the server reports as eligible and confirmed, and its persisted evidence references are checked against the API-issued original source reference. Inferred, rejected, unconfirmed, speech-only, and otherwise blocked candidates are not treated as Issue-ready. The trusted-inspection view presents server-backed inspection context; it is not an independent finding or a substitute for authorized human review. When a worker/provider is absent or policy/capability disables analysis, the UI exposes that state and does not manufacture results.
