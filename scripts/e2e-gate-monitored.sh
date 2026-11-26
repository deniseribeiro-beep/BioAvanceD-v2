#!/usr/bin/env bash
# e2e-gate with infra fail-fast: poll mongodb-test + backend-app-test every 30s
# while waiting for the playwright runner. Two consecutive unhealthy/Exited
# polls abort the gate (exit 20) and write infra-abort.txt.
#
# Usage (repo root): bash scripts/e2e-gate-monitored.sh <output dir>
set -u
OUT="${1:?usage: e2e-gate-monitored.sh <output dir>}"
mkdir -p "$OUT"
DC="docker compose --env-file .env.test.example -f compose.test.yml"
$DC build > "$OUT/build.txt" 2>&1 || exit 3
$DC up -d --wait mongodb-test neo4j-test redis-test mqtt-test influxdb-test smtp-test \
  tsa-test witness-test backend-app-test trusted-hop-test worker-test \
  frontend-app-test neo4j-projection-worker-test > "$OUT/up.txt" 2>&1 || exit 4
$DC up -d --wait --no-deps admin-bootstrap-test > "$OUT/boot.txt" 2>&1
CHAIN=$($DC config --services | grep -E '^reference-data-bootstrap.*-test$' | tr '\n' ' ')
$DC up -d --no-deps $CHAIN > "$OUT/chain.txt" 2>&1
for i in $(seq 1 60); do
  [ "$(docker ps --format '{{.Names}}' | grep -c bootstrap)" -eq 0 ] && break
  sleep 5
done
# Scope to the test compose project only (lab bioavanced-*-bootstrap must not trip exit 5).
docker ps -a --format '{{.Names}} {{.Status}}' | grep -E 'bioavanced-test-.*(bootstrap|projection-worker)' > "$OUT/oneshots.txt"
grep bootstrap "$OUT/oneshots.txt" | grep -vq 'Exited (0)' && exit 5
grep -qE 'neo4j-projection-worker-test-[0-9]+ Up' "$OUT/oneshots.txt" || exit 6
docker rm -f e2e-gate > /dev/null 2>&1
$DC run -d --no-deps --name e2e-gate playwright-runner > /dev/null 2>&1

bad_streak=0
abort=0
while docker ps --format '{{.Names}}' | grep -qx e2e-gate; do
  mongo_status=$(docker ps -a --filter name=bioavanced-test-mongodb-test --format '{{.Status}}' | head -1)
  backend_status=$(docker ps -a --filter name=bioavanced-test-backend-app-test --format '{{.Status}}' | head -1)
  unhealthy=0
  case "$mongo_status" in
    ''|*Exited*|*unhealthy*|*Dead*|*Restarting*) unhealthy=1 ;;
  esac
  case "$backend_status" in
    ''|*Exited*|*unhealthy*|*Dead*|*Restarting*) unhealthy=1 ;;
  esac
  if [ "$unhealthy" -eq 1 ]; then
    bad_streak=$((bad_streak + 1))
  else
    bad_streak=0
  fi
  if [ "$bad_streak" -ge 2 ]; then
    {
      echo "TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "REASON=infra_unhealthy"
      echo "MONGO_STATUS=$mongo_status"
      echo "BACKEND_STATUS=$backend_status"
      docker ps -a --format '{{.Names}} {{.Status}}' | head -40
    } > "$OUT/infra-abort.txt"
    docker rm -f e2e-gate > /dev/null 2>&1 || true
    abort=1
    break
  fi
  # docker wait blocks forever; poll with short waits instead
  if ! docker ps --format '{{.Names}}' | grep -qx e2e-gate; then
    break
  fi
  # If container already exited, stop polling
  state=$(docker inspect -f '{{.State.Status}}' e2e-gate 2>/dev/null || echo missing)
  if [ "$state" = "exited" ] || [ "$state" = "dead" ] || [ "$state" = "missing" ]; then
    break
  fi
  sleep 30
done

if [ "$abort" -eq 1 ]; then
  docker logs e2e-gate > "$OUT/e2e.txt" 2>&1 || true
  exit 20
fi

code=$(docker inspect -f '{{.State.ExitCode}}' e2e-gate 2>/dev/null || echo 1)
# If still running (race), fall back to wait
if docker ps --format '{{.Names}}' | grep -qx e2e-gate; then
  code=$(docker wait e2e-gate)
fi
docker logs e2e-gate > "$OUT/e2e.txt" 2>&1 || true
docker rm -f e2e-gate > /dev/null 2>&1 || true
exit "$code"
