#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-}"

REQUIRED_VARS="
JWT_SECRET
JWT_REFRESH_SECRET
CONSENT_SECRET
ENCRYPTION_KEY
ENCRYPTION_KEY_ID
USER_ANON_SALT
FRONTEND_URL
ALLOWED_ORIGINS
MONGO_URI
NEO4J_URI
REDIS_URL
"

SECRET_VARS="
JWT_SECRET
JWT_REFRESH_SECRET
CONSENT_SECRET
ENCRYPTION_KEY
ENCRYPTION_KEY_ID
USER_ANON_SALT
MONGO_URI
REDIS_URL
"

failures=0

usage() {
  printf 'Uso: bash scripts/deploy/check-env.sh <arquivo-env>\n' >&2
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}

pass() {
  printf '[OK] %s\n' "$1"
}

is_secret_var() {
  local name="$1"
  for secret_name in $SECRET_VARS; do
    if [ "$name" = "$secret_name" ]; then
      return 0
    fi
  done
  return 1
}

is_required_var() {
  local name="$1"
  for required_name in $REQUIRED_VARS; do
    if [ "$name" = "$required_name" ]; then
      return 0
    fi
  done
  return 1
}

looks_like_secret_fragment() {
  local text="$1"

  case "$text" in
    *' '*|*'	'*)
      return 1
      ;;
  esac

  if [ "${#text}" -ge 20 ] && printf '%s' "$text" | grep -Eq '^[A-Za-z0-9_:+/@=.,-]+$'; then
    return 0
  fi

  return 1
}

strip_wrapping_quotes() {
  local value="$1"

  case "$value" in
    \"*\")
      printf '%s' "${value:1:${#value}-2}"
      ;;
    \'*\')
      printf '%s' "${value:1:${#value}-2}"
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

if [ -z "$ENV_FILE" ]; then
  usage
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  fail "arquivo nao encontrado: $ENV_FILE"
  exit 1
fi

declare -A seen_vars=()
previous_secret_var=""
line_number=0

while IFS= read -r line || [ -n "$line" ]; do
  line_number=$((line_number + 1))

  trimmed="$(printf '%s' "$line" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

  if [ -z "$trimmed" ] || [ "${trimmed#\#}" != "$trimmed" ]; then
    continue
  fi

  if ! printf '%s' "$line" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*='; then
    if [ -n "$previous_secret_var" ] || looks_like_secret_fragment "$trimmed"; then
      fail "linha $line_number parece segredo quebrado em linha solta"
    else
      fail "linha $line_number invalida: esperado VAR=VALOR"
    fi
    previous_secret_var=""
    continue
  fi

  var_name="${line%%=*}"
  var_value="${line#*=}"
  var_value="$(strip_wrapping_quotes "$var_value")"
  seen_vars["$var_name"]=1

  if is_required_var "$var_name" && [ -z "$var_value" ]; then
    fail "variavel obrigatoria vazia: $var_name"
  fi

  if is_secret_var "$var_name"; then
    previous_secret_var="$var_name"
  else
    previous_secret_var=""
  fi
done < "$ENV_FILE"

for required_var in $REQUIRED_VARS; do
  if [ -z "${seen_vars[$required_var]:-}" ]; then
    fail "variavel obrigatoria ausente: $required_var"
  fi
done

if [ "$failures" -gt 0 ]; then
  printf 'Env invalido: %s problema(s) encontrado(s).\n' "$failures" >&2
  exit 1
fi

pass "env valido: variaveis obrigatorias presentes e formato VAR=VALOR"
