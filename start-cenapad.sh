#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/home/lovelace/proj/proj1091/deniser/bioavanced-validation/source/BioAvanceD-v2"
BASE_DIR="/home/lovelace/proj/proj1091/deniser/bioavanced-validation"

TS="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR="$BASE_DIR/evidence/$TS"
LOG_DIR="$BASE_DIR/logs/$TS"

cd "$PROJECT_DIR"

mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

section() {
  echo ""
  echo "=================================================="
  echo "$*"
  echo "=================================================="
}

save_logs() {
  log "Salvando logs dos containers..."
  podman logs --tail 500 bioavanced-mongodb   > "$LOG_DIR/mongodb-cenapad.log"   2>&1 || true
  podman logs --tail 500 bioavanced-redis     > "$LOG_DIR/redis-cenapad.log"     2>&1 || true
  podman logs --tail 500 bioavanced-influxdb  > "$LOG_DIR/influxdb-cenapad.log"  2>&1 || true
  podman logs --tail 500 bioavanced-neo4j     > "$LOG_DIR/neo4j-cenapad.log"     2>&1 || true
  podman logs --tail 800 bioavanced-backend   > "$LOG_DIR/backend-cenapad.log"   2>&1 || true
  podman logs --tail 500 bioavanced-frontend  > "$LOG_DIR/frontend-cenapad.log"  2>&1 || true
}

on_error() {
  echo ""
  echo "[ERROR] Falha na inicialização do BioAvanceD."
  echo "[INFO] Salvando diagnóstico em: $EVIDENCE_DIR"
  mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"

  {
    echo "BioAvanceD CENAPAD startup failure"
    echo "Date: $(date)"
    echo "Host: $(hostname)"
    echo ""
    echo "Containers:"
    podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" | grep bioavanced || true
    echo ""
    echo "Open ports:"
    ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true
    echo ""
    echo "Backend recent logs:"
    podman logs --tail 250 bioavanced-backend 2>&1 || true
    echo ""
    echo "Frontend recent logs:"
    podman logs --tail 250 bioavanced-frontend 2>&1 || true
    echo ""
    echo "Neo4j recent logs:"
    podman logs --tail 250 bioavanced-neo4j 2>&1 || true
  } > "$EVIDENCE_DIR/startup-failure-status.txt"

  save_logs
}
trap on_error ERR

set_env_file() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" .env.docker 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env.docker
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env.docker
  fi
}

