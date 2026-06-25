#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/lovelace/proj/proj1091/deniser/bioavanced-validation/source/BioAvanceD-v2"
BACKEND_IMAGE="localhost/bioavanced_deniser_backend:latest"
FRONTEND_IMAGE="localhost/bioavanced_deniser_frontend:latest"

cd "$PROJECT_DIR"

echo "=================================================="
echo " BioAvanceD CENAPAD Startup"
echo " Date: $(date)"
echo " Project: $PROJECT_DIR"
echo "=================================================="

if [ ! -f ".env.docker" ]; then
  echo "[ERROR] .env.docker não encontrado."
  exit 1
fi

grep -q '^RESEND_API_KEY=' .env.docker \
  && sed -i 's/^RESEND_API_KEY=.*/RESEND_API_KEY=re_cenapad_mock_key/' .env.docker \
  || echo 'RESEND_API_KEY=re_cenapad_mock_key' >> .env.docker

grep -q '^EMAIL_FROM=' .env.docker \
  && sed -i 's/^EMAIL_FROM=.*/EMAIL_FROM=noreply@localhost/' .env.docker \
  || echo 'EMAIL_FROM=noreply@localhost' >> .env.docker

set -a
source .env.docker
set +a

export MONGO_DB="${MONGO_DB:-bioavanced_dev}"
export MONGO_URI="mongodb://127.0.0.1:27017/${MONGO_DB}"
export REDIS_URL="redis://127.0.0.1:6379"
export REDIS_HOST="127.0.0.1"
export REDIS_PORT="6379"
export INFLUXDB_URL="http://127.0.0.1:8086"
export INFLUXDB_ORG="${INFLUXDB_ORG:-bioavanced}"
export INFLUXDB_BUCKET="${INFLUXDB_BUCKET:-bioavanced_telemetry}"
export NEO4J_URI="bolt://127.0.0.1:7687"
export NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
export NEO4J_PASSWORD="${NEO4J_PASSWORD:-cenapad-neo4j-placeholder}"
export NEO4J_REQUIRED="${NEO4J_REQUIRED:-true}"
export LINEAGE_MODE="${LINEAGE_MODE:-strict}"
export ENABLE_CONSENT_SYNC="${ENABLE_CONSENT_SYNC:-true}"
export FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5173}"
export API_URL="${API_URL:-http://127.0.0.1:3000}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://127.0.0.1:5173,http://localhost:5173}"

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  echo "[ERROR] ENCRYPTION_KEY ausente em .env.docker."
  exit 1
fi

if [ -z "${CONSENT_SECRET:-}" ]; then
  echo "[ERROR] CONSENT_SECRET ausente em .env.docker."
  exit 1
fi

if [ -z "${INFLUXDB_INIT_PASSWORD:-}" ]; then
  echo "[ERROR] INFLUXDB_INIT_PASSWORD ausente em .env.docker."
  exit 1
fi

if [ -z "${INFLUXDB_TOKEN:-}" ]; then
  echo "[ERROR] INFLUXDB_TOKEN ausente em .env.docker."
  exit 1
fi

