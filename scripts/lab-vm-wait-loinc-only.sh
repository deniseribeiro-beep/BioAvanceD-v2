#!/usr/bin/env bash
set -uo pipefail
MAX_TICKS="${1:-90}"
for i in $(seq 1 "$MAX_TICKS"); do
  running=$(docker ps --filter name=loinc --format '{{.Names}}' | wc -l | tr -d ' ')
  echo "tick=$i running=$running $(date -Is)"
  if [ "$running" = "0" ]; then
    break
  fi
  sleep 60
done
docker ps -a --filter name=loinc --format '{{.Names}} {{.Status}}'
echo '=== loinc logs tail ==='
docker logs --tail=40 bioavanced-reference-data-bootstrap-loinc-1 2>&1 | tail -40
echo 'WAIT_LOINC_DONE'
