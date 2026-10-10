# Development, staging and pilot deployment boundaries

Issue #48. This provides executable environment preparation, migration,
authentication, HTTPS and release/rollback verification. It does not create an
actual site's accounts, choose its identity provider, approve a pilot, or deploy
real-site data automatically.

## Environments

Development continues to use `compose.dev.yml` and the explicit demo adapters.
Staging and pilot use `compose.operational.yml` plus their corresponding
`compose.staging.yml` or `compose.pilot.yml`. They have distinct Compose project
names, volumes, queue namespaces, secret files and configuration. Never combine
an operational profile with the development profile or reuse demo credentials.

Only the TLS Web/API proxy publishes a host port. API, worker and monitor run
non-root with read-only root filesystems, dropped capabilities, no-new-privileges,
finite temporary storage and rotated system logs. The operator selects explicit
image digests, public origin, storage capacity budgets and alert receiver.

## Identity and provisioning

For administrator-issued username/password authentication, set `DOUL_AUTH_MODE=local-password` and supply the matching signing private key as an operator-controlled secret. This optional login flow uses the existing pinned RS256 verification and server-side Party/RoleAssignment authorization. See [`services/deployment/PASSWORD_LOGIN.md`](../../services/deployment/PASSWORD_LOGIN.md) for first-administrator bootstrap, credential creation, operational limits, and field acceptance blockers. The general external IdP guidance below remains applicable when local-password mode is not chosen.

Non-demo API startup requires an approved, explicitly provisioned DB and an
RSA public key, fixed key ID, issuer and audience. Access tokens must use RS256,
have required bounded timestamps and an explicit subject. Token-provided roles,
key URLs and algorithm changes are not trusted. The issuer/subject is mapped to
a server-side Party and default RoleAssignment; current database assignments,
project scope, qualification and the existing authority matrix remain decisive.
Revoked bindings, changed credential-valid-after times and disabled parties are
rechecked. SYSTEM/AI identities cannot log in as humans.

Operational APIs do not expose `/dev/*`, demo session issuance or automatic
OpenAPI documentation. An existing browser demo login is NOT an operational
identity flow. Before real pilot users are admitted, the chosen identity
provider must issue audience-specific access tokens and its reviewed browser
login integration must be connected and accepted. The deployment rehearsal
verifies signed-token API access and the Web shell, not a fabricated complete
browser SSO integration. This external integration is an activation prerequisite,
not replaced by a UI role picker or pasted demonstration token.

Normal staging/pilot startup never performs DDL or seeds demonstration data.
Use the explicit operator command before starting services:

```sh
python -m services.deployment.migrate migrate-v1
python -m services.deployment.migrate provision-new \
  --snapshot /operator/approved-foundation.json \
  --approved-sha256 APPROVED_CANONICAL_SNAPSHOT_SHA256
```

The migration command uses `DATABASE_ADMIN_URL_FILE`, takes a database advisory
lock and supports only snapshot format 1. It refuses unknown versions rather
than attempting an unreviewed upgrade or downgrade. Provisioning only accepts a
new empty store and exact approved foundation records (Project, Party,
RoleAssignment, Qualification and Requirement); it cannot fabricate official
workflow history, audit events, document signatures or completed worker jobs.
The canonical approved snapshot hash is checked. Real qualification evidence,
role assignments and approval records must be supplied by the responsible
project administrators; the repository does not invent them.

For an existing application, keep its current state and add approved identity
bindings through a reviewed migration; do not use `provision-new` to overwrite
it. The migration fixture used in CI is explicitly synthetic and staging-only.

## Secret files and transport

Create separate operator-managed files listed in `compose.operational.yml`.
No secret values belong in Git, deployment plans, command arguments or logs.
Examples in `operational.env.example` contain only non-secret names/placeholders
and intentionally fail until completed.

Use dedicated credentials for API, worker, monitor and migration. API/worker DB
roles need SELECT/INSERT/UPDATE on the snapshot/blob tables; ordinary operation
does not need DDL or DELETE. The monitor DB role needs SELECT and database-size
queries only. The Redis worker needs the reviewed Streams/heartbeat operations;
the monitor needs only PING/SCAN/TTL/XLEN/XPENDING/XINFO. Grant object monitoring
only version-list/tag/read access. Do not give every component a storage root
key merely because development uses one.

Private secret files should be `0600` owned by the container UID that reads
them. The proxy reads TLS key material as UID 101, API/monitor use UID 10001,
and the worker uses UID 10002. Public trust material can be owner/group readable
without other access. The application rejects symlinks, oversized files, raw
secret environment values outside development and unsafe permissions. Bind
mounts must have accessible parent directories in the container. Use secret
manager delivery rather than recursive permission changes on user directories.

Pilot PostgreSQL requires `sslmode=verify-full` and a trusted `sslrootcert`;
Redis requires `rediss`. The profiles mount `service-ca-bundle` at
`/run/secrets/service-ca-bundle` and set SSL_CERT_FILE/AWS_CA_BUNDLE. Use the same
path in the approved PostgreSQL DSN and Redis `ssl_ca_certs` option when custom
service CAs are required. Do not disable certificate or hostname verification.
Object storage and alert endpoints require HTTPS outside development.
Staging can use isolated internal PG/Redis links for controlled rehearsals;
its public endpoint is still HTTPS. Pilot refuses those non-TLS database links.

## Release preflight, activation and rollback

