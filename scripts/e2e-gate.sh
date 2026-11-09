#!/usr/bin/env bash
# Full e2e gate on a fresh test volume, with the in-container Playwright runner.
# Run from the repo root: bash scripts/e2e-gate.sh <output dir>
#
# Steps: build compose.test.yml; bring up the 13 long-running services, which
# runs the Foundation job first as the API's dependency; run the admin bootstrap
# and the reference-data bootstrap chain with --no-deps; check
# every one-shot exited 0 and the projection worker is still up; stop the
# projection worker, run the test tagged @projection-worker-stopped alone
# (#1503) and start the worker again; run playwright-runner with --no-deps
# and collect its logs.
#
# Exit codes: 3 build, 4 stack up, 5 a one-shot did not exit 0, 6 projection
# worker not up, 7 the projection worker did not stop or restart, 8 the
# stopped-worker phase failed, its log in e2e-worker-stopped.txt, 9 the main
# run never started (no exit code); otherwise the runner's own exit code,
# which wins over 8. Checks that depend on the
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
# foundation-bootstrap-test is not in this chain: backend-app-test depends on it
# (RF022 AC4), so the up above already ran it before the API started.
CHAIN=$($DC config --services | grep -E '^reference-data-bootstrap.*-test$' | tr '\n' ' ')
$DC up -d --no-deps $CHAIN > "$OUT/chain.txt" 2>&1
for i in $(seq 1 60); do
  [ "$(docker ps --format '{{.Names}}' | grep -c bootstrap)" -eq 0 ] && break
  sleep 5
done
docker ps -a --format '{{.Names}} {{.Status}}' | grep -E 'bootstrap|projection-worker' > "$OUT/oneshots.txt"
grep bootstrap "$OUT/oneshots.txt" | grep -vq 'Exited (0)' && exit 5
# Container names carry the replica suffix: bioavanced-test-neo4j-projection-worker-test-1.
grep -qE 'neo4j-projection-worker-test-[0-9]+ Up' "$OUT/oneshots.txt" || exit 6
# #1503 (RF023 AC8, RNF028 C2): the test tagged @projection-worker-stopped runs
# alone with the projection worker stopped; the worker is started again and
# must be healthy before the full run, where that test skips.
# -t 60: the worker finishes its current batch on SIGTERM, and a batch killed
# at compose's default 10 s would leave leased PROCESSING rows for the
# 5-minute lease.
$DC stop -t 60 neo4j-projection-worker-test > "$OUT/worker-stop.txt" 2>&1 || exit 7
docker rm -f e2e-gate-worker-stopped > /dev/null 2>&1
$DC run -d --no-deps --name e2e-gate-worker-stopped -e E2E_PROJECTION_WORKER_STOPPED=1 playwright-runner \
  node tests/e2e/docker/loopback-forward.cjs 5173=frontend-app-test:5173 3000=backend-app-test:3000 \
  -- npx playwright test --grep @projection-worker-stopped > /dev/null 2>&1
stopped_code=$(docker wait e2e-gate-worker-stopped)
docker logs e2e-gate-worker-stopped > "$OUT/e2e-worker-stopped.txt" 2>&1
docker rm e2e-gate-worker-stopped > /dev/null 2>&1
$DC up -d --wait --no-deps neo4j-projection-worker-test > "$OUT/worker-start.txt" 2>&1 || exit 7
docker rm -f e2e-gate > /dev/null 2>&1
$DC run -d --no-deps --name e2e-gate playwright-runner > /dev/null 2>&1
code=$(docker wait e2e-gate)
docker logs e2e-gate > "$OUT/e2e.txt" 2>&1
docker rm e2e-gate > /dev/null 2>&1
# An empty or non-numeric $code (the main run never started) is exit 9: a bare
# `exit ""` does not exit in bash 5.3, which would fall through to exit 0.
case "$code" in
  0) ;;
  ''|*[!0-9]*) exit 9 ;;
  *) exit "$code" ;;
esac
# An empty $stopped_code (the phase's run never started) counts as a failure.
[ "$stopped_code" = "0" ] || exit 8
exit 0
