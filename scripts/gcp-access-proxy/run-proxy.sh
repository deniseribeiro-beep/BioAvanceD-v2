#!/usr/bin/env bash
# Run the access proxy on the lab VM (port 8080 → loopback frontend/backend).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
NAME=bioavanced-access-proxy

docker rm -f "$NAME" 2>/dev/null || true

# Attach to the compose test network so upstreams resolve by service name.
# Compose project "bioavanced-test" prefixes the network name.
NET="${COMPOSE_NETWORK:-bioavanced-test_bioavanced-test}"
if ! docker network inspect "$NET" >/dev/null 2>&1; then
  echo "ERROR: docker network $NET not found — start the homolog stack first"
  docker network ls
  exit 1
fi

docker run -d --name "$NAME" --restart unless-stopped \
  --network "$NET" \
  -p 0.0.0.0:8080:8080 \
  -v "$ROOT/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:1.27.5-alpine

sleep 2
if ! curl -sf -o /dev/null --max-time 5 http://127.0.0.1:8080/; then
  echo "WARN: proxy health check failed on :8080"
  docker logs "$NAME" 2>&1 | tail -n 30 || true
fi

echo "PROXY_OK name=$NAME port=8080"
curl -s -o /dev/null -w "proxy_root=%{http_code}\n" http://127.0.0.1:8080/ || true
curl -s -o /dev/null -w "proxy_api=%{http_code}\n" http://127.0.0.1:8080/api/health || true