Use the exact approved Git checkout and a completed release plan. Each deployed
API/worker/monitor/proxy image must be `repository@sha256:...`. The API image must
include the tested document runtime; the proxy image includes the built Web shell
and TLS configuration. The plan identifies actual deployment, monitoring,
on-call, backup and approval owners, time source and recovery evidence.

```sh
python -m services.deployment.release validate \
  --plan /operator/release-plan.json --env-file /operator/operational.env \
  --state-dir /operator/private-deployment-records
python -m services.deployment.release activate \
  --plan /operator/release-plan.json --env-file /operator/operational.env \
  --state-dir /operator/private-deployment-records
```

Preflight verifies the exact clean checkout, digest-pinned image selections,
service/port isolation, environment consistency, existing secret files, approval
fields and a recent encrypted backup paired with a verified restore of the SAME
bundle hash. Pilot additionally requires approved recovery targets and
non-synthetic approval/provisioning. A configured approval field is not itself
proof of a human signature; the operator must verify the cited approval record.

`activate` pulls the approved images, waits for service readiness and verifies
`/api/ready` through HTTPS with certificate/hostname validation. Redirects are
not accepted as proof of the approved endpoint. It writes a private deployment
result, not a business approval. Activation does not issue database migrations,
restore data, replace a bucket or grant user permissions.

For rollback, use the separately approved previous release checkout, image
set, same supported snapshot format and its corresponding plan, then run the
same command with `rollback`. Confirm application/contract backward compatibility
and the rollback data boundary before doing so. A failed activation is recorded
and requires this explicit decision; there is no automatic volume deletion,
schema downgrade or `down -v` recovery path. Retain the prior data and release
until the approved rollback/retention decision permits removal.

## Backup, monitor and time ownership

The complete encrypted recovery adapter/runbook is in `infra/backup`. The
release gate consumes actual backup/restore reports, scheduler reference and
separate recovery-key custody reference. It does not fabricate a scheduled
backup from an RPO number. If byte-exact generated document derivatives are
required after disaster recovery, also retain the private artifact volume or
exported files/manifests; source snapshots and renderer inventory alone do not
promise PDF byte identity after rebuilding a cache.

The monitor runs independently with read-only observation credentials,
persistent alert spool and a dedicated HTTPS receiver token. Assign actual
monitoring/on-call owners and externally supervise the monitor itself. Business
owner reports and P1-P4 decisions remain separate from these system alerts.

Containers use UTC. The DB clock is the authoritative worker lease time, and
operational startup rejects application/DB skew over 30 seconds. Host time
synchronization must be managed by the platform (record the source in the plan).
Project due-date calculations retain their exact configured project timezone;
changing the container timezone must not rewrite contractual deadlines.

## Verification and actual activation gate

`platform-operational-environments` validates both Compose models without
starting them, runs token/authority/revocation/provisioning negative tests, then
builds and starts an isolated real PostgreSQL/non-demo API/TLS proxy rehearsal.
It uses ephemeral synthetic signing and TLS keys, verifies the CA and hostname,
checks unauthorized-token rejection, server-side roles, absent demo routes,
Web shell serving and refusal to start an unapproved pilot. No real account,
site database, certificate, alert recipient or production service is used.

Actual pilot activation additionally requires the selected site's domain/TLS,
IdP/browser login integration, reviewed project configuration/qualifications,
separate credentials/CA trust, approved model/external-transfer policy (or media
analysis disabled), backup schedule/key custody, on-call receiver, realistic
restore rehearsal and explicit release approval. An unconfigured model provider
fails explicitly; the deployment must never advertise a connected AI provider
merely because a Worker is alive.

## Final integration safety checks

Release validation rejects staged, unstaged and untracked changes, not only a
working-tree diff. Keep operator plans, secret files and run outputs outside the
approved checkout. After activation, both HTTPS readiness and `/api/health`
are checked; the reported environment and exact release commit must match the
approved plan before a deployment is recorded as ready.

Recovery reports must pair the same encrypted bundle, source Compose project
(`doul-supervision-staging` or `doul-supervision-pilot`), and source creation time.
The restore report's `backupCreatedAt` comes from the verified encrypted archive
manifest. The backup report exports that same `createdAt`; it marks the beginning
of the quiescent snapshot, not the time a report was copied. File modification
times never refresh the recovery-point age. Legacy reports without these fields
must be regenerated by an actual backup/restore rehearsal, not edited to pass.

Operational DB credentials and pilot TLS settings are validated before creating
a connection pool. Redis URL options are parsed using the installed client
because query options override keyword defaults; pilot mode rejects disabling
certificate or hostname verification. These shared gates apply to API, Worker
and monitor adapters independently, not only to API startup.

`tests_mvp/test_deployment_safety.py` covers these negative paths with temporary
Git repositories, controlled connection factories and synthetic reports. The
real TLS rehearsal also rejects a healthy server from a different release or
environment. Existing authentication and server-side authority tests remain in
the same CI path. PyJWT fixed-algorithm verification and redis-py URL precedence
were cross-checked against their official documentation through Context7.

### Fresh PostgreSQL rehearsal startup

The disposable deployment rehearsal waits for an authenticated `SELECT 1` over
the same host TCP DSN that the migration command will use. A socket-only
`pg_isready` inside the container is insufficient: the official PostgreSQL image
starts a temporary Unix-socket server for initialization, stops it, then starts
the normal TCP server. CI deliberately delays that initialization phase to keep
this race covered. Readiness has bounded connect/query/overall timeouts; failure
stops the rehearsal without printing credentials. The migration itself is not
retried and programming errors are not treated as successful readiness.
