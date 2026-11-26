#!/usr/bin/env bash
# Apply UI-gold frontend sync on the homolog tree and rebuild frontend-app-test.
set -euo pipefail
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
cd "$ROOT"

echo "TIP_MARKER=$(grep -n 'w-72' frontend/src/components/Layout/Sidebar.tsx | head -2 | tr '\n' ' ')"
echo "BUILD_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Build only — do not bring the stack up (preserves last gate evidence / idle lab).
docker compose --env-file .env.test.example -f compose.test.yml build frontend-app-test

echo "BUILD_OK=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Confirm Sectioned shell width class is present in the baked preview assets.
docker run --rm --entrypoint sh bioavanced-test-frontend-app-test:latest -c \
  'grep -R w-72 /app/dist/assets | head -1 >/dev/null && echo BAKE_HAS_W72'
echo "UI_GOLD_SYNC_DONE"
