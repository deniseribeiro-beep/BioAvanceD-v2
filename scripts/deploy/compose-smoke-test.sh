#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env.docker}"
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

expect_http() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -sS -L -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 20 "$url" || true)"
  case "$code" in
    2*|3*) pass "$label respondeu HTTP $code" ;;
    *) fail "$label não respondeu corretamente em $url" ;;
  esac
}

for required in docker curl; do
  command -v "$required" >/dev/null 2>&1 || fail "comando ausente: $required"
done

[ -f "$ENV_FILE" ] || fail "arquivo de ambiente não encontrado: $ENV_FILE"
docker compose version >/dev/null 2>&1 || fail "Docker Compose não está disponível"
[ "$failures" -eq 0 ] || exit 1

compose config --quiet && pass "configuração Compose válida" || fail "configuração Compose inválida"

running_services="$(compose ps --services --filter status=running 2>/dev/null || true)"
for service in mongodb neo4j influxdb redis backend worker frontend; do
  if printf '%s\n' "$running_services" | grep -qx "$service"; then
    pass "serviço em execução: $service"
  else
    fail "serviço não está em execução: $service"
  fi
done

backend_binding="$(compose port backend 3000 2>/dev/null || true)"
frontend_binding="$(compose port frontend 5173 2>/dev/null || true)"
backend_port="${backend_binding##*:}"
frontend_port="${frontend_binding##*:}"

[ -n "$backend_port" ] && expect_http backend "http://127.0.0.1:${backend_port}/api/health" || fail "porta publicada do backend não encontrada"
[ -n "$frontend_port" ] && expect_http frontend "http://127.0.0.1:${frontend_port}" || fail "porta publicada do frontend não encontrada"

if compose exec -T backend npm run test:connections; then
  pass "conectividade interna validada pelo backend"
else
  fail "teste interno de conexões falhou"
fi

if [ "$failures" -gt 0 ]; then
  printf 'Smoke test falhou com %s pendência(s).\n' "$failures" >&2
  exit 1
fi

printf 'Smoke test do ambiente conteinerizado concluído com sucesso.\n'
