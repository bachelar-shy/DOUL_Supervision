# DOUL Supervision Platform Foundation

This directory contains the Platform-owned local container environment. It does
not change Product/Functional contracts and does not replace the direct-run
application workflow.

## Current development stack

- Web: Vite build served by an unprivileged Nginx runtime
- API: existing FastAPI local-demo adapter
- PostgreSQL 16: development database runtime
- Redis 7.4: development queue/cache runtime
- S3-compatible object storage: development-only MinIO runtime
- Object-storage bootstrap: creates the configured bucket and explicitly keeps
  anonymous access disabled

The application boundary remains unchanged in this phase:

- the API still uses the SQLite development Store
- PostgreSQL is available but is not yet the API persistence adapter
- Redis is available but no production queue producer/consumer is connected
- S3-compatible storage is available but uploads still use the current SQLite
  blob adapter
- no production authentication, AI provider, legal signature or PDF/DOCX
  adapter is configured

Those integrations belong to Backend interface work and later Platform
integration PRs.

## Object-storage implementation note

MinIO upstream was archived in 2026. For local S3-compatibility testing this
repository builds the final upstream security release directly from source
(`RELEASE.2025-10-15T17-29-55Z`) instead of pinning the earlier prebuilt
container release. The development image also builds the last upstream `mc`
client release for bucket bootstrap.

This is a development test dependency, not a Production object-storage
selection.

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

The example file publishes the planned Backend/Platform interface names:

```text
DATABASE_URL
REDIS_URL
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_ACCESS_KEY
OBJECT_STORAGE_SECRET_KEY
OBJECT_STORAGE_REGION
```

These values describe how future Backend adapters can reach the services from
inside Compose. The current API does not consume them yet.

## Verify data services

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml exec postgres \
  sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml exec redis \
  redis-cli ping

curl -fsS http://127.0.0.1:9000/minio/health/ready
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
