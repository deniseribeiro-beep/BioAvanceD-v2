#!/usr/bin/env bash
# Bring up compose.test UI stack and run CT-RNF001-LOAD-01 on the GCP lab VM.
set -euo pipefail
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
cd "$ROOT"
DC=(docker compose --env-file .env.test.example -f compose.test.yml)
OUT_DIR="$ROOT/docs/evidencias/homologacao-runtime"
mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/rnf001-ui-p95-results.json"

echo "== stack up =="
"${DC[@]}" up -d --wait mongodb-test neo4j-test redis-test mqtt-test influxdb-test smtp-test \
  tsa-test witness-test backend-app-test trusted-hop-test worker-test \
  frontend-app-test neo4j-projection-worker-test
"${DC[@]}" up -d --wait --no-deps admin-bootstrap-test || true

echo "== wait host ports =="
for i in $(seq 1 36); do
  if curl -fsS "http://127.0.0.1:5173/login" >/dev/null \
    && curl -fsS -X POST "http://127.0.0.1:3000/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"username":"admin","password":"Admin@123-e2e-stack"}' >/dev/null; then
    echo "ports ready after ${i} attempts"
    break
  fi
  sleep 5
  if [[ "$i" -eq 36 ]]; then
    echo "ports not ready after wait" >&2
    exit 1
  fi
done

echo "== rnf001 via playwright image =="
# Host ports: frontend 5173, backend 3000 (published on 127.0.0.1)
set +e
docker run --rm --network host \
  -e BASE_URL=http://127.0.0.1:5173 \
  -e API_URL=http://127.0.0.1:3000 \
  -e PLAYWRIGHT_API_BASE_URL=http://127.0.0.1:3000 \
  -e TEST_USER=admin \
  -e TEST_PASS='Admin@123-e2e-stack' \
  -e N="${N:-30}" \
  -e OUT=/out/rnf001-ui-p95-results.json \
  -v "$ROOT/scripts/rnf001-ui-p95.mjs:/work/rnf001-ui-p95.mjs:ro" \
  -v "$OUT_DIR:/out" \
  -w /work \
  mcr.microsoft.com/playwright:v1.61.1-noble \
  bash -lc 'npm init -y >/dev/null 2>&1; npm install playwright@1.61.1 --no-audit --no-fund >/dev/null; node rnf001-ui-p95.mjs'
RNF_EXIT=$?
set -e

echo "== results =="
if [[ -f "$OUT_FILE" ]]; then
  cat "$OUT_FILE"
  echo
  echo "RNF001_OUT=$OUT_FILE"
else
  echo "RNF001_OUT_MISSING"
fi
echo "RNF001_EXIT=$RNF_EXIT"
exit "$RNF_EXIT"
