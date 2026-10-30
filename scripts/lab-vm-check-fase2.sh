#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/BioAvanceD-v2"
echo "=== container status ==="
docker ps -a --filter name=reference-data --format '{{.Names}} {{.Status}}'
for c in \
  bioavanced-reference-data-bootstrap-1 \
  bioavanced-reference-data-bootstrap-orpha-1 \
  bioavanced-reference-data-bootstrap-icd10-1 \
  bioavanced-reference-data-bootstrap-loinc-1 \
  bioavanced-reference-data-bootstrap-dcb-1 \
  bioavanced-reference-data-bootstrap-atc-1
do
  echo "=== logs $c ==="
  docker logs --tail=50 "$c" 2>&1 || true
done
echo "=== mongo counts (sample) ==="
docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml exec -T mongodb \
  mongosh --quiet bioavanced_dev --eval '
    const cols = ["referenceImportRuns","referenceDatasetReleases","terminologyConcepts"];
    cols.forEach(c => { try { print(c + "=" + db.getCollection(c).countDocuments()); } catch(e) { print(c + "=ERR"); } });
  ' 2>&1 || true
