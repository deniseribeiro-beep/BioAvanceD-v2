#!/usr/bin/env bash
set -euo pipefail
for i in $(seq 1 30); do
  running=$(docker ps --filter name=reference-data --format '{{.Names}}' | wc -l)
  echo "tick=$i running=$running $(date -Is)"
  if [ "$running" = "0" ]; then
    break
  fi
  sleep 60
done
bash "$HOME/BioAvanceD-v2/scripts/lab-vm-check-fase2.sh"
