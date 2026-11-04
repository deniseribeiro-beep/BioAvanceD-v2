#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
docker run --rm --network host \
  -e BASE_URL=http://127.0.0.1:5173 \
  -e API_URL=http://127.0.0.1:3000 \
  -e TEST_USER=admin \
  -e TEST_PASS='Admin@123-e2e-stack' \
  -v "$ROOT/scripts/rnf001-auth-probe.mjs:/work/rnf001-auth-probe.mjs:ro" \
  -w /work \
  mcr.microsoft.com/playwright:v1.61.1-noble \
  bash -lc 'npm init -y >/dev/null 2>&1; npm install playwright@1.61.1 --no-audit --no-fund >/dev/null; node rnf001-auth-probe.mjs'
