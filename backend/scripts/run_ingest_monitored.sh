#!/bin/bash
# Monitored ingest pipeline — runs ingest, then verification, logs everything.
# Output is unbuffered so logs are written immediately.
#
# Usage: nohup bash scripts/run_ingest_monitored.sh &

set -e

LOG_DIR="/tmp/plaindr-overnight"
mkdir -p "$LOG_DIR"

INGEST_LOG="$LOG_DIR/ingest.log"
VERIFY_LOG="$LOG_DIR/verify.log"
STATUS_LOG="$LOG_DIR/status.log"

cd "$(dirname "$0")/.."

echo "$(date) — Starting ingest pipeline" | tee "$STATUS_LOG"

# Run ingest with unbuffered Python output
PYTHONUNBUFFERED=1 uv run python -m plaindr ingest \
    --csv /Users/ferhadsuleymanzade/Documents/plaindr/Tools.csv \
    > "$INGEST_LOG" 2>&1

INGEST_EXIT=$?
echo "$(date) — Ingest finished with exit code $INGEST_EXIT" | tee -a "$STATUS_LOG"

# Count results
SCRAPED=$(grep -c 'Scraped.*chars' "$INGEST_LOG" 2>/dev/null || echo 0)
UPLOADS=$(grep -c 'POST.*policies.*200 OK' "$INGEST_LOG" 2>/dev/null || echo 0)
FAILURES=$(grep -c 'Scrape failed' "$INGEST_LOG" 2>/dev/null || echo 0)
echo "$(date) — Scraped: $SCRAPED, Uploads: $UPLOADS, Failures: $FAILURES" | tee -a "$STATUS_LOG"

# Run verification
echo "$(date) — Starting verification" | tee -a "$STATUS_LOG"

PYTHONUNBUFFERED=1 uv run python scripts/verify_policies.py \
    --csv /Users/ferhadsuleymanzade/Documents/plaindr/Tools.csv \
    --spot-check 20 \
    > "$VERIFY_LOG" 2>&1

VERIFY_EXIT=$?
echo "$(date) — Verification finished with exit code $VERIFY_EXIT" | tee -a "$STATUS_LOG"

# Extract summary from verification report
echo "" | tee -a "$STATUS_LOG"
echo "=== VERIFICATION SUMMARY ===" | tee -a "$STATUS_LOG"
grep -A5 'SUMMARY' "$VERIFY_LOG" | tail -5 | tee -a "$STATUS_LOG"

echo "" | tee -a "$STATUS_LOG"
echo "$(date) — ALL DONE. Logs at $LOG_DIR/" | tee -a "$STATUS_LOG"
