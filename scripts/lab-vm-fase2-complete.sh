#!/usr/bin/env bash
# Fase 2 completa — remaining full-lab sources (OMIM dump skipped).
# Assumes Fase 1 + prior ORPHA/HPO/ATC/LOINC. Reimports ICD10/DCB after DUPLICATE_CODE fix.
set -uo pipefail

ROOT="${LAB_ROOT:-$HOME/BioAvanceD-v2}"
export REFERENCE_FULL_ASSET_DIR_HOST="${REFERENCE_FULL_ASSET_DIR_HOST:-$HOME/ref-full}"
export REFERENCE_FULL_CACHE_DIR_HOST="${REFERENCE_FULL_CACHE_DIR_HOST:-$HOME/ref-cache}"
export HOME="${HOME:-/home/denis}"
EV="${LAB_EVIDENCE_DIR:-$HOME/evidencias-dsr-lab-$(date +%Y%m%d)}"

cd "$ROOT"
mkdir -p "$REFERENCE_FULL_CACHE_DIR_HOST" "$EV"

COMPOSE=(docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml -f compose.lab.yml)

for code in ICD10 DCB ICD11 MONDO HGNC DUO UBERON CL EDAM NCBITAX UCUM; do
  rm -f "$REFERENCE_FULL_CACHE_DIR_HOST/$code/data.jsonl" || true
done
for code in ICD10 DCB; do
  if [[ -f "$REFERENCE_FULL_ASSET_DIR_HOST/$code/data.jsonl" ]]; then
    mv -f "$REFERENCE_FULL_ASSET_DIR_HOST/$code/data.jsonl" \
      "$REFERENCE_FULL_ASSET_DIR_HOST/$code/data.jsonl.bak-$(date +%Y%m%d%H%M%S)" || true
  fi
done

FASE2=(
  reference-data-bootstrap-icd10
  reference-data-bootstrap-dcb
  reference-data-bootstrap-mondo
  reference-data-bootstrap-hgnc
  reference-data-bootstrap-icd11
  reference-data-bootstrap-ucum
  reference-data-bootstrap-duo
  reference-data-bootstrap-edam
  reference-data-bootstrap-cl
  reference-data-bootstrap-uberon
  reference-data-bootstrap-ncbitax
)

fail=0
: > "$EV/fase2-complete-summary.txt"
for svc in "${FASE2[@]}"; do
  echo "===== $svc START $(date -Is) =====" | tee -a "$EV/fase2-complete-summary.txt"
  if ! "${COMPOSE[@]}" up -d --no-deps --force-recreate "$svc" 2>&1 | tee "$EV/fase2-complete-${svc}.log"; then
    echo "===== $svc FAIL(start) =====" | tee -a "$EV/fase2-complete-summary.txt"
    fail=1
    continue
  fi
  cid="$("${COMPOSE[@]}" ps -aq "$svc" | head -n1)"
  if [[ -z "$cid" ]]; then
    echo "===== $svc FAIL(no-container) =====" | tee -a "$EV/fase2-complete-summary.txt"
    fail=1
    continue
  fi
  echo "waiting on $cid ..." | tee -a "$EV/fase2-complete-summary.txt"
  exit_code="$(docker wait "$cid")"
  "${COMPOSE[@]}" logs --tail=60 "$svc" 2>&1 | tee -a "$EV/fase2-complete-${svc}.log"
  if [[ "$exit_code" == "0" ]]; then
    echo "===== $svc PASS exit=0 =====" | tee -a "$EV/fase2-complete-summary.txt"
  else
    echo "===== $svc FAIL exit=$exit_code =====" | tee -a "$EV/fase2-complete-summary.txt"
    fail=1
  fi
done

"${COMPOSE[@]}" ps -a 2>&1 | tee "$EV/compose-ps-fase2-complete.log"
echo "FINAL_FAIL=$fail" | tee -a "$EV/fase2-complete-summary.txt"
exit "$fail"
