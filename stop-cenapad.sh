#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

BASE_DIR="${BIOAVANCED_BASE_DIR:-$HOME/bioavanced-validation}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
EVIDENCE_DIR="$BASE_DIR/evidence/$RUN_ID"
LOG_DIR="$BASE_DIR/logs/$RUN_ID"

mkdir -p "$EVIDENCE_DIR" "$LOG_DIR"

REMOVE_CONTAINERS=true

if [ "${1:-}" = "--keep-containers" ]; then
  REMOVE_CONTAINERS=false
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'HELP'
Uso:
  ./stop-cenapad.sh

Opções:
  --keep-containers   Para os containers, mas não remove.
  --help              Mostra esta ajuda.

Comportamento padrão:
  Salva evidências/logs, para e remove os containers BioAvanceD.
  Não remove imagens, scripts, .env, evidências nem logs.
HELP
  exit 0
fi

CONTAINERS=(
  bioavanced-frontend
  bioavanced-backend
  bioavanced-neo4j
  bioavanced-influxdb
  bioavanced-redis
  bioavanced-mongodb
)

PORTS=(
  5173
  3000
  9229
  7474
  7687
  8086
  6379
  27017
)

tcp_open() {
  local port="$1"
  (echo > "/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1
}

container_exists() {
  podman inspect "$1" >/dev/null 2>&1
}

container_status() {
  podman inspect -f '{{.State.Status}}' "$1" 2>/dev/null || echo "missing"
}

echo "=================================================="
echo " BioAvanceD CENAPAD Stop"
echo " Date: $(date)"
echo " Project: $PROJECT_DIR"
echo " Evidence: $EVIDENCE_DIR"
echo " Logs: $LOG_DIR"
echo "=================================================="

echo ""
echo "[0/5] Preparando Podman rootless no CENAPAD..."

if ! podman ps >/tmp/bioavanced-stop-podman-ps.out 2>/tmp/bioavanced-stop-podman-ps.err; then
  echo "[WARN] Podman rootless inconsistente. Executando migrate/renumber..."
  podman system migrate >/tmp/bioavanced-stop-podman-migrate.out 2>/tmp/bioavanced-stop-podman-migrate.err || true
  podman system renumber >/tmp/bioavanced-stop-podman-renumber.out 2>/tmp/bioavanced-stop-podman-renumber.err || true
fi

if ! podman ps >/tmp/bioavanced-stop-podman-ps2.out 2>/tmp/bioavanced-stop-podman-ps2.err; then
  echo "[ERROR] Podman ainda inconsistente."
  cat /tmp/bioavanced-stop-podman-ps2.err || true
  exit 1
fi

echo "[OK] Podman rootless pronto."

echo ""
echo "[1/5] Registrando status antes da parada..."

{
  echo "BioAvanceD CENAPAD stop evidence"
  echo "Date: $(date)"
  echo "Project: $PROJECT_DIR"
  echo ""
  echo "Containers before stop:"
  podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
  echo ""
  echo "Ports before stop:"
  ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true
  echo ""
  echo "Backend HTTP before stop:"
  curl -I http://127.0.0.1:3000 2>/dev/null || true
  echo ""
  echo "Frontend HTTP before stop:"
  curl -I http://127.0.0.1:5173 2>/dev/null || true
} > "$EVIDENCE_DIR/stop-cenapad-before.txt" 2>&1

echo "[OK] Evidência inicial salva em: $EVIDENCE_DIR/stop-cenapad-before.txt"

echo ""
echo "[2/5] Salvando logs dos containers..."

for c in "${CONTAINERS[@]}"; do
  if container_exists "$c"; then
    echo "[INFO] Salvando logs de $c..."
    podman logs "$c" > "$LOG_DIR/${c}.log" 2>&1 || true
  else
    echo "[WARN] $c não existe; pulando logs."
  fi
done

echo "[OK] Logs salvos em: $LOG_DIR"

echo ""
echo "[3/5] Parando containers BioAvanceD..."

for c in "${CONTAINERS[@]}"; do
  if container_exists "$c"; then
    status="$(container_status "$c")"
    echo "[INFO] $c status=$status"

    if [ "$status" = "running" ]; then
      echo "[INFO] Parando $c..."
      podman stop --time 20 "$c" >/dev/null 2>&1 || true
    fi

    if [ "$REMOVE_CONTAINERS" = true ]; then
      echo "[INFO] Removendo $c..."
      podman rm -f "$c" >/dev/null 2>&1 || true
    fi
  else
    echo "[OK] $c já não existe."
  fi
done

echo ""
echo "[4/5] Verificando containers e portas após parada..."

FAILED=0

{
  echo "BioAvanceD CENAPAD stop final status"
  echo "Date: $(date)"
  echo ""
  echo "Containers after stop:"
  podman ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"
  echo ""
  echo "Ports after stop:"
  ss -ltnp 2>/dev/null | grep -E ':27017|:6379|:8086|:7474|:7687|:3000|:5173|:9229' || true
} > "$EVIDENCE_DIR/stop-cenapad-after.txt" 2>&1

for c in "${CONTAINERS[@]}"; do
  if container_exists "$c"; then
    status="$(container_status "$c")"

    if [ "$REMOVE_CONTAINERS" = true ]; then
      echo "[WARN] $c ainda existe com status=$status"
      FAILED=1
    else
      if [ "$status" = "running" ]; then
        echo "[WARN] $c ainda está running"
        FAILED=1
      else
        echo "[OK] $c parado com status=$status"
      fi
    fi
  else
    echo "[OK] $c removido"
  fi
done

for port in "${PORTS[@]}"; do
  if tcp_open "$port"; then
    echo "[WARN] porta $port ainda está aberta"
    FAILED=1
  else
    echo "[OK] porta $port fechada"
  fi
done

echo ""
echo "[5/5] Resultado final..."

if [ "$FAILED" -ne 0 ]; then
  echo "[WARN] Stop concluído com pendências."
  echo "Evidence before: $EVIDENCE_DIR/stop-cenapad-before.txt"
  echo "Evidence after:  $EVIDENCE_DIR/stop-cenapad-after.txt"
  echo "Logs:            $LOG_DIR"
  exit 1
fi

echo "=================================================="
echo " BioAvanceD parado com sucesso no CENAPAD."
echo "=================================================="
echo "Evidence before: $EVIDENCE_DIR/stop-cenapad-before.txt"
echo "Evidence after:  $EVIDENCE_DIR/stop-cenapad-after.txt"
echo "Logs:            $LOG_DIR"
