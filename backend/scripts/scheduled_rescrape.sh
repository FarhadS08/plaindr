#!/usr/bin/env bash
# Scheduled rescrape — runs in the Railway cron service.
#
# 1. Re-scrapes every policy URL known to the store
# 2. Detects content changes, archives old versions, computes diffs
# 3. Runs AI analysis on each new diff
# 4. Pings the backend to reload its in-memory cache
#
# Invoked by the cron service defined in backend/railway.cron.toml.
# The service runs once on its schedule and exits.

set -euo pipefail

log() { echo "$(date -u +%FT%TZ) scheduled_rescrape: $*"; }

log "starting (pid=$$)"
start_ts=$(date +%s)

# Re-scrape everything and persist diffs. Any non-zero exit bubbles up
# (set -e) so Railway's run status reflects the real outcome.
uv run python -m plaindr rescrape

# Tell the live backend to reload its in-memory store so fresh diffs
# are visible immediately (otherwise they'd show up only on next boot).
# Reload failure is non-fatal — the API will pick up the new data on
# its next natural restart.
if [ -n "${BACKEND_URL:-}" ] && [ -n "${ADMIN_TOKEN:-}" ]; then
  log "pinging backend reload at ${BACKEND_URL%/}/api/store/reload"
  if curl -fsS --max-time 60 -X POST \
      -H "X-Admin-Token: ${ADMIN_TOKEN}" \
      "${BACKEND_URL%/}/api/store/reload"; then
    log "backend reload ok"
  else
    log "warning: backend reload failed (non-fatal)"
  fi
else
  log "skipping backend reload — BACKEND_URL / ADMIN_TOKEN not set"
fi

elapsed=$(( $(date +%s) - start_ts ))
log "done in ${elapsed}s"
