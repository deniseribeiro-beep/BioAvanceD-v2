#!/usr/bin/env bash
# Full e2e gate on a fresh test volume, with the in-container Playwright runner.
# Run from the repo root: bash scripts/e2e-gate.sh <output dir>
#
# Steps: build compose.test.yml; bring up the 13 long-running services; run the
# admin bootstrap and the reference-data bootstrap chain with --no-deps; check
# every one-shot exited 0 and the projection worker is still up; run
# playwright-runner with --no-deps and collect its logs.
#
# Exit codes: 3 build, 4 stack up, 5 a one-shot did not exit 0, 6 projection
# worker not up; otherwise the runner's own exit code. Checks that depend on the
# machine (free RAM, the engine running) stay outside this script.
set -u
OUT="${1:?usage: e2e-gate.sh <output dir>}"
mkdir -p "$OUT"
DC="docker compose --env-file .env.test.example -f compose.test.yml"
$DC build > "$OUT/build.txt" 2>&1 || exit 3
$DC up -d --wait mongodb-test neo4j-test redis-test mqtt-test influxdb-test smtp-test \
  tsa-test witness-test backend-app-test trusted-hop-test worker-test \
  frontend-app-test neo4j-projection-worker-test > "$OUT/up.txt" 2>&1 || exit 4
$DC up -d --wait --no-deps admin-bootstrap-test > "$OUT/boot.txt" 2>&1   # exits 1 on success; checked below
CHAIN=$($DC config --services | grep -E '^(foundation-bootstrap-test|reference-data-bootstrap.*-test)$' | tr '\n' ' ')
$DC up -d --no-deps $CHAIN > "$OUT/chain.txt" 2>&1
for i in $(seq 1 60); do
  [ "$(docker ps --format '{{.Names}}' | grep -c bootstrap)" -eq 0 ] && break
  sleep 5
done
docker ps -a --format '{{.Names}} {{.Status}}' | grep -E 'bootstrap|projection-worker' > "$OUT/oneshots.txt"
grep bootstrap "$OUT/oneshots.txt" | grep -vq 'Exited (0)' && exit 5
# Container names carry the replica suffix: bioavanced-test-neo4j-projection-worker-test-1.
grep -qE 'neo4j-projection-worker-test-[0-9]+ Up' "$OUT/oneshots.txt" || exit 6
docker rm -f e2e-gate > /dev/null 2>&1
$DC run -d --no-deps --name e2e-gate playwright-runner > /dev/null 2>&1
code=$(docker wait e2e-gate)
docker logs e2e-gate > "$OUT/e2e.txt" 2>&1
docker rm e2e-gate > /dev/null 2>&1
exit "$code"
