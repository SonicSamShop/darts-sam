#!/bin/sh
# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only
#
# A dated copy of everything the hosted site keeps (see docs/hosting.md).
#
#   tools/backup.sh [data folder] [where to put copies]
#   tools/backup.sh --check FILE      # only check a backup made before
#
# Each database is copied with sqlite3's own .backup, because a plain copy of a
# database that is being written to can come out torn. The board pictures kept
# beside each account's games (darts.photos/) go in too. The new file is then
# unpacked again and every database in it checked, so a backup that couldn't
# be restored is found the night it is made. Keeps the newest 14.
#
# Anything wrong and it stops with a message and a non-zero exit, before
# telling anyone it went well.
set -eu

# Unpack a backup somewhere temporary and check every database in it.
check() {
  dir=$(mktemp -d)
  tar -xzf "$1" -C "$dir"
  [ -f "$dir/dartssam/host.db" ] || { echo "$1: no host.db in it" >&2; rm -rf "$dir"; exit 1; }
  n=0
  for db in "$dir"/dartssam/host.db "$dir"/dartssam/accounts/*/darts.db; do
    [ -f "$db" ] || continue
    said=$(sqlite3 "$db" "PRAGMA integrity_check" 2>&1) || said="can't open: $said"
    if [ "$said" != "ok" ]; then
      echo "$1: ${db#"$dir"/} is damaged: $said" >&2
      rm -rf "$dir"
      exit 1
    fi
    n=$((n + 1))
  done
  pics=$(find "$dir/dartssam/accounts" -name '*.jpg' 2>/dev/null | wc -l | tr -d ' ')
  rm -rf "$dir"
  echo "$1: $n databases checked, $pics pictures"
}

if [ "${1:-}" = "--check" ]; then
  [ -f "${2:-}" ] || { echo "usage: tools/backup.sh --check FILE" >&2; exit 2; }
  check "$2"
  exit 0
fi

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
  if [ -d "$DATA/accounts/$id/darts.photos" ]; then
    cp -R "$DATA/accounts/$id/darts.photos" "$work/dartssam/accounts/$id/"
  fi
done
find "$work/dartssam" -name '*.part' -type f -delete  # a picture half-written as it was copied

file="$OUT/dartssam-$stamp.tar.gz"
tar -czf "$file.part" -C "$work" dartssam
mv "$file.part" "$file"  # never a half-made file under the real name
check "$file"
ls -1t "$OUT"/dartssam-*.tar.gz | tail -n +15 | xargs -r rm -f

# A backup that only exists on the server is lost with the server. If there is
# a program at /etc/dartssam/after-backup (or wherever DARTSSAM_AFTER_BACKUP
# says), it is run with the new file's name, to send it somewhere else. For
# example, a script of two lines:
#   #!/bin/sh
#   rclone copy "$1" remote:dartssam-backups
AFTER=${DARTSSAM_AFTER_BACKUP:-/etc/dartssam/after-backup}
if [ -x "$AFTER" ]; then "$AFTER" "$file"; fi

# All went well: say so to a heartbeat checker (such as healthchecks.io), whose
# address is in /etc/dartssam/backup-ping (or DARTSSAM_BACKUP_PING). It emails
# when a night passes without hearing, so a backup that failed, or never ran,
# is noticed.
PING=${DARTSSAM_BACKUP_PING:-}
if [ -z "$PING" ] && [ -r /etc/dartssam/backup-ping ]; then PING=$(tr -d ' \n' < /etc/dartssam/backup-ping); fi
if [ -n "$PING" ]; then
  curl -fsS -m 10 --retry 3 "$PING" >/dev/null || echo "backup made, but the heartbeat couldn't be sent" >&2
fi
