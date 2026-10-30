#!/usr/bin/env bash
# Fase 2 only — assumes Fase 1 stack is already up on the lab VM.
set -uo pipefail

ROOT="${LAB_ROOT:-$HOME/BioAvanceD-v2}"
export REFERENCE_FULL_ASSET_DIR_HOST="${REFERENCE_FULL_ASSET_DIR_HOST:-$HOME/ref-full}"
export REFERENCE_FULL_CACHE_DIR_HOST="${REFERENCE_FULL_CACHE_DIR_HOST:-$HOME/ref-cache}"
export HOME="${HOME:-/home/denis}"
EV="${LAB_EVIDENCE_DIR:-$HOME/evidencias-dsr-lab-$(date +%Y%m%d)}"

cd "$ROOT"
mkdir -p "$REFERENCE_FULL_CACHE_DIR_HOST" "$EV"

COMPOSE=(docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml -f compose.lab.yml)

# Sources with lab converters ready (skip OMIM dump; skip unconverted ontologies).
FASE2=(
  reference-data-bootstrap
  reference-data-bootstrap-orpha
  reference-data-bootstrap-icd10
  reference-data-bootstrap-loinc
  reference-data-bootstrap-dcb
  reference-data-bootstrap-atc
)

fail=0
: > "$EV/fase2-summary.txt"
for svc in "${FASE2[@]}"; do
  echo "===== $svc START $(date -Is) =====" | tee -a "$EV/fase2-summary.txt"
  if "${COMPOSE[@]}" up -d --no-deps --wait "$svc" 2>&1 | tee "$EV/fase2-${svc}.log"; then
    echo "===== $svc PASS =====" | tee -a "$EV/fase2-summary.txt"
  else
    echo "===== $svc FAIL =====" | tee -a "$EV/fase2-summary.txt"
    fail=1
  fi
done

echo "===== orpha-intake START =====" | tee -a "$EV/fase2-summary.txt"
if "${COMPOSE[@]}" exec -T backend npm run reference:lab:load:orpha-intake -- \
  --in /ref-full/ORPHA/intake-records.jsonl 2>&1 | tee "$EV/fase2-orpha-intake.log"; then
  echo "===== orpha-intake PASS =====" | tee -a "$EV/fase2-summary.txt"
else
  echo "===== orpha-intake FAIL =====" | tee -a "$EV/fase2-summary.txt"
  fail=1
fi

"${COMPOSE[@]}" ps 2>&1 | tee "$EV/compose-ps.log"
echo "FINAL_FAIL=$fail" | tee -a "$EV/fase2-summary.txt"
exit "$fail"
