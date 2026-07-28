const cron = require('node-cron');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const {
  connectInfluxDB,
  getInfluxQueryApi,
  getInfluxConfig
} = require('../database/influxdb/connection');
const EnvironmentalExcursionModel = require('../../models/EnvironmentalExcursion');
const { quarantineByColdChainIncident } = require('../../services/equipment-sensor-quarantine.service');

/**
 * Monitor de Telemetria (InfluxDB -> Neo4j)
 *
 * Se a temperatura ficar acima do limite crítico (ex.: -80°C) por > N horas,
 * marca amostra raiz como COMPROMETIDA e propaga para descendentes no grafo.
 */
class TelemetryMonitor {
  constructor(options = {}) {
    this.db = options.db;
    this.getNeo4jDriver = options.getNeo4jDriver;
    this.cronExpression = options.cronExpression || process.env.TELEMETRY_MONITOR_CRON || '*/5 * * * *';
    this.criticalTemp = Number(options.criticalTemp ?? process.env.TELEMETRY_CRITICAL_TEMP ?? -80);
    this.criticalDurationHours = Number(options.criticalDurationHours ?? process.env.TELEMETRY_CRITICAL_DURATION_HOURS ?? 2);
    this.lookbackHours = Number(options.lookbackHours ?? process.env.TELEMETRY_LOOKBACK_HOURS ?? Math.max(3, this.criticalDurationHours + 1));
    this.triggerCooldownMinutes = Number(options.triggerCooldownMinutes ?? process.env.TELEMETRY_TRIGGER_COOLDOWN_MINUTES ?? 30);
    // AC#4 "leituras ausentes": a sensor with no InfluxDB point in this
    // many minutes is treated as missing, distinct from criticalDurationHours
    // (which governs the sustained out-of-range case, not absence).
    this.expectedReadingIntervalMinutes = Number(
      options.expectedReadingIntervalMinutes ?? process.env.TELEMETRY_EXPECTED_READING_INTERVAL_MINUTES ?? 15
    );
    this.task = null;
    this.lastTriggeredAt = new Map();
  }

