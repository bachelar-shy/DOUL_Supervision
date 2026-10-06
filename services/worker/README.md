# Backend worker / durable delivery v1

Related issue: #43. This implements the executable queue worker, not a selected
AI vendor, video decoder, or official inspection decision.

## Start

Use the development overlay from the repository root:

```sh
docker compose -f infra/compose/compose.dev.yml -f infra/compose/compose.worker.yml up --build
```

The overlay gives API and worker the **same PostgreSQL DATABASE_URL**, enables
API outbox recording, and executes `python -m services.worker --demo` after the
Platform bootstrap has verified Redis. The default provider fails explicitly
with `ADAPTER_NOT_CONFIGURED`; it never invents a successful media result.
`--fixture --demo` is solely for synthetic integration testing, never real data.
There is no human session credential in the worker command.

## Delivery and persistence

1. The authenticated API checks the existing RoleAssignment and Product guards.
2. AnalysisRun, exact source ID/version/hash, configuration/profile and outbox job
   commit together in the existing persistence transaction.
3. The dispatcher publishes IDs through QueuePort / Redis Streams. Redis never
   supplies domain payloads, authorities, source content or approval results.
4. The worker claims a DB lease and random fencing token before executing the
   existing `analysis_run:start` command as the scoped SYSTEM actor.
5. Normalized outputs are validated by the existing Product engine. Candidate
   observations, service audit and job completion commit in one DB transaction.
6. Only then is the Redis delivery acknowledged. Removing a transport hint does
   not delete the durable job, attempts, source evidence or business audit.

The snapshot adapter serializes writers (PostgreSQL SELECT FOR UPDATE or SQLite
BEGIN IMMEDIATE). A lease uses DB time. This is at-least-once delivery with a
fenced/idempotent DB result commit, **not exactly-once execution of external
provider side effects**. A future provider must use its own idempotency key.

Every ten seconds a new dispatch generation can be published from the committed
ledger, so transport outages, lost Redis data and busy duplicate deliveries do
not strand a job. Redis pending messages can also be reclaimed by XAUTOCLAIM.
A stale worker token cannot commit after another worker has reclaimed the job.

## Attempts, cancellation and failure

A positive `mediaPolicy.autoRetry.maxAttempts` is the total execution-attempt
ceiling, including the initial attempt. Zero disables automatic retries but
still permits the initial execution. Backoff values apply between attempts;
missing retry configuration defaults to **no automatic retry**. The configured
version and values are preserved with the job, not taken from a Redis message.
Only transient timeout/connection failures retry. Attempts retain safe reason
codes and timestamps. Expired leases consume an attempt; retries are bounded.

Cancellation and already-terminal domain state take precedence over late worker
results. Source hash mismatch, changed profile/configuration, invalid outputs
and unconfigured providers cannot become success. If a domain failure command
is itself blocked by current authority/prerequisite guards, the operational job
is dead-lettered with `domainFailureBlocked`; no guard is bypassed to tidy a queue.

SIGTERM/SIGINT stops new claims, leaves unprocessed deliveries pending, and exits
cleanly after the bounded current operation. Heartbeat transport failure is a
nonzero observable process failure. Compose restarts the process. ProviderPort
implementations must respect the supplied deadline (less than the claim lease).
The runtime does not authorize external transfer or select a paid model: those
remain explicit project/provider decisions before a provider is connected.

## Evidence

- `tests_mvp/test_worker_jobs.py`: real engine/persistence authorization, atomic
  outbox, replay, bounded retry, fencing, cancellation, source integrity and
  invalid-output rollback.
- `tests_runtime/test_worker_redis.py`: disposable real Redis/PostgreSQL,
  authenticated HTTP request, separate worker process, pending reclaim, abrupt
  process exit, recovery and graceful termination.
- `.github/workflows/backend-worker-integration.yml`: executes both sets.
- Existing container CI still verifies non-root, vulnerability policy and
  heartbeat/restart behavior, now with the Backend command connected.

System monitoring is implemented separately under #45. Business audit remains
owned by the existing domain engine. No state machine or authority matrix was
changed by this transport implementation.

References consulted through Context7: redis-py XGROUP CREATE / XREADGROUP / XACK
and Redis XAUTOCLAIM official documentation. The adapter deliberately uses Redis
7-compatible commands, not newer XADD idempotency options.
