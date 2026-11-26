#!/usr/bin/env bash
# Produces .env.production from .env.production.example (#978).
#
# Why this exists: the example ships every secret blank, and since #1085 a blank
# ENCRYPTION_KEY under NODE_ENV=production makes backend and worker exit 1.
# compose.prod.yml hands the database containers their credentials by --env-file
# interpolation while the backend reads the same names from env_file, so ONE file
# feeds both readers. MONGO_URI therefore has to embed the very password written
# as MONGO_ROOT_PASSWORD; this script mints each password once and derives the URI
# from it, so the two cannot disagree. The audit signing key (#989) is minted to a
# production-only directory that compose.prod.yml mounts read-only at /run/secrets,
# and the registry the backend verifies against is built from that key (#965).
#
# Usage: bash generate-env-production-secrets.sh [OUT]     (OUT defaults to .env.production)
# Refuses to overwrite an existing OUT, so a re-run cannot mint new credentials over
# the volumes a running stack was initialised with.
set -euo pipefail

umask 077

# The uid (and gid) of `app` in api/backend/Dockerfile.prod, which owns the audit signing key.
APP_UID=10001

OUT="${1:-.env.production}"

if [[ -e "$OUT" ]]; then
  echo "Erro: $OUT já existe. Não sobrescrevendo." >&2
  exit 1
fi

OUT_DIR="$(dirname "$OUT")"
if [[ ! -d "$OUT_DIR" ]]; then
  echo "Erro: o diretório $OUT_DIR não existe." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl é obrigatório" >&2; exit 1; }
# Probe by running, not by name: on Windows, python3 can be the Microsoft Store
# execution alias, which `command -v` finds and which exits 49 with an install
# prompt instead of running anything. Fall back to `python` when it is Python 3.
PYTHON=""
for cand in python3 python; do
  if "$cand" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
    PYTHON="$cand"
    break
  fi
done
[[ -n "$PYTHON" ]] || { echo "python3 é obrigatório" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE="$SCRIPT_DIR/.env.production.example"
[[ -f "$EXAMPLE" ]] || { echo "Erro: $EXAMPLE não encontrado." >&2; exit 1; }

# Some openssl builds (MSYS/mingw) end their output in CRLF; a stray \r would stay in
# every secret and land inside MONGO_URI, so both \r and \n are dropped.
tok() { openssl rand -base64 "$1" | tr -d '\r\n' | tr '+/' '-_' | tr -d '='; }

# Value of NAME in the example, CR stripped.
example_value() {
  local l
  while IFS= read -r l || [ -n "$l" ]; do
    l="${l%$'\r'}"
    if [[ "$l" == "$1="* ]]; then
      printf '%s' "${l#*=}"
      return 0
    fi
  done < "$EXAMPLE"
  return 0
}

MONGO_ROOT_USERNAME="$(example_value MONGO_ROOT_USERNAME)"
MONGO_DB="$(example_value MONGO_DB)"
KEY_ID="$(example_value AUDIT_MERKLE_SIGN_KEY_ID)"

MONGO_ROOT_PASSWORD="$(tok 36)"

KEY_DIR="$SCRIPT_DIR/infra/audit/prod/secrets"
KEY_FILE="$KEY_DIR/merkle_signing_key.pem"
# compose.prod.yml bind-mounts $KEY_DIR read-only at /run/secrets in backend and worker.
KEY_FILE_IN_CONTAINER="/run/secrets/merkle_signing_key.pem"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Minted only when absent, so a re-run cannot orphan a key that already-signed audit
# roots were verified against.
mkdir -p "$KEY_DIR"
if [[ ! -f "$KEY_FILE" ]]; then
  openssl genpkey -algorithm ED25519 -out "$KEY_FILE"
fi
# The production image runs backend and worker as `app`, uid 10001
# (api/backend/Dockerfile.prod), so the bind-mounted key is owned by that uid with
# 0400 and its directory 0700: readable by the container and by no other host user.
# Only root can hand the files to that uid; any other run prints the two commands.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "Aviso: chmod/chown ignorados neste host (Windows): os modos de arquivo não se aplicam; ajuste $KEY_DIR no host Linux de produção." >&2
    ;;
  *)
    chmod 700 "$(dirname "$KEY_DIR")"
    chmod 700 "$KEY_DIR"
    chmod 400 "$KEY_FILE"
    if [[ "$(id -u)" -eq 0 ]]; then
      chown "$APP_UID:$APP_UID" "$KEY_DIR" "$KEY_FILE"
    else
      {
        echo "Aviso: os contêineres não conseguem ler a chave de assinatura até que estes comandos sejam executados:"
        echo "  sudo chown -R $APP_UID:$APP_UID $KEY_DIR"
        echo "  sudo chmod 0400 $KEY_FILE"
      } >&2
    fi
    ;;
