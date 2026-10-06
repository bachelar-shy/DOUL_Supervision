# Schedule source import — Backend v1

Baseline: origin/main c4f8764. Backend branch: backend/schedule-source-import-v1.
Unmerged Product dependency: product/schedule-source-import-v1. The dependency
files are present as local changes; no Product or Backend publication is implied.

POST /projects/{projectId}/schedule-source-imports accepts the Product-defined
ScheduleSourceImportPackage with Idempotency-Key. The preserved JSON evidence must
be uploaded and finalized first. JSON source consists of schedule, activities and
criticalActivityId; exclude sourceFileRef/sourceFileHash from its schedule. Exclude
clientObjectId/evidenceIds from source activities. Omitted logic arrays mean [].
The SHA-256 is computed over the original uploaded bytes, separately from content
comparison. JSON duplicate keys and nonfinite numbers are rejected during import.

The persistence transaction covers Schedule, immutable Activity snapshots, audit,
version history and idempotency. Scope, authority, exact source evidence version,
raw file hash and normalized content are checked. Critical/logic references and
activityCount are generated on the server. Trusted project qualification rules
supply minimumQualificationRank. Existing baseline/progress workflows remain the
only approval/activation/freeze routes. Supporting recovery imports have no such
workflow binding. Import never closes owner follow-up or decides entitlement.

GET /projects/{projectId}/schedule-source-imports/{objectId} returns original
Schedule version 1 and its exact Activity snapshots, even after later workflow
commands. Workspace publishes activities as read-only projections with no actions.
Existing legacy creation remains available; it cannot forge sourceImport metadata.
Imported source fields can be resent with identical values, but changes require a
new import package. Existing legacy records are not silently rebound.

Validation: tests_mvp/test_schedule_source_import_http.py uses actual JSON upload,
HTTP approval commands, SQLite restart, injected storage/partial-insert failures,
version/scope guards, baseline activation and progress freeze/correction.
tests_mvp/test_schedule_source_import_postgres.py reuses these scenarios against
real PostgreSQL and adds independent committed-state comparisons, a real SQL
transaction failure, retry after rollback, and a fresh-process workflow/replay
probe. Each case owns an isolated schema in an explicitly named test database.

On 2026-10-07, the PostgreSQL source-import module passed 30 tests (26 live database
cases and 4 isolation-safety unit cases); the full API suite passed 234 tests with
no skips. Product and Backend core/contract suites each passed 162 tests. A separate
controlled PostgreSQL server restart preserved four original schedules and their
workflow states, exact request replay and same-key/different-body rejection.
See SCHEDULE_SOURCE_IMPORT_POSTGRES_ACCEPTANCE.md for evidence and boundaries.

Status: API Implemented + Integration Tested for the source-import HTTP/persistence
boundary on SQLite and real PostgreSQL 16.2 using the development snapshot adapter.
This does not establish acceptance on the deployment container's PostgreSQL 16.15,
production authentication/TLS, a normalized relational schema, browser E2E, UI
Connected, or Field Validated. No Product business-contract semantics were changed
by the PostgreSQL acceptance work. XER/MSP/CSV parsers remain unimplemented;
normalized_json is the only supported input mode. Next: source-import UI connection.
