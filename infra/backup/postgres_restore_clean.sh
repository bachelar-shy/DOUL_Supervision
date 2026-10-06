#!/bin/sh
set -eu
umask 077

fail() { echo "$1" >&2; exit 2; }
[ "$#" -eq 2 ] || fail 'usage: postgres_restore_clean.sh <input.dump> <new_target_database>'
dump=$1
target=$2
compose_file=${DOUL_COMPOSE_FILE:-infra/compose/compose.dev.yml}
case "$target" in
  ""|*[!A-Za-z0-9_]*) fail 'target database name must contain only letters, numbers and underscore' ;;
  postgres|template0|template1) fail 'refusing restore into PostgreSQL system database' ;;
esac
[ "${#target}" -le 63 ] || fail 'target database name must not exceed 63 bytes'
case "$dump" in /*) ;; *) dump="$PWD/$dump" ;; esac
[ -f "$dump" ] && [ ! -L "$dump" ] && [ -s "$dump" ] || fail 'backup dump must be a non-empty regular file, not a symlink'
sidecar="${dump}.sha256"
[ -f "$sidecar" ] && [ ! -L "$sidecar" ] || fail 'backup SHA-256 sidecar is required and must not be a symlink'
expected=$(cat "$sidecar")
[ "${#expected}" -eq 64 ] || fail 'invalid SHA-256 sidecar format'
case "$expected" in *[!0-9a-f]*) fail 'invalid SHA-256 sidecar format' ;; esac

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sum=$(sha256sum "$1") || return 1
  else
    sum=$(shasum -a 256 "$1") || return 1
  fi
  printf '%s\n' "${sum%% *}"
}

# Verify and restore the same private byte snapshot, not a mutable input path.
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/doul-restore.XXXXXX")
cleanup() { rm -f "$tmpdir/input.dump"; rmdir "$tmpdir"; }
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
cp "$dump" "$tmpdir/input.dump"
chmod 600 "$tmpdir/input.dump"
actual=$(hash_file "$tmpdir/input.dump")
[ "$expected" = "$actual" ] || fail 'backup SHA-256 verification failed'

primary=$(docker compose -f "$compose_file" exec -T postgres \
  sh -ec 'printf "%s" "${POSTGRES_DB:?POSTGRES_DB is required}"')
[ -n "$primary" ] || fail 'configured primary database is unknown'
[ "$target" != "$primary" ] || fail 'refusing clean restore into configured primary database'

# Hash equality is not archive validity. Read TOC and all archive data before
# creating anything; --file without --dbname emits SQL and executes no SQL.
docker compose -f "$compose_file" exec -T postgres \
  sh -ec 'pg_restore --list >/dev/null' <"$tmpdir/input.dump"
docker compose -f "$compose_file" exec -T postgres \
  sh -ec 'pg_restore --no-owner --no-privileges --file=/dev/null' <"$tmpdir/input.dump"

# createdb atomically refuses an existing name. There is deliberately no dropdb
# or replacement flag. Restore failure leaves only this newly-created empty DB;
# its cleanup is an explicit operator action, never an automatic deletion.
docker compose -f "$compose_file" exec -T \
  -e "RESTORE_DATABASE=$target" postgres \
  sh -ec '
    createdb -w -T template0 -U "$POSTGRES_USER" "$RESTORE_DATABASE"
    pg_restore -w --single-transaction --exit-on-error --no-owner --no-privileges \
      -U "$POSTGRES_USER" -d "$RESTORE_DATABASE"
  ' <"$tmpdir/input.dump"

echo "postgres-clean-restore-ok target=$target"