esac
openssl pkey -in "$KEY_FILE" -pubout -out "$TMP/public.pem"

PUBLIC_JSON="$("$PYTHON" - "$KEY_ID" "$TMP/public.pem" <<'PY'
from pathlib import Path
import json, sys
print(json.dumps({sys.argv[1]: Path(sys.argv[2]).read_text()}, separators=(",",":")))
PY
)"
PUBLIC_JSON="${PUBLIC_JSON%$'\r'}"

declare -A VALS
VALS[MONGO_ROOT_PASSWORD]="$MONGO_ROOT_PASSWORD"
VALS[MONGO_URI]="mongodb://$MONGO_ROOT_USERNAME:$MONGO_ROOT_PASSWORD@mongodb:27017/$MONGO_DB?authSource=admin&replicaSet=rs0"
# A mongod key file takes only base64 characters, so tok's base64url (- and _) is not used for it; hex is.
VALS[MONGO_REPLICA_SET_KEY]="$(openssl rand -hex 48 | tr -d '\r\n')"
VALS[MONGO_DB_NOVO]="$MONGO_DB"
VALS[NEO4J_PASSWORD]="$(tok 36)"
VALS[INFLUXDB_INIT_PASSWORD]="$(tok 36)"
VALS[REDIS_PASSWORD]="$(tok 36)"
VALS[INFLUXDB_TOKEN]="$(tok 64)"
VALS[JWT_SECRET]="$(tok 64)"
VALS[JWT_REFRESH_SECRET]="$(tok 64)"
VALS[CONSENT_SECRET]="$(tok 64)"
VALS[ENCRYPTION_KEY]="$(tok 64)"
VALS[USER_ANON_SALT]="$(tok 64)"
VALS[AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE]="$KEY_FILE_IN_CONTAINER"
VALS[AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON]="$PUBLIC_JSON"

# Written with bash printf only: a value that passes through a native program is
# rewritten by MSYS when it looks like a Unix path, and /run/secrets/... is a
# CONTAINER path that has to survive verbatim.
TMP_OUT="$OUT.tmp.$$"
BLANK=()
OFFSITE=()
: > "$TMP_OUT"
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  if [[ "$line" =~ ^([A-Z0-9_]+)=(.*)$ ]]; then
    name="${BASH_REMATCH[1]}"
    if [[ -v "VALS[$name]" ]]; then
      printf '%s=%s\n' "$name" "${VALS[$name]}" >> "$TMP_OUT"
      continue
    fi
    [[ -z "${BASH_REMATCH[2]}" ]] && BLANK+=("$name")
  elif [[ "$line" =~ ^#(BACKUP_OFFSITE_S3_[A-Z0-9_]+)= ]]; then
    OFFSITE+=("${BASH_REMATCH[1]}")
  fi
  printf '%s\n' "$line" >> "$TMP_OUT"
done < "$EXAMPLE"
mv "$TMP_OUT" "$OUT"
chmod 600 "$OUT"

echo "Gerado: $OUT"
echo
echo "Chaves deixadas em branco, preencha à mão:"
for n in "${BLANK[@]}"; do
  case "$n" in
    ENCRYPTION_KEY_PREVIOUS|ENCRYPTION_KEY_PREVIOUS_ID)
      echo "  $n (slot de rotação, em branco por projeto)" ;;
    *) echo "  $n" ;;
  esac
done
echo
if [[ ${#OFFSITE[@]} -gt 0 ]]; then
  echo "Backup offsite desligado até que ENDPOINT, BUCKET, ACCESS_KEY_ID e SECRET_ACCESS_KEY estejam todas definidas (hoje comentadas):"
  for n in "${OFFSITE[@]}"; do echo "  $n"; done
  echo
fi
echo "AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE -> $KEY_FILE_IN_CONTAINER (host: $KEY_FILE)."