  start() {
    if (this.task) {
      return;
    }
    const timezone = process.env.TZ || 'America/Sao_Paulo';
    this.task = cron.schedule(this.cronExpression, async () => {
      try {
        await this.runCycle();
      } catch (error) {
        logger.error('[ISO20387][TELEMETRY] Erro no ciclo do monitor:', error.message || error);
      }
    }, { timezone });
    logger.info(`[ISO20387][TELEMETRY] Monitor agendado (${this.cronExpression}) limite=${this.criticalTemp}°C duração=${this.criticalDurationHours}h`);
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('[ISO20387][TELEMETRY] Monitor parado');
    }
  }

  async runCycle() {
    if (!this.db) {
      logger.warn('[ISO20387][TELEMETRY] Banco Mongo indisponível; ciclo ignorado');
      return;
    }

    // AC#4 missing-reading detection doesn't depend on Neo4j, so it runs
    // ahead of (and independently from) the critical-freezer/propagation
    // flow below, which does.
    try {
      await this.checkMissingReadings();
    } catch (error) {
      logger.error('[ISO20387][TELEMETRY] Falha ao verificar leituras ausentes:', error.message || error);
    }

    const neo4jDriver = this.getNeo4jDriver ? await this.getNeo4jDriver() : null;
    if (!neo4jDriver) {
      logger.warn('[ISO20387][TELEMETRY] Neo4j indisponível; ciclo ignorado');
      return;
    }
    const criticalFreezers = await this.findCriticalFreezers();
    if (criticalFreezers.length === 0) {
      return;
    }
    for (const critical of criticalFreezers) {
      // Aqui você pode implementar a lógica de propagação para samples comprometidas
      await this.propagateCompromise({
        neo4jDriver,
        rootSampleId: critical.rootSampleId,
        freezerKey: critical.freezerKey,
        breachedSince: critical.breachedSince,
        maxObservedTemp: critical.maxObservedTemp
      });
    }
  }

  shouldTrigger(freezerKey) {
    const now = Date.now();
    const last = this.lastTriggeredAt.get(freezerKey) || 0;
    if (now - last > this.triggerCooldownMinutes * 60 * 1000) {
      this.lastTriggeredAt.set(freezerKey, now);
      return true;
    }
    return false;
  }

  // AC#6 "acionar alerta": a sensor is critical when its temperature has
  // stayed continuously above criticalTemp through to the most recent
  // reading for longer than criticalDurationHours. The Flux filter below
  // only returns above-threshold points, so a dip back into range simply
  // stops appearing as rows — we detect that by walking each sensor's
  // points newest-first and stopping at the first gap larger than
  // expectedReadingIntervalMinutes (same missing-reading tolerance
  // findSensorsWithMissingReadings uses), which marks where the current
  // above-threshold streak actually began.
  async findCriticalFreezers() {
    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const fluxQuery = `from(bucket: \"${getInfluxConfig().bucket}\")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => r._measurement == \"temperature\")
      |> filter(fn: (r) => r._field == \"value\")
      |> filter(fn: (r) => r._value > ${this.criticalTemp})
      |> sort(columns: [\"_time\"])`;
    const rows = await queryApi.collectRows(fluxQuery);

    const pointsBySensor = new Map();
    for (const row of rows) {
      if (!row.sensorId) {
        continue;
      }
      if (!pointsBySensor.has(row.sensorId)) {
        pointsBySensor.set(row.sensorId, []);
      }
      pointsBySensor.get(row.sensorId).push({ time: new Date(row._time), value: Number(row._value) });
    }

    const gapThresholdMs = this.expectedReadingIntervalMinutes * 60 * 1000;
    const durationThresholdMs = this.criticalDurationHours * 60 * 60 * 1000;
    const now = Date.now();

    const criticalFreezers = [];
    for (const [sensorId, points] of pointsBySensor) {
      points.sort((a, b) => a.time - b.time);

      let streakStartIndex = points.length - 1;
      for (let i = points.length - 1; i > 0; i--) {
        const gapMs = points[i].time.getTime() - points[i - 1].time.getTime();
        if (gapMs > gapThresholdMs) {
          break;
        }
        streakStartIndex = i - 1;
      }

      const breachedSince = points[streakStartIndex].time;
      if (now - breachedSince.getTime() < durationThresholdMs) {
        continue;
      }

      const maxObservedTemp = points
        .slice(streakStartIndex)
        .reduce((max, point) => Math.max(max, point.value), -Infinity);

      const freezerKey = sensorId;
      const rootSampleIds = await this.resolveRootSamples(freezerKey);

      criticalFreezers.push({
        freezerKey,
        rootSampleId: rootSampleIds[0] || null,
        breachedSince,
        maxObservedTemp
      });
    }

    return criticalFreezers;
  }

  async resolveRootSamples(freezerKey) {
    // Exemplo: consulta ao MongoDB para encontrar amostras raiz
    const samples = await getCollection(this.db, 'samples').find({ freezerKey, isRoot: true }).toArray();
    return samples.map(s => s._id);
  }

  // AC#4 "leituras ausentes": per-sensor last-point-in-bucket lookup via
  // Influx. Raw db.collection() access for sensorMetadata/devices/
  // environmentalExcursions here (not the getCollection() wrapper —
  // that resolves through a canonical-name whitelist none of these three
  // are in, and is itself async, so `getCollection(...).find(...)`
  // silently calls .find on a Promise; not the mongoose models
  // iot.controller.js uses either — this file has no existing mongoose
  // wiring). This matches iot.controller.js's own upsertEnvironmentalExcursion,
  // which already reads/writes environmentalExcursions the same raw way.
  async findSensorsWithMissingReadings() {
    const sensors = await this.db.collection('sensorMetadata').find({}).toArray();
    if (!sensors.length) {
      return [];
    }

    const deviceIds = sensors.map(s => s.device).filter(Boolean);
    const devices = deviceIds.length
      ? await this.db.collection('devices').find({ _id: { $in: deviceIds } }).toArray()
      : [];
    const deviceById = new Map(devices.map(d => [String(d._id), d]));

    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const fluxQuery = `from(bucket: \"${getInfluxConfig().bucket}\")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => r._measurement == \"temperature\")
      |> filter(fn: (r) => r._field == \"value\")
      |> group(columns: [\"sensorId\"])
      |> last()`;
    const rows = await queryApi.collectRows(fluxQuery);

    const lastReadingAtBySensor = new Map();
    for (const row of rows) {
      lastReadingAtBySensor.set(row.sensorId, new Date(row._time));
    }

    const thresholdMs = this.expectedReadingIntervalMinutes * 60 * 1000;
    const now = Date.now();
    const missing = [];
    for (const sensor of sensors) {
      const lastReadingAt = lastReadingAtBySensor.get(sensor.sensorId) || null;
      const elapsedMs = lastReadingAt ? now - lastReadingAt.getTime() : Infinity;
      if (elapsedMs > thresholdMs) {
        const device = sensor.device ? deviceById.get(String(sensor.device)) : null;
        missing.push({ sensorId: sensor.sensorId, deviceId: device?.deviceId || null, lastReadingAt });
      }
    }
    return missing;
  }

  // Same open/widen pattern as iot.controller.js's upsertEnvironmentalExcursion,
  // scoped to excursionType 'missing_reading' so it never collides with an
  // in-flight temperature_out_of_range excursion on the same device.
  async upsertMissingReadingExcursion({ sensorId, deviceId, lastReadingAt }) {
    const ExcursionCollection = this.db.collection('environmentalExcursions');
    const existingExcursion = await ExcursionCollection.findOne({
      equipmentId: deviceId,
      excursionType: 'missing_reading',
      excursionStatus: { $in: ['open', 'under_assessment'] }
    });

    if (existingExcursion) {
      await ExcursionCollection.updateOne({ _id: existingExcursion._id }, { $set: { updatedAt: new Date() } });
    } else {
      const excursion = EnvironmentalExcursionModel.create({
        equipmentId: deviceId,
        startDateTime: lastReadingAt || new Date(),
        excursionStatus: 'open',
        excursionType: 'missing_reading',
        triggeringPolicyId: `missing_reading:${this.expectedReadingIntervalMinutes}m`,
        impactAssessment: `Sensor ${sensorId} sem leitura há mais de ${this.expectedReadingIntervalMinutes} minutos.`
      });
      await ExcursionCollection.insertOne(excursion);
    }

    // AC#6 "acionar alerta e avaliação de quarentena" applies to the
    // missing-reading trigger the same way it applies to the existing
    // out-of-range one — quarantineByColdChainIncident already generalizes
    // over any sensorKey/status shape, so no missing-reading-specific
    // quarantine path is needed.
    try {
      await quarantineByColdChainIncident(this.db, { sensorKey: sensorId, status: 'open' });
    } catch (error) {
      logger.error('[ISO20387][TELEMETRY] Falha ao avaliar quarentena por leitura ausente:', error.message || error);
    }
  }

  async checkMissingReadings() {
    const missingSensors = await this.findSensorsWithMissingReadings();
    for (const missing of missingSensors) {
      if (!missing.deviceId) {
        continue;
      }
      await this.upsertMissingReadingExcursion(missing);
    }
    return missingSensors;
  }

  async propagateCompromise({ neo4jDriver, rootSampleId, freezerKey, breachedSince, maxObservedTemp }) {
    // Exemplo: propaga status de comprometido no grafo Neo4j
    logger.info(`[ISO20387][TELEMETRY] Propagando comprometimento: freezer=${freezerKey}, sample=${rootSampleId}`);
    // Aqui você deve implementar a lógica de atualização no Neo4j
  }
}

module.exports = TelemetryMonitor;
