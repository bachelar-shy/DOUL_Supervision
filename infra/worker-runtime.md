# Development Worker Runtime

The Platform bootstrap verifies Redis connectivity and executes the Backend
command. The connected implementation is documented in
`services/worker/README.md` (QueuePort, durable outbox, attempts, fencing and
service-actor boundaries).

## Start

```sh
docker compose -f infra/compose/compose.dev.yml -f infra/compose/compose.worker.yml up --build
```

The development overlay enables the API outbox and supplies the same PostgreSQL
DATABASE_URL to API and worker. It explicitly executes
`python -m services.worker --demo`. The image default executes the same Backend
module without demo; it requires an already provisioned shared persistence
store. The `--idle` bootstrap remains an explicit diagnostic only, not the
normal worker command.

The worker has no published host port, runs as non-root UID 10002, and handles
SIGTERM/SIGINT. It writes a short-lived heartbeat to
`doul:worker:runtime:heartbeat` plus its own consumer key. Heartbeat is runtime
availability, never analysis completion or a business decision.

The default analysis provider is deliberately unconfigured. It produces an
explicit failed job rather than fabricated analysis. Synthetic integration
fixtures require both `--demo` and `--fixture` and are not for site records.
Model/provider selection and external-transfer authorization remain explicit
project decisions. Domain completion still goes through the existing Product
contract and service actors; no human login token is used by this process.

CI verifies real Redis/PostgreSQL delivery, process failure/recovery, cancellation,
idempotent result commit and graceful termination, as well as the existing image
security and restart/heartbeat gates. See issue #43 and
`.github/workflows/backend-worker-integration.yml`.
