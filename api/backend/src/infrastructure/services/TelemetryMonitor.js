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

  async findCriticalFreezers() {
    // Exemplo: consulta ao InfluxDB para encontrar freezers críticos
    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const fluxQuery = `from(bucket: \"${getInfluxConfig().bucket}\")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => r._measurement == \"temperature\")
      |> filter(fn: (r) => r._field == \"value\")
      |> filter(fn: (r) => r._value > ${this.criticalTemp})`;
    // Aqui você deve implementar a lógica para processar os resultados e identificar freezers críticos
    // Retorne um array de objetos { freezerKey, rootSampleId, breachedSince, maxObservedTemp }
    return [];
  }

  async resolveRootSamples(freezerKey) {
    // Exemplo: consulta ao MongoDB para encontrar amostras raiz
    const samples = await getCollection(this.db, 'samples').find({ freezerKey, isRoot: true }).toArray();
    return samples.map(s => s._id);
  }

  async propagateCompromise({ neo4jDriver, rootSampleId, freezerKey, breachedSince, maxObservedTemp }) {
    // Exemplo: propaga status de comprometido no grafo Neo4j
    logger.info(`[ISO20387][TELEMETRY] Propagando comprometimento: freezer=${freezerKey}, sample=${rootSampleId}`);
    // Aqui você deve implementar a lógica de atualização no Neo4j
  }
}

module.exports = TelemetryMonitor;
