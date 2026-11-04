#!/usr/bin/env bash
# Wait for mongodb-test to exit and dump diagnostics to ~/mongo-exit-capture.log
set -u
OUT="${1:-$HOME/mongo-exit-capture.log}"
: > "$OUT"
echo "CAPTURE_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT"
while true; do
  status=$(docker ps -a --filter name=bioavanced-test-mongodb-test-1 --format '{{.Status}}' | head -1)
  echo "POLL=$(date -u +%Y-%m-%dT%H:%M:%SZ) STATUS=$status" >> "$OUT"
  case "$status" in
    Exited*|Dead*)
      echo "ABORT_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT"
      docker inspect bioavanced-test-mongodb-test-1 \
        --format 'OOM={{.State.OOMKilled}} Exit={{.State.ExitCode}} Error={{.State.Error}} Cmd={{json .Config.Cmd}} Memory={{.HostConfig.Memory}}' \
        | tee -a "$OUT"
      echo '=== docker logs ===' >> "$OUT"
      docker logs bioavanced-test-mongodb-test-1 >> "$OUT" 2>&1 || true
      echo '=== free ===' >> "$OUT"
      free -h >> "$OUT" || true
      echo '=== dmesg ===' >> "$OUT"
      dmesg | tail -n 60 >> "$OUT" 2>/dev/null || true
      exit 0
      ;;
  esac
  sleep 5
done
