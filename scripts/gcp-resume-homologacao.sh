#!/usr/bin/env bash
# Resume homologation Wave 0+ on the GCP lab VM.
set -euo pipefail
cd ~/BioAvanceD-v2

echo "== host =="
hostname
df -h / | tail -1
free -h | head -2

echo "== git =="
git fetch origin fix/frontend-shadcn-quantity-and-cleanup
git stash push -u -m "lab-wip-before-homolog-$(date +%Y%m%d%H%M)" || true
git checkout -B fix/frontend-shadcn-quantity-and-cleanup origin/fix/frontend-shadcn-quantity-and-cleanup
git reset --hard origin/fix/frontend-shadcn-quantity-and-cleanup
git log -1 --oneline
git status -sb | head -5

echo "== docker prune soft =="
docker system df || true
# Keep images if possible; only prune dangling build cache if disk is tight
AVAIL_GB=$(df -BG / | awk 'NR==2{gsub(/G/,"",$4); print $4}')
if [ "${AVAIL_GB:-0}" -lt 40 ]; then
  docker builder prune -af || true
  docker system prune -f || true
fi

echo "== stop leftover compose stacks =="
npm run compose:down 2>/dev/null || true
docker compose --env-file .env.test.example -f compose.test.yml down --remove-orphans 2>/dev/null || true

echo "== e2e-gate =="
rm -rf e2e-gate-out-gcp-wave0
bash scripts/e2e-gate.sh e2e-gate-out-gcp-wave0
code=$?
echo "E2E_GATE_EXIT=$code"
tail -n 40 e2e-gate-out-gcp-wave0/e2e.txt || true
exit "$code"
