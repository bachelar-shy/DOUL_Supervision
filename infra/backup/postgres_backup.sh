#!/bin/sh
set -eu

usage() {
  echo "usage: postgres_backup.sh <database> <output.dump>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
database=$1
output=$2
compose_file=${DOUL_COMPOSE_FILE:-infra/compose/compose.dev.yml}

case "$database" in
  ""|*[!A-Za-z0-9_]*)
    echo "database name must contain only letters, numbers and underscore" >&2
    exit 2
    ;;
esac

hash_file() {
  file=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

mkdir -p "$(dirname "$output")"
tmp="${output}.tmp.$$"
hash_tmp="${output}.sha256.tmp.$$"

cleanup() {
  rm -f "$tmp" "$hash_tmp"
}
trap cleanup EXIT HUP INT TERM

docker compose -f "$compose_file" exec -T \
  -e "BACKUP_DATABASE=$database" postgres \
  sh -ec 'pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$BACKUP_DATABASE"' \
  >"$tmp"

[ -s "$tmp" ] || {
  echo "backup dump is empty" >&2
  exit 1
}

digest=$(hash_file "$tmp")
printf '%s\n' "$digest" >"$hash_tmp"
mv "$tmp" "$output"
mv "$hash_tmp" "${output}.sha256"
trap - EXIT HUP INT TERM

echo "postgres-backup-ok database=$database"
echo "dump=$output"
echo "sha256=$digest"