ensure_env() {
  section "[0/8] Conferindo variáveis obrigatórias"

  if [ ! -f ".env.docker" ]; then
    echo "[ERROR] .env.docker não encontrado em $PROJECT_DIR"
    exit 1
  fi

  # Ajustes estáveis para o runtime CENAPAD.
  set_env_file NODE_ENV development
  set_env_file PORT 3000

  set_env_file MONGO_URI "mongodb://127.0.0.1:27017/bioavanced_dev?retryWrites=true&w=majority&tls=false"
  set_env_file MONGODB_URI "mongodb://127.0.0.1:27017/bioavanced_dev?retryWrites=true&w=majority&tls=false"
  set_env_file DATABASE_URL "mongodb://127.0.0.1:27017/bioavanced_dev?retryWrites=true&w=majority&tls=false"
  set_env_file MONGO_DB bioavanced_dev
  set_env_file MONGO_DB_NOVO bioavanced_dev

  set_env_file REDIS_HOST 127.0.0.1
  set_env_file REDIS_PORT 6379
  set_env_file REDIS_URL redis://127.0.0.1:6379
  set_env_file REDIS_TLS false

  set_env_file INFLUXDB_URL http://127.0.0.1:8086
  set_env_file INFLUXDB_INIT_USERNAME "${INFLUXDB_INIT_USERNAME:-bioavanced}"
  set_env_file INFLUXDB_ORG "${INFLUXDB_ORG:-bioavanced}"
  set_env_file INFLUXDB_BUCKET "${INFLUXDB_BUCKET:-bioavanced_telemetry}"

  set_env_file NEO4J_URI bolt://127.0.0.1:7687
  set_env_file NEO4J_USERNAME neo4j
  set_env_file NEO4J_PASSWORD "${NEO4J_PASSWORD:-cenapad-neo4j-placeholder}"
  set_env_file NEO4J_DATABASE neo4j
  set_env_file NEO4J_REQUIRED true
  set_env_file LINEAGE_MODE strict
  set_env_file ENABLE_CONSENT_SYNC true
  set_env_file NEO4J_CONNECT_MAX_RETRIES 12
  set_env_file NEO4J_CONNECT_INITIAL_DELAY_MS 1000
  set_env_file NEO4J_CONNECT_MAX_DELAY_MS 10000

  set_env_file MQTT_ENABLED false
  set_env_file ALLOW_CLOUD_INTEGRATIONS false

  set_env_file FRONTEND_URL http://127.0.0.1:5173
  set_env_file API_URL http://127.0.0.1:3000
  set_env_file VITE_API_URL http://127.0.0.1:3000
  set_env_file VITE_BACKEND_URL http://127.0.0.1:3000
  set_env_file EMAIL_FROM noreply@localhost

  # Valores obrigatórios para validação local, sem envio real.
  if ! grep -q '^RESEND_API_KEY=' .env.docker || grep -q '^RESEND_API_KEY=$' .env.docker; then
    set_env_file RESEND_API_KEY re_cenapad_mock_key
  fi

  if ! grep -q '^CONSENT_SECRET=' .env.docker || grep -q '^CONSENT_SECRET=$' .env.docker; then
    set_env_file CONSENT_SECRET "$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | cut -d' ' -f1)"
  fi

  if ! grep -q '^USER_ANON_SALT=' .env.docker || grep -q '^USER_ANON_SALT=$' .env.docker; then
    set_env_file USER_ANON_SALT "$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | cut -d' ' -f1)"
  fi

  if ! grep -q '^ENCRYPTION_KEY=' .env.docker || grep -q '^ENCRYPTION_KEY=$' .env.docker; then
    set_env_file ENCRYPTION_KEY "$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | cut -d' ' -f1)"
  fi

  if ! grep -q '^INFLUXDB_INIT_PASSWORD=' .env.docker || grep -q '^INFLUXDB_INIT_PASSWORD=$' .env.docker; then
    set_env_file INFLUXDB_INIT_PASSWORD "BioAvanceD_Influx_2026"
  fi

  if ! grep -q '^INFLUXDB_TOKEN=' .env.docker || grep -q '^INFLUXDB_TOKEN=$' .env.docker; then
    set_env_file INFLUXDB_TOKEN "$(openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | cut -d' ' -f1)"
  fi

  cp .env.docker .env

  set -a
  source .env.docker
  set +a

  log "[OK] Variáveis conferidas."
}

wait_port() {
  local port="$1"
  local name="$2"
  local timeout="${3:-180}"

  log "Aguardando $name abrir porta $port por até ${timeout}s..."

  for i in $(seq 1 "$timeout"); do
    if ss -ltnp 2>/dev/null | grep -qE ":${port}[[:space:]]"; then
      log "[OK] $name abriu porta $port após ${i}s."
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] $name não abriu porta $port dentro do timeout."
  return 1
}

wait_container_running() {
  local container="$1"
  local timeout="${2:-60}"

  log "Aguardando container $container ficar Up..."

  for i in $(seq 1 "$timeout"); do
    if podman ps --format "{{.Names}}" | grep -qx "$container"; then
      log "[OK] Container $container está Up."
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] Container $container não ficou Up."
  podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" | grep "$container" || true
  podman logs --tail 200 "$container" 2>&1 || true
  return 1
}

http_check_any_status() {
  local url="$1"
  local name="$2"

  log "Testando HTTP $name em $url"

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"

  if [ -n "$code" ] && [ "$code" != "000" ]; then
    log "[OK] $name respondeu HTTP $code."
    return 0
  fi

  echo "[ERROR] $name não respondeu HTTP."
  return 1
}

section "BioAvanceD CENAPAD Startup"
log "Projeto: $PROJECT_DIR"
log "Evidências: $EVIDENCE_DIR"
log "Logs: $LOG_DIR"

ensure_env

section "[1/8] Auto-reparo leve do Podman rootless"
podman system migrate 2>/dev/null || true
podman system renumber 2>/dev/null || true

