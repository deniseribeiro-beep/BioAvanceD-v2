#!/usr/bin/env bash
# Bring up Fase 1 (Foundation + essential refs) then Fase 2 full-lab imports
# on a GCP/lab VM that already has ~/BioAvanceD-v2 and ~/ref-full.
set -euo pipefail

ROOT="${LAB_ROOT:-$HOME/BioAvanceD-v2}"
REF_FULL="${REFERENCE_FULL_ASSET_DIR_HOST:-$HOME/ref-full}"
REF_CACHE="${REFERENCE_FULL_CACHE_DIR_HOST:-$HOME/ref-cache}"
EV="${LAB_EVIDENCE_DIR:-$HOME/evidencias-dsr-lab-$(date +%Y%m%d)}"
COMPOSE=(docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml -f compose.lab.yml)

cd "$ROOT"
mkdir -p "$REF_CACHE" "$EV"
export REFERENCE_FULL_ASSET_DIR_HOST="$REF_FULL"
export REFERENCE_FULL_CACHE_DIR_HOST="$REF_CACHE"
export HOME="${HOME:-/home/denis}"

if [[ ! -f .env.docker ]]; then
  echo "Missing .env.docker — run: bash generate-env-docker-secrets.sh" >&2
  exit 1
fi
if [[ ! -d "$REF_FULL" ]]; then
  echo "Missing ref-full at $REF_FULL" >&2
  exit 1
fi

log() { echo "[lab-vm] $*"; }

log "Fase 1: infra + foundation + essential"
"${COMPOSE[@]}" up -d --wait \
  mongodb neo4j redis influxdb tsa witness \
  backend worker neo4j-projection-worker frontend \
  2>&1 | tee "$EV/fase1-infra.log"

"${COMPOSE[@]}" up -d --wait foundation-bootstrap \
  2>&1 | tee "$EV/fase1-foundation.log"

"${COMPOSE[@]}" up -d --wait essential-reference-bootstrap \
  2>&1 | tee "$EV/fase1-essential.log"

log "Fase 1 done. Seeding first admin (idempotent)…"
"${COMPOSE[@]}" exec -T backend node src/scripts/createFirstAdmin.js \
  2>&1 | tee "$EV/fase1-admin.log" || true

log "Fase 2: full-lab reference chain (skip OMIM dump)"
# Order matches compose.dev.yml depends_on chain, minus omim.
FASE2=(
  reference-data-bootstrap
  reference-data-bootstrap-mondo
  reference-data-bootstrap-orpha
  reference-data-bootstrap-icd11
  reference-data-bootstrap-icd10
  reference-data-bootstrap-hgnc
  reference-data-bootstrap-loinc
  reference-data-bootstrap-ucum
  reference-data-bootstrap-dcb
  reference-data-bootstrap-atc
  reference-data-bootstrap-duo
  reference-data-bootstrap-uberon
  reference-data-bootstrap-ncbitax
  reference-data-bootstrap-cl
  reference-data-bootstrap-edam
)

fail=0
for svc in "${FASE2[@]}"; do
  log "starting $svc"
  if ! "${COMPOSE[@]}" up -d --wait "$svc" 2>&1 | tee "$EV/fase2-${svc}.log"; then
    log "FAIL $svc (see $EV/fase2-${svc}.log)"
    fail=1
    # Continue so later independent converters still get a chance when deps allow.
    # Services that depend_on a failed predecessor will also fail — that is expected.
  else
    log "PASS $svc"
  fi
done

log "Orphadata intake crosswalk (ORPHA↔OMIM↔CID) into Mongo"
"${COMPOSE[@]}" exec -T \
  -e REFERENCE_IMPORT_PROFILE=full-lab \
  -e REFERENCE_FULL_ASSET_DIR=/ref-full \
  backend npm run reference:lab:load:orpha-intake -- \
  --in /ref-full/ORPHA/intake-records.jsonl \
  2>&1 | tee "$EV/fase2-orpha-intake.log" || fail=1

log "Status:"
"${COMPOSE[@]}" ps 2>&1 | tee "$EV/compose-ps.log"
echo "FINAL_FAIL=$fail" | tee -a "$EV/summary.txt"
exit "$fail"
