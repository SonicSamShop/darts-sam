#!/bin/sh
# A dated copy of everything the hosted site keeps (see docs/hosting.md).
#
#   tools/backup.sh [data folder] [where to put copies]
#
# Each database is copied with sqlite3's own .backup, because a plain copy of a
# database that is being written to can come out torn. Keeps the newest 14.
set -eu
DATA=${1:-/var/lib/dartssam}
OUT=${2:-/var/backups/dartssam}
[ -f "$DATA/host.db" ] || { echo "no host.db in $DATA" >&2; exit 1; }

stamp=$(date +%Y-%m-%d_%H%M%S)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$OUT" "$work/dartssam"

sqlite3 "$DATA/host.db" ".backup '$work/dartssam/host.db'"
for db in "$DATA"/accounts/*/darts.db; do
  [ -f "$db" ] || continue
  id=$(basename "$(dirname "$db")")
  mkdir -p "$work/dartssam/accounts/$id"
  sqlite3 "$db" ".backup '$work/dartssam/accounts/$id/darts.db'"
done

file="$OUT/dartssam-$stamp.tar.gz"
tar -czf "$file" -C "$work" dartssam
ls -1t "$OUT"/dartssam-*.tar.gz | tail -n +15 | xargs -r rm -f

# SAM: send "$file" somewhere that is not this server, for example
#   rclone copy "$file" remote:dartssam-backups
# A backup that only exists on the server is lost with the server.

echo "$file"