section "[2/8] Limpando containers antigos"
for c in bioavanced-frontend bioavanced-backend bioavanced-neo4j bioavanced-influxdb bioavanced-redis bioavanced-mongodb; do
  podman rm -f "$c" 2>/dev/null || true
done

section "[3/8] Subindo MongoDB, Redis e InfluxDB"

log "Subindo MongoDB sem volume persistente..."
podman run -d \
  --replace \
  --name bioavanced-mongodb \
  --network host \
  --entrypoint mongod \
  docker.io/library/mongo:7 \
  --bind_ip 127.0.0.1 \
  --port 27017 \
  --dbpath /data/db

wait_container_running bioavanced-mongodb 60
wait_port 27017 MongoDB 90

log "Subindo Redis sem persistência..."
podman run -d \
  --replace \
  --name bioavanced-redis \
  --network host \
  --entrypoint redis-server \
  docker.io/library/redis:7-alpine \
  --bind 127.0.0.1 \
  --port 6379 \
  --save "" \
  --appendonly no

wait_container_running bioavanced-redis 60
wait_port 6379 Redis 60

log "Subindo InfluxDB sem volume persistente..."
podman run -d \
  --replace \
  --name bioavanced-influxdb \
  --network host \
  --entrypoint influxd \
  docker.io/library/influxdb:2.7

wait_container_running bioavanced-influxdb 60
wait_port 8086 InfluxDB 120

log "Configurando InfluxDB..."
podman exec bioavanced-influxdb influx setup \
  --host http://127.0.0.1:8086 \
  --username "${INFLUXDB_INIT_USERNAME:-bioavanced}" \
  --password "${INFLUXDB_INIT_PASSWORD}" \
  --org "${INFLUXDB_ORG:-bioavanced}" \
  --bucket "${INFLUXDB_BUCKET:-bioavanced_telemetry}" \
  --token "${INFLUXDB_TOKEN}" \
  --force >/dev/null 2>&1 || true

podman exec bioavanced-influxdb influx ping --host http://127.0.0.1:8086 >/dev/null 2>&1 || {
  echo "[ERROR] InfluxDB não respondeu ao ping após setup."
  podman logs --tail 200 bioavanced-influxdb || true
  exit 1
}
log "[OK] InfluxDB validado."

section "[4/8] Subindo Neo4j com workaround CENAPAD"

podman run -d \
  --replace \
  --name bioavanced-neo4j \
  --network host \
  --entrypoint /bin/bash \
  docker.io/library/neo4j:5-community \
  -lc '
    set -e
    CONF="/var/lib/neo4j/conf/neo4j.conf"

    sed -i "/server.default_listen_address=/d" "$CONF" 2>/dev/null || true
    sed -i "/server.bolt.listen_address=/d" "$CONF" 2>/dev/null || true
    sed -i "/server.http.listen_address=/d" "$CONF" 2>/dev/null || true
    sed -i "/dbms.security.auth_enabled=/d" "$CONF" 2>/dev/null || true
    sed -i "/dbms.security.auth__enabled=/d" "$CONF" 2>/dev/null || true

    echo "server.default_listen_address=127.0.0.1" >> "$CONF"
    echo "server.bolt.listen_address=127.0.0.1:7687" >> "$CONF"
    echo "server.http.listen_address=127.0.0.1:7474" >> "$CONF"
    echo "dbms.security.auth_enabled=false" >> "$CONF"

    exec /var/lib/neo4j/bin/neo4j console
  '

wait_container_running bioavanced-neo4j 90
wait_port 7687 "Neo4j Bolt" 180
wait_port 7474 "Neo4j HTTP" 180

log "Testando Cypher..."
podman exec bioavanced-neo4j cypher-shell "RETURN 1 AS ok;" >/dev/null 2>&1 || {
  echo "[ERROR] Neo4j abriu porta, mas cypher-shell falhou."
  podman logs --tail 250 bioavanced-neo4j || true
  exit 1
}
log "[OK] Neo4j validado."

section "[5/8] Conferindo/buildando imagens backend e frontend"

if [ "${REBUILD_IMAGES:-0}" = "1" ] || ! podman image exists localhost/bioavanced_deniser_backend:latest; then
  log "Construindo imagem do backend..."
  podman build \
    -t localhost/bioavanced_deniser_backend:latest \
    -f api/backend/Dockerfile.dev \
    api/backend
