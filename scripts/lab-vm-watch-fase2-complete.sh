#!/usr/bin/env bash
set -uo pipefail
LOG="$HOME/fase2-complete-run.log"
EV="$HOME/evidencias-dsr-lab-$(date +%Y%m%d)/fase2-complete-summary.txt"
MAX="${1:-360}"
for i in $(seq 1 "$MAX"); do
  running=$(docker ps --filter name=reference-data-bootstrap --format '{{.Names}}' | tr '\n' ' ')
  echo "tick=$i $(date -Is) running=[$running]"
  if [[ -f "$EV" ]]; then
    tail -3 "$EV" | sed 's/^/  /'
  fi
  if ! pgrep -f lab-vm-fase2-complete.sh >/dev/null 2>&1; then
    echo "SCRIPT_EXITED"
    tail -80 "$LOG"
    echo "WATCH_DONE"
    exit 0
  fi
  if grep -q 'FINAL_FAIL=' "$EV" 2>/dev/null; then
    echo "SUMMARY_FINAL"
    cat "$EV"
    echo "WATCH_DONE"
    exit 0
  fi
  sleep 60
done
echo "WATCH_TIMEOUT"
tail -40 "$LOG"
echo "WATCH_DONE"
exit 1