wait_port() {
  local port="$1"
  local name="$2"

  for i in $(seq 1 60); do
    if (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1; then
      echo "[OK] $name abriu porta $port"
      return 0
    fi
    sleep 2
  done

  echo "[ERROR] $name não abriu porta $port"
  return 1
}


# --- CENAPAD rootless Podman self-heal: begin ---
echo ""
echo "[0/7] Preparando Podman rootless no CENAPAD..."
echo "[INFO] Corrigindo estado interno do Podman rootless quando necessário."

# No CENAPAD/rootless, o processo pause do Podman pode ficar inconsistente
# após SIGKILL, NFS/overlay ou recriações sucessivas de containers.
# O próprio Podman recomenda `podman system migrate` para esse caso.
podman system migrate >/tmp/bioavanced-podman-migrate.out 2>/tmp/bioavanced-podman-migrate.err || true

# Em ambientes rootless/NFS, renumber também ajuda quando há metadados antigos
# de UID/GID/volumes no armazenamento local do usuário.
podman system renumber >/tmp/bioavanced-podman-renumber.out 2>/tmp/bioavanced-podman-renumber.err || true

if ! podman ps >/tmp/bioavanced-podman-ps.out 2>/tmp/bioavanced-podman-ps.err; then
  echo "[ERROR] Podman rootless ainda está inconsistente após migrate/renumber."
  echo "===== podman migrate stderr ====="
  cat /tmp/bioavanced-podman-migrate.err || true
  echo "===== podman renumber stderr ====="
  cat /tmp/bioavanced-podman-renumber.err || true
  echo "===== podman ps stderr ====="
  cat /tmp/bioavanced-podman-ps.err || true
  exit 1
fi

echo "[OK] Podman rootless pronto."
# --- CENAPAD rootless Podman self-heal: end ---

echo ""
echo "[1/7] Limpando containers antigos..."
for c in bioavanced-frontend bioavanced-backend bioavanced-neo4j bioavanced-influxdb bioavanced-redis bioavanced-mongodb; do
  podman rm -f "$c" 2>/dev/null || true
done

podman system renumber 2>/dev/null || true

echo ""
echo "[2/7] Subindo MongoDB sem volume persistente..."
mongo_args=(
  run -d
  --replace
  --name bioavanced-mongodb
  --network host
  --entrypoint mongod
  docker.io/library/mongo:7
  --bind_ip 127.0.0.1
  --port 27017
  --dbpath /data/db
)
podman "${mongo_args[@]}"
wait_port 27017 "MongoDB"

echo ""
echo "[3/7] Subindo Redis sem volume persistente..."
redis_args=(
  run -d
  --replace
  --name bioavanced-redis
  --network host
  --entrypoint redis-server
  docker.io/library/redis:7-alpine
  --bind 127.0.0.1
  --port 6379
  --save ""
  --appendonly no
)
podman "${redis_args[@]}"
wait_port 6379 "Redis"

echo ""
echo "[4/7] Subindo InfluxDB sem volume persistente..."
influx_args=(
  run -d
  --replace
  --name bioavanced-influxdb
  --network host
  --entrypoint influxd
  docker.io/library/influxdb:2.7
)
podman "${influx_args[@]}"
wait_port 8086 "InfluxDB"

echo ""
echo "[INFO] Configurando InfluxDB..."
if podman exec bioavanced-influxdb influx bucket list \
  --host http://127.0.0.1:8086 \
  --org "$INFLUXDB_ORG" \
  --token "$INFLUXDB_TOKEN" >/dev/null 2>&1; then
  echo "[OK] InfluxDB já configurado."
else
  podman exec bioavanced-influxdb influx setup \
    --host http://127.0.0.1:8086 \
    --username "${INFLUXDB_INIT_USERNAME:-bioavanced}" \
    --password "$INFLUXDB_INIT_PASSWORD" \
    --org "$INFLUXDB_ORG" \
    --bucket "$INFLUXDB_BUCKET" \
    --token "$INFLUXDB_TOKEN" \
    --force || true
fi

echo ""
echo "[5/7] Subindo Neo4j..."
echo "[INFO] CENAPAD workaround: bypass do entrypoint oficial para evitar chown em NFS/rootless."

# Mesmo com autenticação desativada no Neo4j, o backend exige NEO4J_PASSWORD não vazia.
export NEO4J_URI="${NEO4J_URI:-bolt://127.0.0.1:7687}"
export NEO4J_USERNAME="${NEO4J_USERNAME:-neo4j}"
export NEO4J_PASSWORD="${NEO4J_PASSWORD:-cenapad-neo4j-placeholder}"
export NEO4J_DATABASE="${NEO4J_DATABASE:-neo4j}"
export NEO4J_REQUIRED="${NEO4J_REQUIRED:-true}"
export LINEAGE_MODE="${LINEAGE_MODE:-strict}"
export ENABLE_CONSENT_SYNC="${ENABLE_CONSENT_SYNC:-true}"

neo4j_args=(
  run -d
  --replace
  --name bioavanced-neo4j
  --network host
  --entrypoint /bin/bash
  docker.io/library/neo4j:5-community
  -lc
  'CONF=/var/lib/neo4j/conf/neo4j.conf

sed -i "/dbms.security.auth_enabled/d" "$CONF" 2>/dev/null || true
sed -i "/server.default_listen_address/d" "$CONF" 2>/dev/null || true
sed -i "/server.bolt.listen_address/d" "$CONF" 2>/dev/null || true
sed -i "/server.http.listen_address/d" "$CONF" 2>/dev/null || true

{
  echo "server.default_listen_address=127.0.0.1"
  echo "server.bolt.listen_address=127.0.0.1:7687"
  echo "server.http.listen_address=127.0.0.1:7474"
  echo "dbms.security.auth_enabled=false"
} >> "$CONF"

echo "===== neo4j.conf CENAPAD override ====="
grep -nE "auth_enabled|listen_address" "$CONF" || true
echo "======================================"

/var/lib/neo4j/bin/neo4j console'
)

podman "${neo4j_args[@]}"
wait_port 7687 "Neo4j Bolt"

if (echo > /dev/tcp/127.0.0.1/7474) >/dev/null 2>&1; then
  echo "[OK] Neo4j HTTP abriu porta 7474"
else
  echo "[WARN] Neo4j HTTP 7474 ainda não abriu; seguindo porque o backend usa Bolt 7687."
fi

echo "[INFO] Validando Neo4j sem autenticação..."
if podman exec bioavanced-neo4j cypher-shell \
    -a bolt://127.0.0.1:7687 \
    --non-interactive \
    "RETURN 1 AS ok;" >/tmp/bioavanced-neo4j-test.out 2>/tmp/bioavanced-neo4j-test.err; then
  echo "[OK] Neo4j respondeu via Bolt sem autenticação."
  cat /tmp/bioavanced-neo4j-test.out
else
  echo "[ERROR] Neo4j abriu a porta 7687, mas o cypher-shell não validou."
  echo "===== stderr ====="
  cat /tmp/bioavanced-neo4j-test.err || true
  echo "===== logs Neo4j ====="
  podman logs --tail 120 bioavanced-neo4j || true
  exit 1
fi

echo ""
echo "[6/7] Subindo backend..."
backend_args=(
  run -d
  --pull=never
  --replace
  --name bioavanced-backend
  --network host
  --env-file .env.docker
  -e "MONGO_URI=$MONGO_URI"
  -e "MONGO_DB=$MONGO_DB"
  -e "MONGO_DB_NOVO=${MONGO_DB_NOVO:-$MONGO_DB}"
  -e "REDIS_URL=$REDIS_URL"
  -e "REDIS_HOST=$REDIS_HOST"
  -e "REDIS_PORT=$REDIS_PORT"
  -e "INFLUXDB_URL=$INFLUXDB_URL"
  -e "INFLUXDB_ORG=$INFLUXDB_ORG"
  -e "INFLUXDB_BUCKET=$INFLUXDB_BUCKET"
  -e "INFLUXDB_TOKEN=$INFLUXDB_TOKEN"
  -e "NEO4J_URI=$NEO4J_URI"
  -e "NEO4J_USERNAME=$NEO4J_USERNAME"
  -e "NEO4J_PASSWORD=$NEO4J_PASSWORD"
  -e "NEO4J_REQUIRED=$NEO4J_REQUIRED"
  -e "LINEAGE_MODE=$LINEAGE_MODE"
  -e "ENABLE_CONSENT_SYNC=$ENABLE_CONSENT_SYNC"
  -e "FRONTEND_URL=$FRONTEND_URL"
  -e "API_URL=$API_URL"
  -e "ALLOWED_ORIGINS=$ALLOWED_ORIGINS"
  -e "ENCRYPTION_KEY=$ENCRYPTION_KEY"
  -e "ENCRYPTION_KEY_ID=${ENCRYPTION_KEY_ID:-cenapad-validation}"
  -e "USER_ANON_SALT=$USER_ANON_SALT"
  -e "CONSENT_SECRET=$CONSENT_SECRET"
  -e "RESEND_API_KEY=${RESEND_API_KEY:-re_cenapad_mock_key}"
  -e "EMAIL_FROM=noreply@localhost"
  "$BACKEND_IMAGE"
  npx nodemon --legacy-watch --inspect=0.0.0.0:9229 server.js
)
podman "${backend_args[@]}"
wait_port 3000 "Backend API"

echo ""
echo "[7/7] Subindo frontend..."
frontend_args=(
  run -d
  --pull=never
  --replace
  --name bioavanced-frontend
  --network host
  --env-file .env.docker
  -e "VITE_API_BASE_URL=http://127.0.0.1:3000"
  "$FRONTEND_IMAGE"
  npm run dev -- --host 0.0.0.0
)
podman "${frontend_args[@]}"
wait_port 5173 "Frontend"

echo ""
echo "=================================================="
echo " STATUS FINAL"
echo "=================================================="
podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo ""
echo "Portas abertas:"
ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true

echo ""
echo "Teste backend:"
curl -I http://127.0.0.1:3000 2>/dev/null || true

echo ""
echo "Teste frontend:"
curl -I http://127.0.0.1:5173 2>/dev/null || true

echo ""
echo ""
echo "=================================================="
echo " Verificação final obrigatória"
echo "=================================================="

REQUIRED_CONTAINERS=(
  bioavanced-mongodb
  bioavanced-redis
  bioavanced-influxdb
  bioavanced-neo4j
  bioavanced-backend
  bioavanced-frontend
)

FAILED=0

for c in "${REQUIRED_CONTAINERS[@]}"; do
  status="$(podman inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  if [ "$status" = "running" ]; then
    echo "[OK] $c running"
  else
    echo "[ERROR] $c status=$status"
    FAILED=1
  fi
done

for port in 27017 6379 8086 7687 3000 5173; do
  if (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1; then
    echo "[OK] porta $port aberta"
  else
    echo "[ERROR] porta $port fechada"
    FAILED=1
  fi
done

# A porta 7474 é útil para inspeção, mas o backend usa Bolt 7687.
if (echo > /dev/tcp/127.0.0.1/7474) >/dev/null 2>&1; then
  echo "[OK] porta 7474 aberta"
else
  echo "[WARN] porta 7474 não respondeu; seguindo porque o backend usa Bolt 7687."
fi

BASE_DIR="${BIOAVANCED_BASE_DIR:-$HOME/bioavanced-validation}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR="$BASE_DIR/evidence/$RUN_ID"
LOG_DIR="$BASE_DIR/logs/$RUN_ID"

mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"

{
  echo "BioAvanceD CENAPAD startup evidence"
  echo "Date: $(date)"
  echo "Project: $PROJECT_DIR"
  echo ""
  echo "Containers:"
  podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
  echo ""
  echo "Ports:"
  ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true
  echo ""
  echo "Backend HTTP:"
  curl -I http://127.0.0.1:3000 2>/dev/null || true
  echo ""
  echo "Frontend HTTP:"
  curl -I http://127.0.0.1:5173 2>/dev/null || true
} > "$EVIDENCE_DIR/startup-cenapad-status.txt" 2>&1

for c in "${REQUIRED_CONTAINERS[@]}"; do
  podman logs "$c" > "$LOG_DIR/${c}.log" 2>&1 || true
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "[ERROR] Startup incompleto. Evidências salvas em: $EVIDENCE_DIR"
  echo "[ERROR] Logs salvos em: $LOG_DIR"
  exit 1
fi

echo ""
echo "=================================================="
echo " BioAvanceD iniciado com sucesso no CENAPAD."
echo "=================================================="
echo " Backend:   http://127.0.0.1:3000"
echo " Frontend:  http://127.0.0.1:5173"
echo " Neo4j:     bolt://127.0.0.1:7687 | http://127.0.0.1:7474"
echo " MongoDB:   mongodb://127.0.0.1:27017/${MONGO_DB:-bioavanced_dev}"
echo " Redis:     redis://127.0.0.1:6379"
echo " InfluxDB:  http://127.0.0.1:8086"
echo " Evidence:  $EVIDENCE_DIR/startup-cenapad-status.txt"
echo " Logs:      $LOG_DIR"
