#!/bin/sh
# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only
#
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

echo "$file"

# A backup that only exists on the server is lost with the server. If there is
# a program at /etc/dartssam/after-backup (or wherever DARTSSAM_AFTER_BACKUP
# says), it is run with the new file's name, to send it somewhere else. For
# example, a script of two lines:
#   #!/bin/sh
#   rclone copy "$1" remote:dartssam-backups
AFTER=${DARTSSAM_AFTER_BACKUP:-/etc/dartssam/after-backup}
if [ -x "$AFTER" ]; then "$AFTER" "$file"; fi
