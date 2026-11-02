#!/usr/bin/env bash
set -u
source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
EV="$HOME/evidencias-dsr-lab-20261029"
cd "$HOME/BioAvanceD-v2" || exit 1
mkdir -p "$EV"
SUMMARY="$EV/trilha-a-summary.txt"
: > "$SUMMARY"

run_step() {
  local name="$1"
  shift
  echo "===== $name START $(date -Is) =====" | tee -a "$SUMMARY"
  set -o pipefail
  if "$@" 2>&1 | tee "$EV/$name.log"; then
    echo "===== $name PASS $(date -Is) =====" | tee -a "$SUMMARY"
    return 0
  else
    local ec=$?
    echo "===== $name FAIL exit=$ec $(date -Is) =====" | tee -a "$SUMMARY"
    return "$ec"
  fi
}

fail=0
run_step 01-lint npm --prefix api/backend run lint || fail=1
run_step 02-architecture npm --prefix api/backend run test:architecture || fail=1
run_step 03-current-state-ci npm --prefix api/backend run current-state:ci || fail=1
run_step 04-test-ci npm --prefix api/backend run test:ci || fail=1
run_step 05-frontend-unit npm --prefix frontend run test:unit || fail=1
echo "FINAL_FAIL=$fail" | tee -a "$SUMMARY"
exit "$fail"
