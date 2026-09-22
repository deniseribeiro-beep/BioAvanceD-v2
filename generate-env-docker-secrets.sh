#!/usr/bin/env bash
set -euo pipefail

UPGRADE=0
if [[ "${1:-}" == "--upgrade" ]]; then
  UPGRADE=1
  shift
fi

OUT="${1:-.env.docker}"

# #1060: the refusal below is correct for a FRESH generate -- it exists so a re-run
# cannot mint new database credentials over the volumes a running stack was
# initialised with. But it also made this script the only delivery mechanism for
# #989's audit-key fix while refusing to run wherever a .env.docker already existed,
# so an environment created before dbfae763 could never receive it: it keeps no
# AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE, both signing chains throw, and the sealing
# path stays dead with nothing telling the operator which case they are in.
#
# --upgrade is the way in. It only ever ADDS what is missing and rewrites the three
# AUDIT_MERKLE_SIGN_* lines to match the key file; it never regenerates a credential
# that already has a value, so the guard's intent is preserved exactly.
if [[ -e "$OUT" && "$UPGRADE" -eq 0 ]]; then
  echo "Erro: $OUT já existe. Não sobrescrevendo." >&2
  echo "Para adicionar somente as variáveis ausentes (e a chave de auditoria), use:" >&2
  echo "  $0 --upgrade $OUT" >&2
  exit 1
fi

if [[ "$UPGRADE" -eq 1 && ! -e "$OUT" ]]; then
  echo "Erro: --upgrade exige um $OUT existente. Rode sem --upgrade para gerar." >&2
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
EXAMPLE="$SCRIPT_DIR/.env.docker.example"
[[ -f "$EXAMPLE" ]] || { echo "Erro: $EXAMPLE não encontrado." >&2; exit 1; }

# #1153: BOTH paths fill from the example, through this one function. A fresh
# generate used to write 31 of the 80 variables the example declares, so the
# working recipe for a correct dev env was "generate, then immediately
# --upgrade" -- which nobody would infer and nothing said. The 49 it omitted
# included REDIS_URL, REDIS_HOST and REDIS_PORT, and compose.dev.yml supplies
# none of them: its backend service is env_file: .env.docker plus an
# environment: block holding only the two CHOKIDAR variables. So a freshly
# generated dev stack had no Redis configuration at all, and since the file
# sets NODE_ENV=development, validateRedisOnly's development escape hatch logged
# "Redis não será inicializado" and let the boot continue -- an import queue that
# silently did nothing. ALLOWED_ORIGINS and FRONTEND_URL were absent on the same
# terms.
#
# Adds only what is MISSING, with the example's own value, and never touches an
# existing line -- so a live stack's credentials survive, and where the two
# sources disagree in value the generator's choice wins. That matters for
# AUDIT_RFC3161_MODE, which the example ships as `remote` and this script sets to
# `disabled`; which is intended is #962's open call, and filling gaps must not
# silently decide it. An architecture test pins both halves.
#
# Safe to copy values because no secret in .env.docker.example carries a real
# one -- every secret-shaped entry there is blank.
sync_from_example() {
  local target="$1"
  local line name
  SYNC_ADDED=0
  while IFS= read -r line; do
    case "$line" in
      [A-Z]*=*) ;;
      *) continue ;;
    esac
    name="${line%%=*}"
    if ! grep -q "^$name=" "$target"; then
      printf '%s\n' "$line" >> "$target"
      SYNC_ADDED=$((SYNC_ADDED + 1))
      echo "  + $name"
    fi
  done < "$EXAMPLE"
}
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

if [[ "$UPGRADE" -eq 1 ]]; then
  BACKUP="$OUT.bak-$(date +%Y%m%d%H%M%S)"
  cp "$OUT" "$BACKUP"
  chmod 600 "$BACKUP" || true

  sync_from_example "$OUT"
  added="$SYNC_ADDED"

  # The three signing values are SET, not merely added. The example ships
  # AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON={}, and an EMPTY registry is worse than an
  # absent one: auditRoot.service.js#processTimestampBacklog verifies every signed
  # root against it and stamps a miss FAILED / signature_unknown_key_id, so the
  # stack would sign correctly and then report every artifact invalid. They have to
  # match the key file minted above, which is why they are computed and not copied.
  # Pure bash on purpose: the value must never reach a native program. Measured on
  # Git Bash/MSYS, a Unix absolute path is rewritten on the way to one BOTH as an
  # argv token and as an environment value, so python3 turned
  # /run/secrets/merkle_signing_key.pem -- a CONTAINER path that has to survive
  # verbatim for the compose bind mount to resolve -- into
  # C:/Program Files/Git/run/secrets/... Bash itself does no such translation.
  set_var() {
    local n="$1" v="$2"
    local tmp="$OUT.tmp.$$"
    local found=0
    : > "$tmp"
    while IFS= read -r l || [ -n "$l" ]; do
      if [[ "$l" == "$n="* ]]; then
        printf '%s=%s\n' "$n" "$v" >> "$tmp"
        found=1
      else
        printf '%s\n' "$l" >> "$tmp"
      fi
    done < "$OUT"
    if [[ "$found" -eq 0 ]]; then
      printf '%s=%s\n' "$n" "$v" >> "$tmp"
    fi
    mv "$tmp" "$OUT"
  }

  set_var AUDIT_MERKLE_SIGN_KEY_ID "$KEY_ID"
  set_var AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE "$KEY_FILE_IN_CONTAINER"
  set_var AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON "$PUBLIC_JSON"

  chmod 600 "$OUT"
  echo "Atualizado: $OUT ($added variável(is) adicionada(s))."
  echo "Backup do arquivo anterior: $BACKUP"
  echo "AUDIT_MERKLE_SIGN_* sincronizado com $KEY_FILE."
  exit 0
fi

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

# #1153: the generator's own lines are already in place, so this only fills the
# rest -- and cannot overwrite a value chosen above.
sync_from_example "$OUT"

chmod 600 "$OUT"
echo "Gerado: $OUT ($SYNC_ADDED variável(is) preenchida(s) a partir de $EXAMPLE)."
echo "AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE -> $KEY_FILE_IN_CONTAINER (host: $KEY_FILE)."
echo "Cole sua chave real em RESEND_API_KEY e mantenha o arquivo fora do Git."
