#!/bin/sh
set -eu
umask 077

fail() { echo "$1" >&2; exit 2; }
[ "$#" -eq 2 ] || fail 'usage: postgres_backup.sh <database> <output.dump>'
database=$1
output=$2
compose_file=${DOUL_COMPOSE_FILE:-infra/compose/compose.dev.yml}
case "$database" in
  ""|*[!A-Za-z0-9_]*) fail 'database name must contain only letters, numbers and underscore' ;;
esac
[ "${#database}" -le 63 ] || fail 'database name must not exceed 63 bytes'
case "$output" in /*) ;; *) output="$PWD/$output" ;; esac

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sum=$(sha256sum "$1") || return 1
  else
    sum=$(shasum -a 256 "$1") || return 1
  fi
  printf '%s\n' "${sum%% *}"
}

# Do not silently change permissions of existing user directories.
directory=$(dirname "$output")
[ ! -L "$directory" ] || fail 'backup directory must not be a symlink'
mkdir -p "$directory"
mode=$(stat -c '%a' "$directory" 2>/dev/null) || mode=$(stat -f '%Lp' "$directory")
owner=$(stat -c '%u' "$directory" 2>/dev/null) || owner=$(stat -f '%u' "$directory")
case "$mode" in *00) ;; *) fail 'backup directory must be owner-only (0700)' ;; esac
[ "$owner" = "$(id -u)" ] || fail 'backup directory must be owned by the current user'
for destination in "$output" "${output}.sha256"; do
  [ ! -L "$destination" ] || fail 'backup destination must not be a symlink'
  [ ! -e "$destination" ] || [ -f "$destination" ] || fail 'backup destination must be a regular file'
done

# Exclusive random directory prevents predictable temporary-file/symlink reuse.
lockdir="${output}.lock"
mkdir "$lockdir" 2>/dev/null || fail 'another backup or stale lock exists for this output'
tmpdir=
cleanup() {
  if [ -n "$tmpdir" ]; then
    rm -f "$tmpdir/dump" "$tmpdir/digest"
    rmdir "$tmpdir"
  fi
  rmdir "$lockdir"
}
trap cleanup 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tmpdir=$(mktemp -d "$directory/.doul-backup.XXXXXX")

docker compose -f "$compose_file" exec -T \
  -e "BACKUP_DATABASE=$database" postgres \
  sh -ec 'pg_dump -w -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$BACKUP_DATABASE"' \
  >"$tmpdir/dump"

[ -s "$tmpdir/dump" ] || fail 'backup dump is empty'
digest=$(hash_file "$tmpdir/dump")
printf '%s\n' "$digest" >"$tmpdir/digest"
# Both files are complete and 0600 before publishing. A pair interrupted between
# renames fails checksum verification; restore never accepts a missing sidecar.
for destination in "$output" "${output}.sha256"; do
  [ ! -L "$destination" ] || fail 'backup destination changed to a symlink'
  [ ! -e "$destination" ] || [ -f "$destination" ] || fail 'backup destination changed to a non-regular file'
done
mv -f "$tmpdir/dump" "$output"
mv -f "$tmpdir/digest" "${output}.sha256"
echo "postgres-backup-ok database=$database"
echo "dump=$output"
echo "sha256=$digest"
