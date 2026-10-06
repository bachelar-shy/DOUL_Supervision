# PostgreSQL Backup / New Clean-Target Restore

This directory implements only the PostgreSQL slice of #46, tracked by #51.
It does not complete object/version recovery, secret recovery, or the overall
RPO/RTO and DB/object consistency strategy.

## Backup

From the repository root, with the development PostgreSQL service running:

```sh
infra/backup/postgres_backup.sh \
  doul_supervision \
  .local-backups/postgres/doul_supervision.dump
```

The dump uses `pg_dump -Fc --no-owner --no-privileges` and has a SHA-256 sidecar.
Password prompts are disabled; passwords and full DSNs are not passed on the
command line or printed.

Security properties:

- `umask 077` applies before creating any directory or temporary file.
- New backup directories are 0700; temporary/final dump and sidecar are 0600.
- An existing output directory must be owned by the caller and have no
  group/other permissions. The script refuses it rather than silently chmodding
  user directories. Review and restrict an existing directory explicitly first.
- Directory/output/sidecar symlinks and non-regular destinations are refused.
- A random exclusive temporary directory is used inside the private directory.
- A per-output mkdir lock refuses concurrent writers. After an uncatchable kill,
  inspect the stale lock before an operator removes it; there is no automatic
  lock deletion belonging to another run.
- Failure before publication leaves the previous pair unchanged and removes this
  invocation's temporary files. Each publication rename is atomic, but the pair
  is not one filesystem transaction. An interruption between renames is detected
  by mandatory restore hash verification. Prefer a unique output name per backup.

## Restore without destroying an existing database

```sh
infra/backup/postgres_restore_clean.sh \
  .local-backups/postgres/doul_supervision.dump \
  doul_restore_verify_20261006
```

**The target must not exist.** Unlike the previous implementation, this command
never drops or replaces a database and offers no force/overwrite option.
`createdb` atomically rejects an existing target name. Use a new verification
name on each run. Promotion/replacement is a separate approved operator action.

Before database creation, restore requires:

1. A non-empty regular dump and regular, mandatory 64-lowercase-hex SHA-256 sidecar.
2. A private copy whose hash matches the sidecar; all later reads use those same bytes.
3. A target other than the configured primary or PostgreSQL system databases,
   with an ASCII identifier no longer than 63 bytes.
4. Successful `pg_restore --list` (TOC) and full SQL generation to `/dev/null`.

Only then is a new `template0` target created and restored using
`--single-transaction --exit-on-error --no-owner --no-privileges`.
Archive preflight does not prove that all SQL will execute on the destination.
A SQL restore failure rolls back the restore transaction and leaves the newly
created empty database for explicit inspection/cleanup; existing databases are
never deleted. Do not treat a failed run as restored business state.

A checksum is not authentication or a malware check. Restore only trusted
backups: PostgreSQL dumps can contain executable SQL. Source approval and
Pilot/Production restoration authority remain part of #46.

## Verification

`test_postgres_backup.py` uses synthetic PostgreSQL/Docker doubles with real
shell/file permissions. It covers missing/invalid/mismatched sidecars,
non-archives, body preflight, existing/primary/system targets, SQL failure,
permissions from file creation, symlinks, output replacement and cleanup.

`platform-postgres-backup` CI additionally uses a disposable real PostgreSQL
cluster: deterministic source row, custom-format dump, new-target restore,
checksum/format/truncation rejection before target creation, private file modes,
and preservation of an existing restored row. It removes only the CI volume.

Before Pilot/Production, #46 still requires a DB/object consistency boundary,
object-version recovery, migration/configuration versions, secret recovery,
RPO/RTO, owner/operator approval, and promotion/rollback/fallback procedures.

References: PostgreSQL 16 `pg_restore` documentation describes `--list`, SQL
output without `--dbname`, `--single-transaction`, and the trusted-source warning.
