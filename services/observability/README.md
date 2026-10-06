# Operational monitoring and alert delivery v1

Issue #45. System telemetry is separate from the immutable domain AuditEvent
history. It must not issue, approve, close or alter a business record.

## Executable monitor

```sh
python -m services.observability --demo                 # development, one snapshot
python -m services.observability --interval 30          # provisioned environment
```

The monitor needs DATABASE_URL, REDIS_URL and OBJECT_STORAGE_* configuration.
Outside development, secrets must be supplied using their `_FILE` counterparts;
raw environment secrets and insecure service URLs are rejected. The Redis
monitor does not create a consumer group or consume jobs.

Signals include actual durable-job counts, oldest ready age, retries, recent
attempt failures and dead letters, execution/end-to-end latency, Redis pending
and lag, per-consumer heartbeat availability, PostgreSQL database bytes and
retained S3 object-version bytes. Failed probes are errors, not zero-valued
success. Large bucket scans are bounded and explicitly report incomplete data.

Logical database/bucket bytes are **not physical free disk**. Optional read-only
mounts `DOUL_DATABASE_VOLUME_PATH` and `DOUL_OBJECT_VOLUME_PATH` provide actual
filesystem used/free/total values. Storage-volume exporters or equivalent
provider metrics remain necessary for managed services where mounts do not
exist. `DOUL_DATABASE_CAPACITY_BYTES` / `DOUL_OBJECT_CAPACITY_BYTES` are explicit
operational budgets, never invented physical capacities.

`DOUL_API_HEALTH_URL` should point to `/ready`, which checks the persistence
transaction and provisioning, not merely that the HTTP process is alive.
`DOUL_EXPECTED_WORKERS` defaults to one. An idle heartbeat does not imply a
successful analysis or a healthy business decision queue.

## Structured API and Worker logs

The shared formatter uses an allowlist. API logs contain method, route template,
server-generated request ID, result code and latency. They exclude actual path
identifiers, query strings, request/response bodies, tokens, headers and raw
exception messages. Third-party logger tracebacks are reduced to error type;
Uvicorn's raw access log is disabled in the supplied entrypoints. The Worker
emits safe operational result codes and its durable job identifier.

This intentionally favors secret safety over verbose library diagnostics. Use
controlled, redacted troubleshooting outside the normal system log when needed.
Domain AuditEvent records still come only from the existing command engine.

## Alert hook and durable delivery

Set `DOUL_ALERT_ENDPOINT` to an approved HTTPS receiver and provide a dedicated
`DOUL_ALERT_TOKEN_FILE`. The monitor persists transitions in a private directory
(`DOUL_MONITOR_STATE_DIR`, default `.local/monitor`) before attempting delivery.
The endpoint identity is bound to the spool; changing recipients with pending
messages requires explicit operational handoff. Credentials are never stored in
the spool. Redirects and inherited HTTP proxy settings are not followed.

Alerts carry only component, safe classification, severity, firing/resolved
state, timestamp and a globally distinct delivery ID. The same ID is supplied
as `Idempotency-Key` on retries. The receiver must deduplicate by that key.
Delivery is at-least-once, not exactly once. Failures retain the outbox across
process restarts; bounded backoff avoids a tight loop. A full outbox fails
visibly instead of discarding incidents. Repeated unchanged conditions do not
emit duplicate firing transitions; recovery produces a resolved transition.

Default technical guardrails are a 300-second ready-age and 90% configured
capacity budget. They can be configured by operations and do not redefine
Product P1-P4 report priorities or contractual deadlines. In staging/pilot an
absent alert receiver prevents a healthy monitor result.

## Operational ownership and retention

Platform operations owns collection, alert receiver configuration, spool health,
service restart and incident response. Backend owns classified job failures and
queue semantics. Project managers own business-report decisions, not this hook.
The deployment configuration must name actual monitoring and on-call owners;
this document does not fabricate named approval or a live recipient.

Configure container/collector log rotation and retention separately from
business audit retention. Never remove domain audit/evidence to free a log
volume. Alert receiver outages are themselves exposed in the monitor summary;
an external supervisor must also alert when the monitor process is absent.

## Verification

`tests_mvp/test_observability.py` covers 13 unit/in-process integration cases,
including a real local HTTP receiver, retry across dispatcher restart, redirect
refusal, token secrecy, source-independent metrics and unchanged business audit.
`tests_runtime/observability_live.py` and the platform-observability workflow
exercise a disposable real PostgreSQL/Redis/Worker/RustFS stack, authenticated
object size inventory and API readiness. A test receiver is not a claim that a
real site's alert channel has been configured or that Pilot is approved.
