#!/usr/bin/env bash
# Recreate mongo with capped WT cache, verify, start homolog watchdog.
set -euo pipefail
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
cd "$ROOT"
DC=(docker compose --env-file .env.test.example -f compose.test.yml)

echo "== down =="
"${DC[@]}" down -v --remove-orphans || true
docker rm -f e2e-gate 2>/dev/null || true

echo "== mongo up =="
"${DC[@]}" up -d mongodb-test
sleep 12
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.Limit}}' || true

echo "== wiredTiger max =="
docker exec bioavanced-test-mongodb-test-1 mongosh --quiet --eval \
  'const c=db.serverStatus().wiredTiger.cache; const k=Object.keys(c).find(x=>x.indexOf("maximum bytes")===0); print(k); print(c[k]);' \
  || true

echo "== free =="
free -h

echo "== full down before watchdog =="
"${DC[@]}" down -v --remove-orphans || true

: > "$HOME/homolog-watchdog.log"
nohup bash "$ROOT/scripts/gcp-watchdog-homolog.sh" >> "$HOME/homolog-watchdog.log" 2>&1 &
echo "WATCHDOG_PID=$!"
sleep 2
head -n 20 "$HOME/homolog-watchdog.log"
pgrep -af gcp-watchdog-homolog || true
