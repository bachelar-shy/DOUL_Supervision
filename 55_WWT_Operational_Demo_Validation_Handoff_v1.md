# 55. WWT Operational Demo Validation Handoff

Date: 2026-10-10. Status: PARTIAL — not Mock-based development/usability completion, not pilot, not operational acceptance.

## Separation
The WWT demo uses the genuine development FastAPI upload/Evidence/workspace and SQLite snapshot persistence on an isolated database. No UI-only mocked approvals. Synthetic materials are never site evidence or owner approved project baseline.

## Execution
Start the server using DOUL_DEMO_PROFILE=wwt, python -m services.api --demo --port 8793 --database .local/wwt-demo/operational.sqlite3. After reading the exact dedicated WWT project UUID from `POST /dev/sessions` on port 8793, execute `python scripts/wwt_demo_operational.py --api http://127.0.0.1:8793 --expected-project-id <WWT_PROJECT_UUID>`. The importer refuses any normal demo profile or mismatched project ID before writing evidence; the `--api` loopback target is mandatory. Use the project-specific database only and keep port 8793 loopback bound. For clean regeneration, stop this specific server, back up and remove only the dedicated SQLite database, then restart and rerun. Never wipe any operating environment.

## Data and provenance
The project name, location, package, date/timezone, VND/SI, Korean record language and testing defaults are test assumptions. Demo actors SUP/CON/OWN/DES/ADM are fictional; rank 3 is a synthetic valid qualification. Never use real identities or certificates. The generated 20 PNGs are deterministic **diagrams** with a synthetic-not-evidence label in PNG metadata, not actual construction photographs. They are linked to synthetic case IDs and stages in server Evidence metadata, with six distinct persisted ZONE-A~F Location IDs and an explicit SYNTHETIC_NOT_SITE_EVIDENCE label; the same metadata is accessible in the Evidence detail view. The image-generation contact sheet was produced separately and is not uploaded to the API as twenty photographic Evidence objects. The 20-file manifest is in .local/wwt-demo/manifest.json with file IDs, cases, stages, zone, timestamp, SHA-256 and expectation. All of this is synthetic, not source-document facts.

WWT source PDF, bidding BOQ, and schedule and the previously prepared 20 register scenarios were not linked to this demo in this run. They must be located from prior delivery (without requesting the user again) and differentiated from assumptions; bidding materials cannot be marked approved baselines.

## Verified scope
Development session login, workspace read, 20 actual resumable uploads, completion, downloads, content hashes, cross-project denial HTTP 404, repeated run without additional objects (per existing manifest and deterministic capture IDs). The 20-file importer now validates actual Evidence location IDs, case/stage/synthetic labels, repeat runs and persistence after API restart in a dedicated test. Full QA/SAFETY/SCHEDULE/PAYMENT/HANDOVER state-machine E2E, HTTP stale-version/offline/payment corrections, actual browser interaction, different-project users, qualification-denial roles, self-hosted runner CI, and process restart persistence are **NOT VERIFIED HERE**. Record these as open until run with evidence. Do not mark pilot_verified or mock validation completed.

## Next validation
Locate actual documents and original example cases, wire each Evidence to register records and workflow states, test AC-Q-01/AC-S-01/AC-SCH-01/AC-PAY-01/AC-HO-01 and negative paths on real API, test real pages with Playwright, validate restart and self-hosted CI, and document release/field acceptance separately. No claims of actual field acceptance.
