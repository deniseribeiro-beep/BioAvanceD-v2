#!/usr/bin/env bash
# Nightly homolog watchdog on the GCP lab VM.
# Max 3 attempts of e2e-gate-monitored; reset compose (+ mongo volume on infra abort).
#
# Usage: bash scripts/gcp-watchdog-homolog.sh
# Log: ~/homolog-watchdog.log (also redirected by nohup caller)
set -u
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
OUT_DIR="${HOMOLOG_OUT:-e2e-gate-out-gcp-wave0}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
LOG="${HOMOLOG_WATCHDOG_LOG:-$HOME/homolog-watchdog.log}"
cd "$ROOT" || { echo "STOP_REASON=missing_root ROOT=$ROOT"; exit 2; }

DC="docker compose --env-file .env.test.example -f compose.test.yml"
GATE_SCRIPT="$ROOT/scripts/e2e-gate-monitored.sh"
if [ ! -x "$GATE_SCRIPT" ] && [ -f "$GATE_SCRIPT" ]; then
  chmod +x "$GATE_SCRIPT" || true
fi
if [ ! -f "$GATE_SCRIPT" ]; then
  echo "STOP_REASON=missing_gate_script PATH=$GATE_SCRIPT"
  exit 2
fi

log() { echo "$*" | tee -a "$LOG"; }

log "WATCHDOG_START=$(date -u +%Y-%m-%dT%H:%M:%SZ) ROOT=$ROOT MAX_ATTEMPTS=$MAX_ATTEMPTS"
log "GIT=$(git -C "$ROOT" log -1 --oneline 2>/dev/null || echo unknown)"

attempt=0
last_exit=1
while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  log "ATTEMPT=$attempt START=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Clean previous runner / stack leftovers before each attempt
  docker rm -f e2e-gate >/dev/null 2>&1 || true
  $DC down --remove-orphans >/dev/null 2>&1 || true

  rm -rf "$ROOT/$OUT_DIR"
  mkdir -p "$ROOT/$OUT_DIR"

  set +e
  bash "$GATE_SCRIPT" "$OUT_DIR"
  last_exit=$?
  set -e

  log "ATTEMPT=$attempt EXIT=$last_exit END=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -f "$ROOT/$OUT_DIR/infra-abort.txt" ]; then
    log "INFRA_ABORT=1"
    cat "$ROOT/$OUT_DIR/infra-abort.txt" | tee -a "$LOG" >/dev/null || true
  fi
  if [ -f "$ROOT/$OUT_DIR/e2e.txt" ]; then
    log "E2E_TAIL_BEGIN"
    tail -n 40 "$ROOT/$OUT_DIR/e2e.txt" | tee -a "$LOG" >/dev/null || true
    log "E2E_TAIL_END"
  fi

  if [ "$last_exit" -eq 0 ]; then
    log "E2E_GATE_EXIT=0"
    log "STOP_REASON=success"
    $DC down --remove-orphans >/dev/null 2>&1 || true
    exit 0
  fi

  # Infra abort or mongo death → drop mongo volume for next attempt
  if [ "$last_exit" -eq 20 ] || [ -f "$ROOT/$OUT_DIR/infra-abort.txt" ]; then
    log "RESET_MONGO_VOLUME=1"
    $DC down -v --remove-orphans >/dev/null 2>&1 || true
    docker volume rm bioavanced-test_mongodb-test-data 2>/dev/null || true
    docker volume ls -q | grep -E 'mongodb-test' | while read -r v; do
      docker volume rm "$v" 2>/dev/null || true
    done
  else
    $DC down --remove-orphans >/dev/null 2>&1 || true
  fi

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    log "SLEEP_BEFORE_RETRY=15"
    sleep 15
  fi
done

log "E2E_GATE_EXIT=$last_exit"
log "STOP_REASON=exhausted"
log "WATCHDOG_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit "$last_exit"
