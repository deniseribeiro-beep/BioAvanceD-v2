const cron = require('node-cron');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const {
  connectInfluxDB,
  getInfluxQueryApi,
  getInfluxConfig
} = require('../database/influxdb/connection');

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
    if (!this.task) {
      return;
    }

    this.task.stop();
    this.task = null;
    logger.info('[ISO20387][TELEMETRY] Monitor parado');
  }

  async runCycle() {
    if (!this.db) {
      logger.warn('[ISO20387][TELEMETRY] Banco Mongo indisponível; ciclo ignorado');
      return;
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
      try {
        if (!this.shouldTrigger(critical.freezerKey)) {
          continue;
        }

        const rootSampleIds = await this.resolveRootSamples(critical.freezerKey);
        if (!rootSampleIds.length) {
          logger.warn(`[ISO20387][TELEMETRY] Sem amostra raiz encontrada para freezer=${critical.freezerKey}`);
          continue;
        }

        let totalImpacted = 0;
        for (const sampleId of rootSampleIds) {
          const impacted = await this.propagateCompromise({
            neo4jDriver,
            rootSampleId: sampleId,
            freezerKey: critical.freezerKey,
            breachedSince: critical.breachedSince,
            maxObservedTemp: critical.maxObservedTemp
          });
          totalImpacted += impacted;
        }

        this.lastTriggeredAt.set(critical.freezerKey, Date.now());
        logger.warn(`[ISO20387][TELEMETRY] Invalidação em cascata executada. freezer=${critical.freezerKey}, roots=${rootSampleIds.length}, nósImpactados=${totalImpacted}`);
      } catch (error) {
        logger.error(`[ISO20387][TELEMETRY] Falha ao processar freezer crítico ${critical.freezerKey}:`, error.message || error);
      }
    }
  }

  shouldTrigger(freezerKey) {
    const last = this.lastTriggeredAt.get(freezerKey);
    if (!last) {
      return true;
    }

    const elapsedMs = Date.now() - last;
    return elapsedMs >= this.triggerCooldownMinutes * 60 * 1000;
  }

  async findCriticalFreezers() {
    try {
      await connectInfluxDB();
      const queryApi = getInfluxQueryApi();
      const influx = getInfluxConfig();

      const flux = `
from(bucket: "${influx.bucket}")
  |> range(start: -${this.lookbackHours}h)
  |> filter(fn: (r) => r._measurement == "freezer_temperature")
  |> filter(fn: (r) => r._field == "temperatureValue")
  |> keep(columns: ["_time", "_value", "locationId", "sensorId"])
  |> sort(columns: ["_time"], desc: false)
      `;

      const rows = await queryApi.collectRows(flux);
      if (!rows.length) {
        return [];
      }

      const grouped = new Map();
      for (const row of rows) {
        const freezerKey = String(row.locationId || row.sensorId || '').trim();
        if (!freezerKey) {
          continue;
        }

        if (!grouped.has(freezerKey)) {
          grouped.set(freezerKey, []);
        }

        grouped.get(freezerKey).push({
          time: new Date(row._time),
          value: Number(row._value)
        });
      }

      const criticalDurationMs = this.criticalDurationHours * 60 * 60 * 1000;
      const criticalFreezers = [];

      for (const [freezerKey, points] of grouped.entries()) {
        points.sort((a, b) => a.time.getTime() - b.time.getTime());

        let streakStart = null;
        let maxObservedTemp = null;
        let breachedSince = null;

        for (const point of points) {
          if (point.value > this.criticalTemp) {
            if (!streakStart) {
              streakStart = point.time;
              maxObservedTemp = point.value;
            } else if (point.value > maxObservedTemp) {
              maxObservedTemp = point.value;
            }

            if ((point.time.getTime() - streakStart.getTime()) >= criticalDurationMs) {
              breachedSince = streakStart;
            }
          } else {
            streakStart = null;
            maxObservedTemp = null;
            breachedSince = null;
          }
        }

        if (breachedSince) {
          criticalFreezers.push({
            freezerKey,
            breachedSince,
            maxObservedTemp
          });
        }
      }

      return criticalFreezers;
    } catch (error) {
      logger.error('[ISO20387][TELEMETRY] Falha ao consultar InfluxDB:', error.message || error);
      return [];
    }
  }

  async resolveRootSamples(freezerKey) {
    const samplesCollection = await getCollection(this.db, 'samples');
    const conditions = [{
      $or: [
        { 'storagePath.freezerId': freezerKey },
        { 'storageLocation.freezerId': freezerKey },
        { 'location.freezerId': freezerKey },
        { 'location.freezer': freezerKey },
        { locationID: freezerKey }
      ]
    }];

    if (ObjectId.isValid(freezerKey)) {
      const freezerObjId = new ObjectId(freezerKey);
      conditions.push({
        $or: [
          { 'storagePath.freezerId': freezerObjId },
          { 'storageLocation.freezerId': freezerObjId },
          { 'location.freezerId': freezerObjId },
          { locationID: freezerObjId }
        ]
      });
    }

    const docs = await samplesCollection
      .find({ $or: conditions })
      .project({ _id: 1 })
      .limit(2000)
      .toArray();

    return docs.map((doc) => String(doc._id));
  }

  async propagateCompromise({ neo4jDriver, rootSampleId, freezerKey, breachedSince, maxObservedTemp }) {
    const session = neo4jDriver.session();
    try {
      const result = await session.run(
        `
          MATCH (root:Sample {id: $rootSampleId})
          OPTIONAL MATCH (affected:Sample)-[:DERIVED_FROM*0..]->(root)
          WITH collect(DISTINCT affected) AS impacted
          UNWIND impacted AS sample
          SET sample.status = 'COMPROMETIDA',
              sample.compromisedAt = datetime(),
              sample.compromisedReason = $reason,
              sample.compromisedBy = 'telemetry_monitor',
              sample.compromisedThreshold = $criticalTemp,
              sample.compromisedObservedTemp = $maxObservedTemp,
              sample.compromisedSince = datetime($breachedSince)
          RETURN count(DISTINCT sample) AS impactedCount
        `,
        {
          rootSampleId,
          reason: `Freezer ${freezerKey} acima de ${this.criticalTemp}°C por mais de ${this.criticalDurationHours}h`,
          criticalTemp: this.criticalTemp,
          maxObservedTemp: Number.isFinite(maxObservedTemp) ? maxObservedTemp : null,
          breachedSince: breachedSince.toISOString()
        }
      );

      return Number(result.records[0]?.get('impactedCount') || 0);
    } finally {
      await session.close();
    }
  }
}

module.exports = TelemetryMonitor;