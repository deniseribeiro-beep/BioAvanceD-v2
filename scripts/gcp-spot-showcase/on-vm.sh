#!/usr/bin/env bash
# Runs on the spot VM as root under systemd-run (#1565); run-from-pc.sh
# uploads it with repo.tgz, run.env and ghcr-token into /tmp and starts it.
# It installs Docker, pulls the published images, builds tsa-test and
# witness-test, brings the stack up with the reference data, checks the API
# and the frontend answer, and with SHOWCASE=1 records the showcase reel as
# mp4. Everything it writes is under /tmp/bioavanced-cd/out, packed into
# /tmp/bioavanced-cd/out.tgz on exit; the exit code goes last into
# /tmp/bioavanced-cd/exit-code.
#
#   bash /tmp/on-vm.sh status   prints the exit code once written, else
#                               "running" (the driver's poll; any user)
#
# Exit codes: 2 /tmp/run.env missing, 3 the tree did not extract, 10 Docker
# install, 11 GHCR login or pull, 12 build, 4 stack up, 5 a bootstrap one-shot
# did not exit 0, 6 projection worker not up, 13 smoke (the API or the
# frontend did not answer 200), 14 the showcase reel (Node, Playwright, the
# recording, or no mp4 left).
W=/tmp/bioavanced-cd
if [ "${1:-}" = status ]; then
  if [ -f "$W/exit-code" ]; then cat "$W/exit-code"; else echo running; fi
  exit 0
fi

set -u
OUT=$W/out
DC="docker compose --env-file .env.test.example -f compose.test.yml -f compose.test.images.yml"
mkdir -p "$OUT"

finish() {
  local rc=$?
  rm -f /tmp/ghcr-token
  docker logout ghcr.io > /dev/null 2>&1
  docker ps -a > "$OUT/docker-ps.txt" 2>&1
  df -h > "$OUT/df.txt" 2>&1
  free -m > "$OUT/free.txt" 2>&1
  if [ -d "$W/repo" ]; then
    (cd "$W/repo" && $DC logs --no-color > "$OUT/compose-test.log" 2>&1) || true
  fi
  tar -czf "$W/out.tgz" -C "$W" out
  chmod 644 "$W/out.tgz"
  echo "$rc" > "$W/exit-code.tmp"
  mv -f "$W/exit-code.tmp" "$W/exit-code"
}
trap finish EXIT

exec > "$OUT/on-vm.log" 2>&1
[ -f /tmp/run.env ] || { echo "/tmp/run.env is missing"; exit 2; }
# shellcheck disable=SC1091  # written by run-from-pc.sh
. /tmp/run.env
export IMAGE_TAG
export DEBIAN_FRONTEND=noninteractive

# 1. Docker from Docker's own apt repository. The lock timeout waits out
# the first-boot apt runs.
echo "== docker install"
cloud-init status --wait > /dev/null 2>&1 || true
APT="apt-get -o DPkg::Lock::Timeout=600"
{
  $APT update &&
    $APT install -y ca-certificates curl &&
    install -m 0755 -d /etc/apt/keyrings &&
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc &&
    chmod a+r /etc/apt/keyrings/docker.asc &&
    . /etc/os-release &&
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
      > /etc/apt/sources.list.d/docker.list &&
    $APT update &&
    $APT install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
} > "$OUT/apt.txt" 2>&1 || exit 10

# 2. The tree at the image tag, archived on the PC.
echo "== tree"
mkdir -p "$W/repo" && tar -xzf /tmp/repo.tgz -C "$W/repo" || exit 3
cd "$W/repo" || exit 3

# 3. GHCR: the images are private. The login stores the token in root's
# docker config, so it is logged out again once the pulls are done.
echo "== ghcr"
docker login ghcr.io -u "$GHCR_USER" --password-stdin < /tmp/ghcr-token > "$OUT/ghcr.txt" 2>&1
login_rc=$?
shred -u /tmp/ghcr-token 2>/dev/null || rm -f /tmp/ghcr-token
[ "$login_rc" -eq 0 ] || exit 11
{
  docker pull "ghcr.io/deniseribeiro-beep/bioavanced-backend-test:${IMAGE_TAG}" &&
    docker pull "ghcr.io/deniseribeiro-beep/bioavanced-frontend-test:${IMAGE_TAG}"
} >> "$OUT/ghcr.txt" 2>&1
pull_rc=$?
docker logout ghcr.io >> "$OUT/ghcr.txt" 2>&1
[ "$pull_rc" -eq 0 ] || exit 11

