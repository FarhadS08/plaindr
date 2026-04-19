#!/usr/bin/env bash
# Scheduled rescrape — runs in the Railway cron service.
#
# 1. Re-scrapes every policy URL known to the store
# 2. Detects content changes, archives old versions, computes diffs
# 3. Runs AI analysis on each new diff
# 4. Pings the backend to reload its in-memory cache
#
# Set as the startCommand of a Railway cron service with schedule
# "0 3 * * 0" (Sundays 03:00 UTC). The service is expected to exit
# after completion.

set -euo pipefail

echo "$(date -u +%FT%TZ) scheduled_rescrape: starting"

# Re-scrape everything and persist diffs to Supabase
uv run python -m plaindr rescrape

# Tell the live backend to reload its in-memory store so fresh diffs
# are visible immediately (otherwise they'd show up only on next boot).
if [ -n "${BACKEND_URL:-}" ] && [ -n "${ADMIN_TOKEN:-}" ]; then
  echo "$(date -u +%FT%TZ) scheduled_rescrape: pinging backend to reload"
  curl -fsS -X POST \
    -H "X-Admin-Token: ${ADMIN_TOKEN}" \
    "${BACKEND_URL%/}/api/store/reload" \
    || echo "warning: backend reload failed (non-fatal)"
fi

echo "$(date -u +%FT%TZ) scheduled_rescrape: done"
