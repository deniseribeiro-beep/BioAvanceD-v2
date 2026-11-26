#!/usr/bin/env bash
set -euo pipefail
echo "=== tip BioAvanceD-v2 ==="
git -C /home/denis/BioAvanceD-v2 log -1 --oneline
echo "=== Sidebar marker ==="
grep -n 'w-72' /home/denis/BioAvanceD-v2-homolog/frontend/src/components/Layout/Sidebar.tsx | head -3
echo "=== Layout marker ==="
grep -n 'xl:pl-72' /home/denis/BioAvanceD-v2-homolog/frontend/src/components/Layout/Layout.tsx
echo "=== demo ==="
test -f /home/denis/BioAvanceD-v2-homolog/frontend-ui-demo/package.json && echo DEMO_PRESENT
echo "=== evidence ==="
test -f /home/denis/BioAvanceD-v2-homolog/docs/evidencias/homologacao-runtime/rnf001-ui-p95-results.json && echo RNF001_EVIDENCE_OK
echo "=== image bake ==="
docker run --rm --entrypoint sh bioavanced-test-frontend-app-test:latest -c \
  'grep -R w-72 /app/dist/assets | head -3; grep -R xl:pl-72 /app/dist/assets | head -2; echo VERIFY_OK'
echo "=== PHASE2_OK ==="
