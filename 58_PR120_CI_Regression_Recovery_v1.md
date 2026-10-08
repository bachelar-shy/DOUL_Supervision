# 58. PR #120 CI Regression Recovery — Issues #121 / #122

## Baseline and root causes

The shared localization PR introduced two independent CI regressions:

- **#121 — mvp-development**: existing live API Browser E2E expected Korean role workspace and safety boundary labels that changed during localization. Seven `localization.spec.ts` tests designed for UI Mock were also automatically discovered by the live API Playwright config, yielding 10 E2E failures.
- **#122 — platform-container-baseline**: the image build installed root npm workspaces but omitted the new `packages/localization` manifest and source, causing `TS2307 @doul/localization` during Docker web build.

## Corrections

- Live API Playwright config excludes **only** `localization.spec.ts`, refuses to reuse unrelated listeners, and uses a new temporary SQLite database on each run to prevent cross-run Schedule baseline contamination. Existing live Contract/Schedule/Safety/Evidence tests remain enabled.
- Mock Playwright config runs **only** `localization.spec.ts` on its independent port.
- `mvp-development` CI runs both test configurations as explicit, separate required steps.
- Live API localization tests (`localization-live.spec.ts`) execute under the live test config at 390, 768 and 1440px, with CON / OWN / SUP role switches. They compare the UI's stable source record ID, version, status and command IDs to the authorized `/workspace` response across ko / vi / en, and reject any project mutation caused by switching language.
- The Korean role-aware workspace heading was restored via `app.workspaceRole` interpolation, maintaining the prior user-facing role distinction while supporting all three locales.
- Existing Safety regression text expectations were updated to current Korean field names **without removing** independent permit status, work authorization, stop links, resume conditions or equipment availability assertions.
- UI-only `data-record-id`, `data-record-status`, `data-record-version` and `data-command-id` attributes are stable test hooks. They do not change persistence, authority or API contracts.
- Web Docker build stage now includes both the `packages/localization/package.json` manifest before `npm ci` and its source before `npm run web:build`.
- Platform CI is now triggered by changes to `packages/localization/**` on PRs and main pushes.
- `tests/test_web_docker_workspaces.py` checks workspace manifest copy order and transitive local workspace dependencies needed for web builds.

## Verification commands

```bash
npm run test:contracts
npm run typecheck
npm run lint --workspace apps/web
npm run web:build
npx playwright test --config=playwright.config.ts
npx playwright test --config=playwright.localization.config.ts
python3 scripts/check_ui_boundary.py
```

Note: Mac mini has no Docker executable in the current shell. Static workspace checks and host builds cannot replace actual container build, runtime access, ARM64 verification, or platform CI results. Those must be confirmed on the GitHub Actions runner after push.

## Boundaries

- Korean is the present review baseline. **Vietnamese and English terminology remain unapproved drafts** per user direction.
- No database, domain state machine, authority matrix, audit semantics, evidence payload or statutory document output locale was modified.
- Issues in other feature branches (#123–#127 and older Safety/Payment/Backend issues) remain individually owned, and must not be presumed fixed by this PR.
