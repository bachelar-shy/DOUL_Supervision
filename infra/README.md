# DOUL Supervision Platform Foundation

This directory contains the Platform-owned local container environment. It does
not change Product/Functional contracts and does not replace the direct-run
application workflow.

## Current development stack

- Web: Vite build served by an unprivileged Nginx runtime
- API: existing FastAPI local-demo adapter
- PostgreSQL 16.15: non-root development database runtime
- Redis 7.4.11: development queue/cache runtime
- S3-compatible object storage: RustFS 1.0.1 development runtime
- Object-storage bootstrap: creates the configured bucket and explicitly restores
  private anonymous-access policy

The application boundary remains unchanged in this phase:

- when the Backend PostgreSQL snapshot adapter is present and `DATABASE_URL`
  is configured, the Compose API uses PostgreSQL for snapshot state and blobs
- when the Backend PostgreSQL adapter is not yet present, the development
  entrypoint safely keeps the SQLite fallback even if `DATABASE_URL` is configured;
  once the adapter is present, the same configuration selects PostgreSQL
- when `DATABASE_URL` is empty, the existing SQLite development adapter remains
  available for direct local/test fallback
- the Compose API waits for the PostgreSQL healthcheck before starting
- Redis is available but no production queue producer/consumer is connected
- S3-compatible storage is available but uploads remain on the selected snapshot
  persistence adapter until a separate object-storage adapter is connected
- no production authentication, AI provider, legal signature or PDF/DOCX
  adapter is configured

The persistence selection is deployment configuration only and does not change
Product/Functional contracts.

## Object-storage implementation note

The development S3-compatible runtime uses RustFS 1.0.1 and the pinned
RustFS rc v0.1.36 client. The server runs as non-root UID/GID 10001, while
one-shot permission helpers prepare named volumes before PostgreSQL and RustFS
start.

The bucket bootstrap is idempotent and explicitly applies private anonymous
access on every run. CI also creates a public-download policy deliberately and
verifies that rerunning the bootstrap removes that exposure without deleting
the authenticated object.

The Backend/Platform interface remains generic `OBJECT_STORAGE_*`. Using
RustFS in Development does not select the Production object-storage service.

## Prerequisite

Docker Engine / Docker Desktop with Compose v2 is required.

The current Mac mini development host does not have a Docker-compatible runtime
installed. Actual image build and Compose smoke verification therefore also run
in GitHub Actions.

## Configure

From the repository root:

```sh
cp infra/compose/.env.example infra/compose/.env
```

The checked-in example values are disposable local defaults only. Replace them
in the ignored `infra/compose/.env` file when desired. Never place staging or
production credentials in the repository.

## Start

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml up --build
```

Expected loopback endpoints:

- Web: http://127.0.0.1:5181
- API health: http://127.0.0.1:8791/health
- PostgreSQL: 127.0.0.1:5432
- Redis: 127.0.0.1:6379
- Object Storage API: http://127.0.0.1:9000
- Object Storage Console: http://127.0.0.1:9001
- Web container health: http://127.0.0.1:5181/healthz

All published development ports bind to loopback only.

The API development Origin allowlist is derived from the published Web/API
ports. Changing `DOUL_WEB_PORT_PUBLISHED` therefore updates login/CORS
validation for both `127.0.0.1` and `localhost`; arbitrary external origins
remain rejected. Direct non-Compose API runs can set a comma-separated
`DOUL_API_ALLOWED_ORIGINS`, but only loopback HTTP origins are accepted.

## Development service contract

The example file publishes the Backend/Platform interface names:

```text
DATABASE_URL
REDIS_URL
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_ACCESS_KEY
OBJECT_STORAGE_SECRET_KEY
OBJECT_STORAGE_REGION
```

These values describe how Backend adapters reach the services from inside
Compose. `DATABASE_URL` selects the PostgreSQL snapshot adapter when that
Backend adapter is available. Before that adapter lands, the development
entrypoint keeps the SQLite fallback so the Platform change can be integrated
independently; leaving `DATABASE_URL` empty also preserves the SQLite fallback.

## Verify data services

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml exec postgres \
  sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml exec redis \
  redis-cli ping

curl -fsS http://127.0.0.1:9000/health
```

The one-shot `object-storage-init` service creates the configured bucket with
anonymous access disabled.

## Stop

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml down
```

To also remove all local development data:

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml down -v
```

Do not use `down -v` when local test state should be preserved.

## Existing direct-run workflow

The existing non-container workflow remains unchanged:

```sh
.venv/bin/python -m services.api --demo
npm run web
```

## Security boundary

This stack is Development Foundation only.

- published ports are bound to `127.0.0.1`
- development passwords are disposable local defaults, not production secrets
- the API still requires explicit demo mode
- the object-storage bucket is not anonymous/public
- production credentials, real-site data and production service accounts must
  not be used in this stack

The container workflows enforce the current Phase 1 image-security baseline:

- API, Web, PostgreSQL, Worker and RustFS runtime images must declare non-root
  users.
- Development runtime images are scanned for HIGH and CRITICAL vulnerabilities.
- Fixable CRITICAL findings and end-of-life operating-system images fail CI.
- Unfixed findings remain visible for review and are not silently allowlisted.
- Production digest pinning, signing/SBOM, secret management and release
  approval remain separate Production-hardening work.