else
  log "[OK] Imagem do backend já existe."
fi

if [ "${REBUILD_IMAGES:-0}" = "1" ] || ! podman image exists localhost/bioavanced_deniser_frontend:latest; then
  log "Construindo imagem do frontend..."
  podman build \
    -t localhost/bioavanced_deniser_frontend:latest \
    -f frontend/Dockerfile.dev \
    frontend
else
  log "[OK] Imagem do frontend já existe."
fi

section "[6/8] Subindo backend"

podman run -d \
  --pull=never \
  --replace \
  --name bioavanced-backend \
  --network host \
  --env-file .env.docker \
  localhost/bioavanced_deniser_backend:latest \
  npx nodemon --legacy-watch --inspect=0.0.0.0:9229 server.js

wait_container_running bioavanced-backend 90
wait_port 9229 "Backend inspect" 120
wait_port 3000 "Backend API" 240

log "Validando resposta HTTP do backend. HTTP 404 na raiz é esperado."
http_check_any_status http://127.0.0.1:3000 "Backend/API"

section "[7/8] Subindo frontend"

podman run -d \
  --pull=never \
  --replace \
  --name bioavanced-frontend \
  --network host \
  --env-file .env.docker \
  localhost/bioavanced_deniser_frontend:latest \
  npm run dev -- --host 0.0.0.0

wait_container_running bioavanced-frontend 90
wait_port 5173 "Frontend/Vite" 180

log "Validando resposta HTTP do frontend."
http_check_any_status http://127.0.0.1:5173 "Frontend/Vite"

section "[8/8] Salvando evidências finais"

{
  echo "BioAvanceD CENAPAD startup status"
  echo "Date: $(date)"
  echo "Host: $(hostname)"
  echo "Project: $PROJECT_DIR"
  echo "Branch:"
  git branch --show-current 2>/dev/null || true
  echo ""
  echo "Git commit:"
  git rev-parse --short HEAD 2>/dev/null || true
  echo ""
  echo "Containers:"
  podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" | grep bioavanced || true
  echo ""
  echo "Open ports:"
  ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true
  echo ""
  echo "Backend HTTP root:"
  curl -I http://127.0.0.1:3000 2>&1 || true
  echo ""
  echo "Frontend HTTP root:"
  curl -I http://127.0.0.1:5173 2>&1 || true
  echo ""
  echo "Neo4j nodes:"
  podman exec bioavanced-neo4j cypher-shell "MATCH (n) RETURN labels(n) AS labels, count(n) AS total ORDER BY total DESC LIMIT 20;" 2>&1 || true
  echo ""
  echo "Neo4j relationships:"
  podman exec bioavanced-neo4j cypher-shell "MATCH ()-[r]->() RETURN type(r) AS relationship, count(r) AS total ORDER BY total DESC LIMIT 20;" 2>&1 || true
  echo ""
  echo "Backend key markers:"
  podman logs --tail 500 bioavanced-backend 2>&1 | grep -E "MongoDB Connected|NEO4J|API rodando|WS ativo|Redis conectado|InfluxDB|Consentimento Mongo" || true
  echo ""
  echo "Frontend key markers:"
  podman logs --tail 300 bioavanced-frontend 2>&1 || true
} > "$EVIDENCE_DIR/startup-cenapad-status.txt"

save_logs

section "BioAvanceD iniciado com sucesso"

podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" | grep bioavanced || true

echo ""
echo "Portas abertas:"
ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true

echo ""
echo "Backend:  http://127.0.0.1:3000"
echo "Frontend: http://127.0.0.1:5173"
echo "Neo4j:    bolt://127.0.0.1:7687 | http://127.0.0.1:7474"
echo ""
echo "Evidência:"
echo "$EVIDENCE_DIR/startup-cenapad-status.txt"
echo ""
echo "Logs:"
echo "$LOG_DIR"
echo ""
echo "Para túnel SSH no Windows:"
echo "ssh -p 31459 -N -L 5173:lovelace:5173 -L 3000:lovelace:3000 deniser@cenapad.unicamp.br"
