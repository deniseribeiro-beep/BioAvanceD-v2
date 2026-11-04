#!/usr/bin/env bash
set -u
pkill -f gcp-watchdog-homolog || true
pkill -f e2e-gate-monitored || true
docker rm -f e2e-gate 2>/dev/null || true
cd "${HOMOLOG_ROOT:-$HOME/BioAvanceD-v2-homolog}"
docker compose --env-file .env.test.example -f compose.test.yml down --remove-orphans || true
grep -n DESKTOP_SECURITY tests/e2e/rnf027-interface.spec.ts | head -3 || true
: > "$HOME/homolog-watchdog.log"
nohup bash "$PWD/scripts/gcp-watchdog-homolog.sh" >> "$HOME/homolog-watchdog.log" 2>&1 &
echo "WATCHDOG_PID=$!"
sleep 2
head -n 12 "$HOME/homolog-watchdog.log"
pgrep -af gcp-watchdog-homolog || true
