#!/bin/sh
set -eu

usage() {
  echo "usage: postgres_restore_clean.sh <input.dump> <target_database>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
dump=$1
target=$2
compose_file=${DOUL_COMPOSE_FILE:-infra/compose/compose.dev.yml}

case "$target" in
  ""|*[!A-Za-z0-9_]*)
    echo "target database name must contain only letters, numbers and underscore" >&2
    exit 2
    ;;
  postgres|template0|template1)
    echo "refusing restore into PostgreSQL system database" >&2
    exit 2
    ;;
esac

[ -f "$dump" ] || {
  echo "backup dump not found" >&2
  exit 2
}

hash_file() {
  file=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

sidecar="${dump}.sha256"
if [ -f "$sidecar" ]; then
  expected=$(tr -d '[:space:]' <"$sidecar")
  actual=$(hash_file "$dump")
  [ "$expected" = "$actual" ] || {
    echo "backup SHA-256 verification failed" >&2
    exit 1
  }
fi

primary=$(docker compose -f "$compose_file" exec -T postgres \
  sh -ec 'printf "%s" "$POSTGRES_DB"')

[ "$target" != "$primary" ] || {
  echo "refusing clean restore into configured primary database" >&2
  exit 2
}

docker compose -f "$compose_file" exec -T \
  -e "RESTORE_DATABASE=$target" postgres \
  sh -ec '
    dropdb --if-exists -U "$POSTGRES_USER" "$RESTORE_DATABASE"
    createdb -T template0 -U "$POSTGRES_USER" "$RESTORE_DATABASE"
    pg_restore --exit-on-error --no-owner --no-privileges \
      -U "$POSTGRES_USER" -d "$RESTORE_DATABASE"
  ' <"$dump"

echo "postgres-clean-restore-ok target=$target"
