#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-.env.docker}"
if [[ -e "$OUT" ]]; then
  echo "Erro: $OUT já existe. Não sobrescrevendo." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl é obrigatório" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 é obrigatório" >&2; exit 1; }

tok() { openssl rand -base64 "$1" | tr -d '\n' | tr '+/' '-_' | tr -d '='; }

MONGO_USER="bioavanced_root"
MONGO_PASSWORD="$(tok 36)"
NEO4J_PASSWORD="$(tok 36)"
INFLUX_USER="bioavanced_admin"
INFLUX_PASSWORD="$(tok 36)"
INFLUX_TOKEN="$(tok 64)"
JWT_SECRET="$(tok 64)"
JWT_REFRESH_SECRET="$(tok 64)"
CONSENT_SECRET="$(tok 64)"
ENCRYPTION_KEY="$(tok 64)"
USER_ANON_SALT="$(tok 64)"
NEO4J_CANONICAL_SALT="$(tok 64)"
KEY_ID="audit-ed25519-dev-1"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# #989: the audit signing key must land on DISK and reach the containers as a FILE
# PATH. Both loaders -- merkle-envelope.service.js#getPrivateKeyPem and
# audit-signing.provider.js#loadPrivateKey -- readFile() whatever
# AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE names and throw otherwise; 2b1ae120 deleted the
# last inline-PEM path. This script used to generate the key into $TMP, export it as
# AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM -- a name no code in the repo reads -- and then let
# the EXIT trap delete the only artifact either loader wants. A stack built from this
# script's own output could therefore never seal a daily root or a tree head.
#
# The key is reused when already present, following infra/witness/entrypoint.sh's
# idempotency guard, so re-running this script cannot orphan a key that
# already-signed audit_roots documents were verified against.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_DIR="$SCRIPT_DIR/infra/audit/secrets"
KEY_FILE="$KEY_DIR/merkle_signing_key.pem"
# compose.dev.yml bind-mounts $KEY_DIR read-only at /run/secrets in backend and worker.
KEY_FILE_IN_CONTAINER="/run/secrets/merkle_signing_key.pem"

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR" || true
if [[ ! -f "$KEY_FILE" ]]; then
  openssl genpkey -algorithm ED25519 -out "$KEY_FILE"
  chmod 600 "$KEY_FILE" || true
  echo "Chave de assinatura de auditoria gerada: $KEY_FILE"
else
  echo "Reutilizando chave de assinatura de auditoria existente: $KEY_FILE"
fi
openssl pkey -in "$KEY_FILE" -pubout -out "$TMP/public.pem"

# The registry MUST be the SPKI half of the key file above: auditRoot.service.js's
# processTimestampBacklog verifies every signed root against it and stamps a mismatch
# FAILED / signature_unknown_key_id, so a key with no matching registry entry yields a
# stack that signs correctly and reports every artifact invalid.
PUBLIC_JSON="$(python3 - "$KEY_ID" "$TMP/public.pem" <<'PY'
from pathlib import Path
import json, sys
print(json.dumps({sys.argv[1]: Path(sys.argv[2]).read_text()}, separators=(",",":")))
PY
)"

cat > "$OUT" <<EOF
NODE_ENV=development
PORT=3000

# #1162: leave blank — opt-in must be explicit. compose.dev.yml sets these
# for the controlled suite; do not inherit true from .env.docker.example.
AUTH_RATE_LIMIT_RELAXED=
CONSENT_RATE_LIMIT_RELAXED=

MONGO_ROOT_USERNAME=$MONGO_USER
MONGO_ROOT_PASSWORD=$MONGO_PASSWORD
MONGO_DB=bioavanced_dev
MONGO_DB_NOVO=bioavanced_dev
MONGO_URI=mongodb://$MONGO_USER:$MONGO_PASSWORD@mongodb:27017/bioavanced_dev?authSource=admin

JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
CONSENT_SECRET=$CONSENT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENCRYPTION_KEY_ID=dev-key-1
USER_ANON_SALT=$USER_ANON_SALT
NEO4J_CANONICAL_SALT=$NEO4J_CANONICAL_SALT

AUDIT_MERKLE_SIGN_KEY_ID=$KEY_ID
AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE=$KEY_FILE_IN_CONTAINER
AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON=$PUBLIC_JSON
AUDIT_RFC3161_MODE=disabled
AUDIT_RFC3161_TSA_URL=
AUDIT_RFC3161_TSA_AUTH_TOKEN=

NEO4J_URI=bolt://neo4j:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=$NEO4J_PASSWORD
NEO4J_DATABASE=neo4j

INFLUXDB_INIT_USERNAME=$INFLUX_USER
INFLUXDB_INIT_PASSWORD=$INFLUX_PASSWORD
INFLUXDB_ORG=bioavanced
INFLUXDB_BUCKET=bioavanced_telemetry
INFLUXDB_TOKEN=$INFLUX_TOKEN
INFLUXDB_URL=http://influxdb:8086

RESEND_API_KEY=COLE_AQUI_SUA_CHAVE_REAL_DO_RESEND
EOF

chmod 600 "$OUT"
echo "Gerado: $OUT"
echo "AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE -> $KEY_FILE_IN_CONTAINER (host: $KEY_FILE)."
echo "Cole sua chave real em RESEND_API_KEY e mantenha o arquivo fora do Git."