# 4. The services that are not published.
echo "== build"
docker compose \
  --env-file .env.test.example \
  -f compose.test.yml \
  -f compose.test.images.yml \
  build tsa-test witness-test > "$OUT/build.txt" 2>&1 || exit 12

# 5. A copy of the "Start the stack and load reference data" step of
# .github/workflows/showcase.yml, writing into $OUT; a change there is made
# here too. The admin bootstrap's `up --wait` exits 1 on success, so no
# command here stops the script; every one-shot is checked below instead.
echo "== stack"
set +e
mkdir -p "$OUT"
$DC up -d --wait --no-build mongodb-test neo4j-test redis-test mqtt-test influxdb-test smtp-test \
  tsa-test witness-test backend-app-test trusted-hop-test worker-test \
  frontend-app-test neo4j-projection-worker-test > "$OUT/up.txt" 2>&1 \
  || { cat "$OUT/up.txt"; echo "the stack did not come up"; exit 4; }
$DC up -d --wait --no-build --no-deps admin-bootstrap-test > "$OUT/boot.txt" 2>&1
CHAIN=$($DC config --services | grep -E '^reference-data-bootstrap.*-test$' | tr '\n' ' ')
# shellcheck disable=SC2086  # CHAIN is a list of service names
$DC up -d --no-build --no-deps $CHAIN > "$OUT/chain.txt" 2>&1
for i in $(seq 1 60); do
  [ "$(docker ps --format '{{.Names}}' | grep -c bootstrap)" -eq 0 ] && break
  sleep 5
done
docker ps -a --format '{{.Names}} {{.Status}}' | grep -E 'bootstrap|projection-worker' > "$OUT/oneshots.txt"
cat "$OUT/oneshots.txt"
if grep bootstrap "$OUT/oneshots.txt" | grep -vq 'Exited (0)'; then
  echo "a bootstrap one-shot did not exit 0"; exit 5
fi
grep -qE 'neo4j-projection-worker-test-[0-9]+ Up' "$OUT/oneshots.txt" \
  || { echo "the projection worker is not up"; exit 6; }

# 6. Smoke: the API and the frontend answer on the VM's loopback.
echo "== smoke"
api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/api/health)
web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:5173/)
printf 'api %s\nfrontend %s\n' "$api" "$web" > "$OUT/smoke.txt"
cat "$OUT/smoke.txt"
{ [ "$api" = 200 ] && [ "$web" = 200 ]; } || exit 13

# 7. The showcase reel: the "Install Playwright", "Record the showcase reel"
# and "Convert the videos to mp4" steps of .github/workflows/showcase.yml.
if [ "${SHOWCASE:-0}" = 1 ]; then
  echo "== showcase"
  {
    curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz -o /tmp/node.tar.xz &&
      mkdir -p /opt/node &&
      tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  } > "$OUT/node.txt" 2>&1 || exit 14
  export PATH="/opt/node/bin:$PATH"
  {
    npm ci --no-audit --no-fund &&
      npx playwright install --with-deps chromium
  } > "$OUT/playwright-install.txt" 2>&1 || exit 14
  PLAYWRIGHT_BASE_URL=http://localhost:5173 \
    PLAYWRIGHT_API_BASE_URL=http://localhost:3000 \
    PLAYWRIGHT_SKIP_WEBSERVER=1 \
    TEST_SUPPORT_SECRET=e2e-test-support-secret \
    TELEMETRY_INGEST_SECRET=e2e-telemetry-ingest-secret \
    npx playwright test --config=playwright.showcase.config.ts --output "$OUT/results" > "$OUT/showcase.txt" 2>&1
  reel_rc=$?
  if [ -d "$OUT/results" ]; then
    {
      apt-get -o DPkg::Lock::Timeout=600 update -qq
      apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends ffmpeg
      mkdir -p "$OUT/mp4"
      find "$OUT/results" -name '*.webm' -print0 | while IFS= read -r -d '' webm; do
        name="$(basename "$(dirname "$webm")")"
        ffmpeg -nostdin -y -loglevel error -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
          "$OUT/mp4/${name}.mp4"
      done
      ls -l "$OUT/mp4"
    } > "$OUT/mp4.txt" 2>&1
  fi
  [ -n "$(find "$OUT/mp4" -name '*.mp4' 2>/dev/null | head -n 1)" ] || { echo "no mp4 was made"; exit 14; }
  [ "$reel_rc" -eq 0 ] || { echo "the showcase reel exited $reel_rc"; exit 14; }
fi

exit 0
