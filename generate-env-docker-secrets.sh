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

openssl genpkey -algorithm ED25519 -out "$TMP/private.pem"
openssl pkey -in "$TMP/private.pem" -pubout -out "$TMP/public.pem"

PRIVATE_ENV="$(python3 - "$TMP/private.pem" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text().rstrip("\n")
print(s.replace("\\","\\\\").replace("\n","\\n"))
PY
)"

PUBLIC_JSON="$(python3 - "$KEY_ID" "$TMP/public.pem" <<'PY'
from pathlib import Path
import json, sys
print(json.dumps({sys.argv[1]: Path(sys.argv[2]).read_text()}, separators=(",",":")))
PY
)"

cat > "$OUT" <<EOF
NODE_ENV=development
PORT=3000

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
AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM="$PRIVATE_ENV"
AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON='$PUBLIC_JSON'
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
echo "Cole sua chave real em RESEND_API_KEY e mantenha o arquivo fora do Git."
