# Development Worker Runtime

This is the Platform-owned development runtime scaffold for the future
asynchronous worker. It deliberately does not define queue payloads, retry
semantics, AnalysisRun transitions, worker authorization, AI-provider calls or
Product/Functional rules.

## Boundary

The runtime currently provides:

- a separate non-root worker container
- the existing locked API Python dependencies and application code
- Redis connectivity through `REDIS_URL`
- a Redis heartbeat for runtime observability
- pass-through PostgreSQL and object-storage configuration for a future Backend
  worker command
- a bootstrap that checks Redis before executing a Backend-supplied command

The default command is an idle heartbeat loop. It does **not** consume
`AnalysisRun` jobs and must not be described as a connected media worker.

Backend owns the queue port/adapter, queue message schema, idempotency, retries,
claiming, job transitions and application worker command. Product/Functional
owns user-visible workflow meaning.

## Start with the development stack

From the repository root:

```sh
docker compose \
  --env-file infra/compose/.env \
  -f infra/compose/compose.dev.yml \
  -f infra/compose/compose.worker.yml \
  up --build
```

The worker has no published host port.

## Runtime signals

The default runtime writes a short-lived heartbeat key to Redis:

```text
doul:worker:runtime:heartbeat
```

This heartbeat means only that the worker container is alive and can reach
Redis. It does not mean the business queue is healthy or that media analysis is
being processed.

The default environment is:

```text
DOUL_WORKER_QUEUE=media-analysis
DOUL_WORKER_CONCURRENCY=1
DOUL_WORKER_HEARTBEAT_KEY=doul:worker:runtime:heartbeat
DOUL_WORKER_HEARTBEAT_INTERVAL=5
DOUL_WORKER_HEARTBEAT_TTL=30
```

These are Platform runtime defaults, not Product/Functional contract fields.

## Backend handoff

Once Backend provides an executable worker command, the container can use the
same bootstrap as an entrypoint. Container arguments other than `--idle` and
`--check` are executed only after Redis PING succeeds.

Example shape only:

```text
worker-runtime entrypoint
  -> validate REDIS_URL
  -> Redis PING
  -> exec Backend-owned worker command
```

The actual Backend module/command must be supplied by the Backend branch rather
than guessed in Platform code.
