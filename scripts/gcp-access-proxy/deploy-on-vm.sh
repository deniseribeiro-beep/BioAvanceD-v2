#!/usr/bin/env bash
# Deploy access overlay frontend + nginx proxy on the homolog tree.
set -euo pipefail
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
PROXY_DIR="$ROOT/scripts/gcp-access-proxy"
cd "$ROOT"

sed -i 's/\r$//' "$PROXY_DIR"/*.sh "$PROXY_DIR"/nginx.conf 2>/dev/null || true
chmod +x "$PROXY_DIR"/*.sh

echo "BUILD_FRONTEND_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose --env-file .env.test.example \
  -f compose.test.yml \
  -f scripts/gcp-access-proxy/compose.access-overlay.yml \
  build frontend-app-test

docker compose --env-file .env.test.example \
  -f compose.test.yml \
  -f scripts/gcp-access-proxy/compose.access-overlay.yml \
  up -d --no-deps frontend-app-test

# Wait for frontend healthy
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://127.0.0.1:5173/; then
    echo "FRONTEND_READY"
    break
  fi
  sleep 2
done

bash "$PROXY_DIR/run-proxy.sh"
echo "DEPLOY_ACCESS_DONE=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
