# UI development boundary

This directory is the presentation layer for DOUL Supervision.

- Keep Domain, State Machine, Authority, Gate, DB, storage, AI, notification, and legal-signature behavior outside `apps/web/src/pages/**` and `apps/web/src/ui/**`.
- Do not import `@doul/client` directly from `app/**`, `pages/**`, or `ui/**`.
- Do not call `fetch()` directly from those presentation directories.
- Use `data/supervision-client.ts` as the UI/function integration boundary.
- Treat `data/ui-contract.ts` as the UI-facing type boundary.
- Do not invent workflow states, permissions, approvals, or commands in UI code. Render server-provided state and available commands.
- Use `npm run web:mock` for UI-only work that must not depend on the development API.
- Mock mode must never simulate a real approval, closure, upload, or official issuance.
- Run `npm run check:ui-boundary`, web typecheck/lint/build, and Playwright tests before merging UI changes.

See `../../25_UI_Function_Parallel_Development.md` for the full ownership and merge rules.
