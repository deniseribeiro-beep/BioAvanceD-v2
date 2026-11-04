#!/usr/bin/env bash
set -u
ROOT="${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
cd "$ROOT"
pkill -f gcp-watchdog-homolog || true
pkill -f e2e-gate-monitored || true
docker rm -f e2e-gate 2>/dev/null || true
docker compose --env-file .env.test.example -f compose.test.yml down --remove-orphans || true
# Bust cache so Sidebar.tsx / e2e specs land in images
docker compose --env-file .env.test.example -f compose.test.yml build --no-cache frontend-app-test playwright-runner
: > "$HOME/homolog-watchdog.log"
nohup bash "$ROOT/scripts/gcp-watchdog-homolog.sh" >> "$HOME/homolog-watchdog.log" 2>&1 &
echo "WATCHDOG_PID=$!"
sleep 2
head -n 12 "$HOME/homolog-watchdog.log"
