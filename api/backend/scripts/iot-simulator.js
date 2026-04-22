require('dotenv').config();

const DEFAULT_ENDPOINT = 'http://localhost:3000/api/iot/telemetry';
const SENSOR_IDS = ['CRYO-001', 'CRYO-002', 'CRYO-003'];
const NORMAL_MIN_TEMP = -82;
const NORMAL_MAX_TEMP = -78;
const ANOMALY_TEMP = -60;
const INTERVAL_MS = 2000;

const endpoint = process.env.IOT_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
const anomalyProbability = Number(process.env.IOT_ANOMALY_PROBABILITY || 0.05);

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

async function postTelemetry(payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ''}`);
  }
}

async function runCycle() {
  cycleCount += 1;

  const anomalySensorIndex = (cycleCount % 10 === 0 || Math.random() < anomalyProbability)
    ? Math.floor(Math.random() * SENSOR_IDS.length)
    : -1;

  console.log(`[iot-simulator] Ciclo ${cycleCount} iniciado`);

  for (let index = 0; index < SENSOR_IDS.length; index += 1) {
    const sensorId = SENSOR_IDS[index];
    const payload = buildReading(sensorId, index === anomalySensorIndex);

    try {
      await postTelemetry(payload);
      const anomalyTag = index === anomalySensorIndex ? ' [ANOMALIA]' : '';
      console.log(`[iot-simulator] POST enviado${anomalyTag}:`, payload);
    } catch (error) {
      console.error(`[iot-simulator] Falha ao enviar telemetria do sensor ${sensorId}:`, error.message || error);
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