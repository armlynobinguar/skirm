#!/usr/bin/env bash
# Checks that the Cloud SQL instance of an environment is protected: automated backups on,
# point-in-time recovery on, at least 7 backups retained, and a successful backup in the last 36 h.
# Read only (gcloud describe/list). Exits non-zero, saying why, when any check fails.
#
#   ENV=staging PROJECT=my-project scripts/check-backups.sh
set -euo pipefail

: "${ENV:?set ENV (e.g. staging)}"
: "${PROJECT:?set PROJECT (the GCP project id)}"
INSTANCE="skirm-pg-$ENV"
fail=0
bad() { echo "FAIL: $*"; fail=1; }

cfg=$(gcloud sql instances describe "$INSTANCE" --project="$PROJECT" --format=json)
get() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d; [v:=v.get(k, {}) for k in sys.argv[1].split('.')]; print(v if v != {} else '')" "$1" <<<"$cfg"; }

[ "$(get settings.backupConfiguration.enabled)" = "True" ] || bad "automated backups are off ($INSTANCE)"
[ "$(get settings.backupConfiguration.pointInTimeRecoveryEnabled)" = "True" ] || bad "point-in-time recovery is off ($INSTANCE)"
kept=$(get settings.backupConfiguration.backupRetentionSettings.retainedBackups)
[ -n "$kept" ] && [ "$kept" -ge 7 ] || bad "fewer than 7 backups retained (${kept:-unset})"

last=$(gcloud sql backups list --instance="$INSTANCE" --project="$PROJECT" --filter="status=SUCCESSFUL" \
  --sort-by=~endTime --limit=1 --format="value(endTime)")
if [ -z "$last" ]; then
  bad "no successful backup yet"
else
  age_h=$(( ( $(date -u +%s) - $(date -u -d "$last" +%s) ) / 3600 ))
  [ "$age_h" -le 36 ] || bad "last successful backup is ${age_h} h old ($last)"
  echo "last successful backup: $last (${age_h} h ago)"
fi

[ "$fail" -eq 0 ] && echo "OK: $INSTANCE backups, point-in-time recovery and retention look right"
exit "$fail"
