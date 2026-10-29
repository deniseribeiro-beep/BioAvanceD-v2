require('dotenv').config();

const os = require('os');
const path = require('path');
const { createEdgeBuffer, httpSender } = require('./telemetry-edge-buffer');

const DEFAULT_ENDPOINT = 'http://localhost:3000/api/iot/telemetry';
const SENSOR_IDS = ['CRYO-001', 'CRYO-002', 'CRYO-003'];
const NORMAL_MIN_TEMP = -82;
const NORMAL_MAX_TEMP = -78;
const ANOMALY_TEMP = -60;
const INTERVAL_MS = 2000;

const endpoint = process.env.IOT_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
const anomalyProbability = Number(process.env.IOT_ANOMALY_PROBABILITY || 0.05);
// RNF004 C1 (#1392): each sensor keeps its readings in its own durable
// buffer and drains it, so a failed POST loses nothing.
const bufferRoot = process.env.IOT_EDGE_BUFFER_DIR || path.join(os.tmpdir(), 'bioavanced-iot-edge-buffer');
const buffers = new Map(SENSOR_IDS.map((sensorId) => [
  sensorId,
  createEdgeBuffer({ dir: path.join(bufferRoot, sensorId), deviceId: sensorId }),
]));
const send = httpSender({ endpoint, secret: process.env.TELEMETRY_INGEST_SECRET });

let cycleCount = 0;
let intervalHandle = null;

function randomBetween(min, max) {
  return Number((Math.random() * (max - min) + min).toFixed(2));
}

function buildReading(sensorId, forceAnomaly = false) {
  return {
    sensorId,
    temperature: forceAnomaly ? ANOMALY_TEMP : randomBetween(NORMAL_MIN_TEMP, NORMAL_MAX_TEMP),
    timestamp: new Date().toISOString(),
  };
}

async function runCycle() {
  cycleCount += 1;

  const anomalySensorIndex = (cycleCount % 10 === 0 || Math.random() < anomalyProbability)
    ? Math.floor(Math.random() * SENSOR_IDS.length)
    : -1;

  console.log(`[iot-simulator] Ciclo ${cycleCount} iniciado`);

  for (let index = 0; index < SENSOR_IDS.length; index += 1) {
    const sensorId = SENSOR_IDS[index];
    const buffer = buffers.get(sensorId);

    try {
      const entry = buffer.enqueue(buildReading(sensorId, index === anomalySensorIndex));
      const anomalyTag = index === anomalySensorIndex ? ' [ANOMALIA]' : '';
      console.log(`[iot-simulator] Leitura ${entry.sequenceNumber} do sensor ${sensorId} no buffer${anomalyTag}:`, entry.body);
      const { acked, deadLettered, retained, stoppedOn } = await buffer.drain(send);
      const stopTag = stoppedOn === null ? '' : ` | interrompido em ${stoppedOn}`;
      console.log(`[iot-simulator] Sensor ${sensorId}: ${acked} confirmada(s), ${deadLettered} recusada(s), ${retained} retida(s)${stopTag}`);
    } catch (error) {
      console.error(`[iot-simulator] Falha ao bufferizar ou enviar telemetria do sensor ${sensorId}:`, error.message || error);
    }
  }
}

function stopSimulator(signal) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  console.log(`[iot-simulator] Encerrando simulador (${signal})`);
  process.exit(0);
}

function startSimulator() {
  console.log(`[iot-simulator] Endpoint: ${endpoint}`);
  console.log(`[iot-simulator] Buffer de borda: ${bufferRoot}`);
  console.log(`[iot-simulator] Sensores: ${SENSOR_IDS.join(', ')}`);
  console.log(`[iot-simulator] Intervalo: ${INTERVAL_MS}ms | Anomalia a cada 10 ciclos ou probabilidade ${anomalyProbability}`);

  runCycle().catch((error) => {
    console.error('[iot-simulator] Falha no ciclo inicial:', error.message || error);
  });

  intervalHandle = setInterval(() => {
    runCycle().catch((error) => {
      console.error('[iot-simulator] Falha no ciclo:', error.message || error);
    });
  }, INTERVAL_MS);
}

process.on('SIGINT', () => stopSimulator('SIGINT'));
process.on('SIGTERM', () => stopSimulator('SIGTERM'));

startSimulator();
