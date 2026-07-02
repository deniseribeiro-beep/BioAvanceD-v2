#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env.docker}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT:-3000}}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:${FRONTEND_PORT:-5173}}"

failures=0

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

pass() {
  printf '[OK] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "comando ausente: $1"
    return 1
  fi
}

expect_http() {
  local label="$1"
  local url="$2"
  local code

  code="$(curl -sS -L -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 20 "$url" || true)"
  case "$code" in
    2*|3*) pass "$label respondeu HTTP $code" ;;
    *) fail "$label não respondeu corretamente em $url (HTTP ${code:-000})" ;;
  esac
}

require_command docker || true
require_command curl || true

if [ ! -f "$ENV_FILE" ]; then
  fail "arquivo de ambiente não encontrado: $ENV_FILE"
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose não está disponível"
fi

if [ "$failures" -gt 0 ]; then
  exit 1
fi

printf '\n== Docker Compose ==\n'
if compose config --quiet; then
  pass "configuração Compose válida"
else
  fail "configuração Compose inválida"
fi

if compose ps; then
  pass "docker compose ps executou"
else
  fail "docker compose ps falhou"
fi

running_services="$(compose ps --services --filter status=running 2>/dev/null || true)"
for service in mongodb neo4j influxdb redis backend frontend; do
  if printf '%s\n' "$running_services" | grep -qx "$service"; then
    pass "serviço em execução: $service"
  else
    fail "serviço não está em execução: $service"
  fi
done

printf '\n== Health checks ==\n'
expect_http "backend" "$BACKEND_URL/api/health"
expect_http "frontend" "$FRONTEND_URL"

if compose exec -T redis redis-cli ping 2>/dev/null | grep -q '^PONG$'; then
  pass "Redis respondeu PONG"
else
  fail "Redis não respondeu PONG"
fi

if compose exec -T influxdb influx ping --host http://127.0.0.1:8086 >/dev/null 2>&1; then
  pass "InfluxDB respondeu ao ping"
else
  fail "InfluxDB não respondeu ao ping"
fi

if compose exec -T neo4j cypher-shell \
  -u "${NEO4J_USERNAME:-neo4j}" \
  -p "${NEO4J_PASSWORD:-}" \
  'RETURN 1' >/dev/null 2>&1; then
  pass "Neo4j respondeu ao Cypher"
else
  fail "Neo4j não respondeu ao Cypher"
fi

if compose exec -T mongodb mongosh \
  --username "${MONGO_ROOT_USERNAME:-}" \
  --password "${MONGO_ROOT_PASSWORD:-}" \
  --authenticationDatabase admin \
  --quiet \
  --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -q '^1$'; then
  pass "MongoDB respondeu ao ping"
else
  fail "MongoDB não respondeu ao ping"
fi

if [ "$failures" -gt 0 ]; then
  printf '\nSmoke test falhou com %s pendência(s).\n' "$failures" >&2
  exit 1
fi

printf '\nSmoke test do ambiente conteinerizado concluído com sucesso.\n'
