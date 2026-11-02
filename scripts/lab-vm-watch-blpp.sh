#!/usr/bin/env bash
# Watchdog BLPP: poll progress + print ETA; optionally --resume-stale
set -euo pipefail
OUT_DIR="${1:-$HOME/blpp-runs/current}"
STALE_MIN="${STALE_MIN:-15}"
INTERVAL_SEC="${INTERVAL_SEC:-60}"
RESUME_STALE="${RESUME_STALE:-0}"
SEED_CMD="${SEED_CMD:-}"

echo "[watch-blpp] out=$OUT_DIR interval=${INTERVAL_SEC}s stale_min=$STALE_MIN"
LAST_DONE=-1
LAST_CHANGE_TS=$(date +%s)

while true; do
  PROGRESS=$(ls -t "$OUT_DIR"/progress-*.json 2>/dev/null | head -1 || true)
  if [[ -z "${PROGRESS}" ]]; then
    echo "[watch-blpp] $(date -Is) waiting for progress file..."
    sleep "$INTERVAL_SEC"
    continue
  fi
  SUMMARY=$(node -e '
    const p=require(process.argv[1]);
    const by={pending:0,running:0,done:0,failed:0};
    for (const c of p.chunks) by[c.status]=(by[c.status]||0)+1;
    const doneP=p.chunks.filter(c=>c.status==="done").reduce((a,c)=>a+(c.counts&&c.counts.participants||0),0);
    const pct=p.nTarget?Math.round(doneP/p.nTarget*1000)/10:0;
    const running=p.chunks.find(c=>c.status==="running");
    console.log(JSON.stringify({runId:p.runId,by,doneP,pct,lastGood:p.lastGoodChunk,nTarget:p.nTarget,running:running?running.i:null,updatedAt:p.updatedAt}));
  ' "$PROGRESS")
  DONE=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.by.done)' "$SUMMARY")
  TOTAL=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.by.pending+s.by.running+s.by.failed+s.by.done)' "$SUMMARY")
  PCT=$(node -e 'const s=JSON.parse(process.argv[1]); console.log(s.pct)' "$SUMMARY")
  NOW=$(date +%s)
  if [[ "$DONE" != "$LAST_DONE" ]]; then
    LAST_DONE=$DONE
    LAST_CHANGE_TS=$NOW
  fi
  STALE=$(( (NOW - LAST_CHANGE_TS) / 60 ))
  echo "[watch-blpp] $(date -Is) $SUMMARY stale_min=$STALE"
  if [[ "$DONE" -ge "$TOTAL" && "$TOTAL" -gt 0 ]]; then
    echo "[watch-blpp] COMPLETE"
    exit 0
  fi
  if [[ "$STALE" -ge "$STALE_MIN" && "$RESUME_STALE" == "1" && -n "$SEED_CMD" ]]; then
    echo "[watch-blpp] STALE — invoking resume: $SEED_CMD"
    bash -lc "$SEED_CMD" || true
    LAST_CHANGE_TS=$(date +%s)
  fi
  sleep "$INTERVAL_SEC"
done
