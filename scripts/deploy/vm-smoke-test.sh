#!/usr/bin/env bash
set -Eeuo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://34.60.170.17:5173}"
API_URL="${API_URL:-http://34.60.170.17:3000}"
LOCAL_FRONTEND_URL="${LOCAL_FRONTEND_URL:-http://localhost:5173}"
LOCAL_API_URL="${LOCAL_API_URL:-http://localhost:3000}"
CORS_ORIGIN="${CORS_ORIGIN:-http://34.60.170.17:5173}"

BACKEND_ENV_KEYS="${BACKEND_ENV_KEYS:-NODE_ENV PORT FRONTEND_URL API_URL ALLOWED_ORIGINS CORS_ALLOW_ALL TRUST_PROXY MONGO_URI MONGO_DB NEO4J_URI NEO4J_REQUIRED REDIS_URL INFLUXDB_URL MQTT_ENABLED ALLOW_CLOUD_INTEGRATIONS}"
FRONTEND_ENV_KEYS="${FRONTEND_ENV_KEYS:-VITE_API_BASE_URL VITE_HMR_HOST VITE_HMR_PROTOCOL VITE_HMR_CLIENT_PORT FRONTEND_URL API_URL}"

failures=0

section() {
  printf '\n== %s ==\n' "$1"
}

pass() {
  printf '[OK] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "comando ausente: $1"
    return 1
  fi
}

compose() {
  docker compose "$@"
}

http_code() {
  curl -sS -L -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 "$1"
}

expect_http_ok() {
  local label="$1"
  local url="$2"
  local code

  if ! code="$(http_code "$url")"; then
    fail "$label nao respondeu: $url"
    return
  fi

  case "$code" in
    2*|3*) pass "$label respondeu HTTP $code: $url" ;;
    *) fail "$label respondeu HTTP $code: $url" ;;
  esac
}

mask_env_value() {
  local key="$1"
  local value="$2"

  case "$key" in
    *SECRET*|*PASSWORD*|*TOKEN*|*KEY*|MONGO_URI|REDIS_URL)
      if [ -n "$value" ]; then
        printf '<set>'
      else
        printf '<empty>'
      fi
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

print_container_env() {
  local service="$1"
  local keys="$2"
  local output

  if ! output="$(compose exec -T "$service" sh -lc 'printenv' 2>/dev/null)"; then
    fail "nao foi possivel ler variaveis do servico $service"
    return
  fi

  for key in $keys; do
    local line value
    line="$(printf '%s\n' "$output" | grep -m 1 "^${key}=" || true)"
    value="${line#*=}"
    if [ -n "$line" ]; then
      printf '%s=%s\n' "$key" "$(mask_env_value "$key" "$value")"
    else
      fail "$service sem variavel esperada: $key"
    fi
  done
}

section "preflight"
need_command docker || true
need_command curl || true

if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose nao esta disponivel"
fi

section "docker compose ps"
if compose ps; then
  pass "docker compose ps executou"
else
  fail "docker compose ps falhou"
fi

section "frontend local"
expect_http_ok "frontend local" "$LOCAL_FRONTEND_URL"

section "backend health local"
expect_http_ok "backend health local" "$LOCAL_API_URL/api/health"

section "cors"
cors_headers="$(curl -sS -D - -o /dev/null \
  --connect-timeout 5 \
  --max-time 15 \
  -X OPTIONS \
  -H "Origin: $CORS_ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  "$LOCAL_API_URL/api/health" || true)"

if printf '%s\n' "$cors_headers" | grep -qi "^access-control-allow-origin: ${CORS_ORIGIN}\r*$"; then
  pass "CORS permite Origin $CORS_ORIGIN"
else
  fail "CORS nao retornou Access-Control-Allow-Origin para $CORS_ORIGIN"
  printf '%s\n' "$cors_headers"
fi

section "frontend publico"
expect_http_ok "frontend publico" "$FRONTEND_URL"

section "backend health publico"
expect_http_ok "backend health publico" "$API_URL/api/health"

section "variaveis backend"
print_container_env backend "$BACKEND_ENV_KEYS"

section "variaveis frontend"
print_container_env frontend "$FRONTEND_ENV_KEYS"

if [ "$failures" -gt 0 ]; then
  printf '\nSmoke test falhou com %s pendencia(s).\n' "$failures" >&2
  exit 1
fi

printf '\nSmoke test OK.\n'
