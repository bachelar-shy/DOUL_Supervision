# DOUL Supervision Platform Foundation

This directory contains the platform-owned local container baseline. It does not
change Product/Functional contracts or replace the current local direct-run
workflow.

## Scope of this baseline

- API container using the existing FastAPI local-demo adapter
- Web build container and unprivileged Nginx runtime
- Same-origin `/api` reverse proxy from Web to API
- Local-only published ports
- Named volume for the existing SQLite development database
- Container health checks
- Environment-variable structure for non-secret development configuration

PostgreSQL, object storage, Redis, worker runtime, staging and production are
deliberately outside this PR.

## Prerequisite

Docker Engine / Docker Desktop with Compose v2 is required.

The current Mac mini development host did not have a Docker-compatible runtime
installed when this baseline was authored, so container execution must be
verified on a host with Docker before merge.

## Start

From the repository root:

```sh
cp infra/compose/.env.example infra/compose/.env
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml up --build
```

Expected endpoints:

- Web: http://127.0.0.1:5181
- API health: http://127.0.0.1:8791/health
- Web container health: http://127.0.0.1:5181/healthz

The Web runtime proxies `/api/*` to the API service inside the Compose
network, while the API itself remains an explicit demo-only adapter.

## Stop

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml down
```

To also remove the local development database volume:

```sh
docker compose --env-file infra/compose/.env -f infra/compose/compose.dev.yml down -v
```

Do not use `down -v` if the local demo state should be preserved.

## Existing direct-run workflow

The existing non-container workflow remains unchanged:

```sh
.venv/bin/python -m services.api --demo
npm run web
```

## Security boundary

This stack is Development Foundation only.

- Published ports are bound to `127.0.0.1`.
- The API still requires explicit demo mode.
- No production credential, real-site data, production authentication or legal
  signature adapter is configured.
- Secrets must not be committed to the repository.
