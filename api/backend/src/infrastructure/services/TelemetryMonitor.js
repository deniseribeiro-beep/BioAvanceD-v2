const crypto = require('crypto');
const cron = require('node-cron');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const { withMongoTransaction } = require('../../utils/mongoTransaction');
const { GraphProjectionService } = require('../../services/graphProjection.service');
const NormalizedPhysicalStorageStore = require('../persistence/mongo/NormalizedPhysicalStorageStore');
const {
  connectInfluxDB,
  getInfluxQueryApi,
  getInfluxConfig
} = require('../database/influxdb/connection');
const EnvironmentalExcursionModel = require('../../models/EnvironmentalExcursion');
const { quarantineByColdChainIncident } = require('../../services/equipment-sensor-quarantine.service');

const MINUTES_PER_HOUR = 60;
const TELEMETRY_SUMMARY_COLLECTION = 'telemetryExposureSummaries';
const TELEMETRY_CALCULATION_VERSION = '2.0.0';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableReadingSetHash(points = []) {
  return sha256(points.map((point) => `${point.time.toISOString()}:${point.value}`).join('|'));
}

/**
 * Monitor de Telemetria v2.
 *
 * InfluxDB permanece autoridade das leituras. MongoDB recebe somente os
 * resumos canônicos de exposição e a decisão operacional; Neo4j é uma
 * projeção assíncrona alimentada exclusivamente pelo outbox RF023.
 */
class TelemetryMonitor {
  constructor(options = {}) {
    this.db = options.db;
    this.cronExpression = options.cronExpression || process.env.TELEMETRY_MONITOR_CRON || '*/5 * * * *';
    this.criticalTemp = Number(options.criticalTemp ?? process.env.TELEMETRY_CRITICAL_TEMP ?? -80);
    this.criticalDurationHours = Number(options.criticalDurationHours ?? process.env.TELEMETRY_CRITICAL_DURATION_HOURS ?? 2);
    this.lookbackHours = Number(options.lookbackHours ?? process.env.TELEMETRY_LOOKBACK_HOURS ?? Math.max(3, this.criticalDurationHours + 1));
    this.triggerCooldownMinutes = Number(options.triggerCooldownMinutes ?? process.env.TELEMETRY_TRIGGER_COOLDOWN_MINUTES ?? 30);
    this.expectedReadingIntervalMinutes = Number(
      options.expectedReadingIntervalMinutes ?? process.env.TELEMETRY_EXPECTED_READING_INTERVAL_MINUTES ?? 15
    );
    this.graphProjectionService = options.graphProjectionService || new GraphProjectionService();
    this.physicalStore = options.physicalStore || (this.db ? new NormalizedPhysicalStorageStore(this.db) : null);
    this.task = null;
    this.lastTriggeredAt = new Map();
  }

  start() {
    if (this.task) return;
    const timezone = process.env.TZ || 'America/Sao_Paulo';
    this.task = cron.schedule(this.cronExpression, async () => {
      try {
        await this.runCycle();
      } catch (error) {
        logger.error('[ISO20387][TELEMETRY] Erro no ciclo do monitor:', error.message || error);
      }
    }, { timezone });
    logger.info(`[ISO20387][TELEMETRY] Monitor v2 agendado (${this.cronExpression}) limite=${this.criticalTemp}°C duração=${this.criticalDurationHours}h`);
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
      return { processed: 0 };
    }

    try {
      await this.checkMissingReadings();
    } catch (error) {
      logger.error('[ISO20387][TELEMETRY] Falha ao verificar leituras ausentes:', error.message || error);
    }

    const criticalFreezers = await this.findCriticalFreezers();
    let processed = 0;
    for (const critical of criticalFreezers) {
      if (!this.shouldTrigger(critical.freezerKey)) continue;
      const rootSampleIds = critical.rootSampleIds || (critical.rootSampleId ? [critical.rootSampleId] : []);
      for (const rootSampleId of rootSampleIds) {
        await this.propagateCompromise({ ...critical, rootSampleId });
        processed += 1;
      }

      try {
        await quarantineByColdChainIncident(this.db, { sensorKey: critical.freezerKey, status: 'open' });
      } catch (error) {
        logger.error('[ISO20387][TELEMETRY] Falha ao avaliar quarentena após excursão:', error.message || error);
      }
    }
    return { processed, criticalFreezers: criticalFreezers.length };
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
    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const queryText = `from(bucket: "${getInfluxConfig().bucket}")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => r._measurement == "temperature")
      |> filter(fn: (r) => r._field == "value")
      |> filter(fn: (r) => r._value > ${this.criticalTemp})
      |> sort(columns: ["_time"])`;
    const rows = await queryApi.collectRows(queryText);

    const pointsBySensor = new Map();
    for (const row of rows) {
      if (!row.sensorId) continue;
      if (!pointsBySensor.has(row.sensorId)) pointsBySensor.set(row.sensorId, []);
      pointsBySensor.get(row.sensorId).push({ time: new Date(row._time), value: Number(row._value) });
    }

    const gapThresholdMs = this.expectedReadingIntervalMinutes * 60 * 1000;
    const now = Date.now();
    const durationMinutesBySensor = await this.resolveCriticalDurationMinutesBySensor([...pointsBySensor.keys()]);
    const criticalFreezers = [];

    for (const [sensorId, points] of pointsBySensor) {
      points.sort((a, b) => a.time - b.time);
      if (!points.length) continue;

      let streakStartIndex = points.length - 1;
      for (let i = points.length - 1; i > 0; i -= 1) {
        const gapMs = points[i].time.getTime() - points[i - 1].time.getTime();
        if (gapMs > gapThresholdMs) break;
        streakStartIndex = i - 1;
      }

      const streak = points.slice(streakStartIndex);
      const breachedSince = streak[0].time;
      const windowEnd = streak[streak.length - 1].time;
      const durationThresholdMs = durationMinutesBySensor.get(sensorId) * 60 * 1000;
      if (now - breachedSince.getTime() < durationThresholdMs) continue;

      const values = streak.map((point) => point.value);
      const minimumValue = Math.min(...values);
      const maximumValue = Math.max(...values);
      const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
      const timeOutsideThresholdSeconds = Math.max(0, Math.round((windowEnd.getTime() - breachedSince.getTime()) / 1000));
      const expectedCount = Math.max(1, Math.floor(timeOutsideThresholdSeconds / (this.expectedReadingIntervalMinutes * 60)) + 1);
      const coverageRatio = Math.min(1, streak.length / expectedCount);
      const rootSampleIds = await this.resolveRootSamples(sensorId);

      criticalFreezers.push({
        freezerKey: sensorId,
        rootSampleId: rootSampleIds[0] || null,
        rootSampleIds,
        breachedSince,
        windowEnd,
        minimumValue,
        maxObservedTemp: maximumValue,
        meanValue,
        observationCount: streak.length,
        timeOutsideThresholdSeconds,
        coverageRatio,
        sourceQueryHash: `sha256:${sha256(queryText)}`,
        sourceReadingSetHash: `sha256:${stableReadingSetHash(streak)}`
      });
    }

    return criticalFreezers;
  }

  async resolveCriticalDurationMinutesBySensor(sensorIds) {
    const defaultMinutes = this.criticalDurationHours * MINUTES_PER_HOUR;
    const durationMinutesBySensor = new Map();

    if (!this.db || sensorIds.length === 0) {
      for (const sensorId of sensorIds) durationMinutesBySensor.set(sensorId, defaultMinutes);
      return durationMinutesBySensor;
    }

    const sensors = await this.db.collection('sensorMetadata').find({ sensorId: { $in: sensorIds } }).toArray();
    const policyIdBySensorId = new Map();
    for (const sensor of sensors) {
      if (sensor.temperaturePolicy) policyIdBySensorId.set(sensor.sensorId, sensor.temperaturePolicy);
    }

    const policyIds = [...policyIdBySensorId.values()];
    const policies = policyIds.length
      ? await this.db.collection('temperaturePolicies').find({ _id: { $in: policyIds } }).toArray()
      : [];
    const policyById = new Map(policies.map((policy) => [String(policy._id), policy]));

    for (const sensorId of sensorIds) {
      const policyId = policyIdBySensorId.get(sensorId);
      const policy = policyId ? policyById.get(String(policyId)) : null;
      const minimumDuration = policy?.minimumDuration;
      durationMinutesBySensor.set(
        sensorId,
        typeof minimumDuration === 'number' && minimumDuration > 0 ? minimumDuration : defaultMinutes
      );
    }
    return durationMinutesBySensor;
  }

  /**
   * Resolve espécimes atualmente expostos ao sensor a partir da cadeia v2:
   * SensorMetadata -> StorageLocation -> RackLocationAssignment ->
   * StoragePosition -> ContainerPositionAssignment ->
   * SpecimenContainerAssignment. Nenhum campo embutido em Sample é usado.
   */
  async resolveRootSamples(freezerKey) {
    const sensor = await this.db.collection('sensorMetadata').findOne({ sensorId: freezerKey });
    if (!sensor?.storageContainer) return [];

    const storageLocationId = String(sensor.storageContainer);
    const rackAssignments = await this.db.collection('rackLocationAssignments')
      .find({ storageLocationId, removedAt: null })
      .toArray();
    const rackIds = rackAssignments.map((row) => String(row.storageRackId));
    if (!rackIds.length) return [];

    const positions = await this.db.collection('storagePositions')
      .find({ storageRackId: { $in: rackIds } })
      .toArray();
    const positionIds = positions.map((row) => row.storagePositionId);
    if (!positionIds.length) return [];

    const positionAssignments = await this.db.collection('containerPositionAssignments')
      .find({ storagePositionId: { $in: positionIds }, removedAt: null })
      .toArray();
    const containerIds = positionAssignments.map((row) => row.containerId);
    if (!containerIds.length) return [];

    const specimenAssignments = await this.db.collection('specimenContainerAssignments')
      .find({ containerId: { $in: containerIds }, releasedAt: null })
      .toArray();
    return [...new Set(specimenAssignments.map((row) => String(row.specimenId)))];
  }

  async findSensorsWithMissingReadings() {
    const sensors = await this.db.collection('sensorMetadata').find({}).toArray();
    if (!sensors.length) return [];

    const deviceIds = sensors.map((sensor) => sensor.device).filter(Boolean);
    const devices = deviceIds.length
      ? await this.db.collection('devices').find({ _id: { $in: deviceIds } }).toArray()
      : [];
    const deviceById = new Map(devices.map((device) => [String(device._id), device]));

    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const fluxQuery = `from(bucket: "${getInfluxConfig().bucket}")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => r._measurement == "temperature")
      |> filter(fn: (r) => r._field == "value")
      |> group(columns: ["sensorId"])
      |> last()`;
    const rows = await queryApi.collectRows(fluxQuery);

    const lastReadingAtBySensor = new Map();
    for (const row of rows) lastReadingAtBySensor.set(row.sensorId, new Date(row._time));

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

  async upsertMissingReadingExcursion({ sensorId, deviceId, lastReadingAt }) {
    const excursionCollection = this.db.collection('environmentalExcursions');
    const existingExcursion = await excursionCollection.findOne({
      equipmentId: deviceId,
      excursionType: 'missing_reading',
      excursionStatus: { $in: ['open', 'under_assessment'] }
    });

    if (existingExcursion) {
      await excursionCollection.updateOne({ _id: existingExcursion._id }, { $set: { updatedAt: new Date() } });
    } else {
      const excursion = EnvironmentalExcursionModel.create({
        equipmentId: deviceId,
        startDateTime: lastReadingAt || new Date(),
        excursionStatus: 'open',
        excursionType: 'missing_reading',
        triggeringPolicyId: `missing_reading:${this.expectedReadingIntervalMinutes}m`,
        impactAssessment: `Sensor ${sensorId} sem leitura há mais de ${this.expectedReadingIntervalMinutes} minutos.`
      });
      await excursionCollection.insertOne(excursion);
    }

    try {
      await quarantineByColdChainIncident(this.db, { sensorKey: sensorId, status: 'open' });
    } catch (error) {
      logger.error('[ISO20387][TELEMETRY] Falha ao avaliar quarentena por leitura ausente:', error.message || error);
    }
  }

  async checkMissingReadings() {
    const missingSensors = await this.findSensorsWithMissingReadings();
    for (const missing of missingSensors) {
      if (!missing.deviceId) continue;
      await this.upsertMissingReadingExcursion(missing);
    }
    return missingSensors;
  }

  normalizeSpecimenLookupId(value) {
    if (value instanceof ObjectId) return value;
    return typeof value === 'string' && ObjectId.isValid(value) ? new ObjectId(value) : value;
  }

  async findSpecimenByAnyId(specimenId, session) {
    const samples = await getCollection(this.db, 'Specimen');
    const normalized = this.normalizeSpecimenLookupId(specimenId);
    return samples.findOne({
      $or: [
        { _id: normalized },
        { specimenId: String(specimenId) }
      ]
    }, { session });
  }

  async resolveDescendantSpecimens(rootSampleId, session) {
    const samples = await getCollection(this.db, 'Specimen');
    const root = await this.findSpecimenByAnyId(rootSampleId, session);
    if (!root) return [];

    const discovered = new Map([[String(root._id), root]]);
    const frontier = [root];
    while (frontier.length) {
      const parent = frontier.shift();
      const parentIds = [String(parent._id), parent.specimenId ? String(parent.specimenId) : null].filter(Boolean);
      const children = await samples.find(
        { parentSpecimenIds: { $in: parentIds } },
        { session }
      ).toArray();
      for (const child of children) {
        const key = String(child._id);
        if (!discovered.has(key)) {
          discovered.set(key, child);
          frontier.push(child);
        }
      }
    }
    return [...discovered.values()];
  }

  buildExposureSummary({ specimen, assignment, freezerKey, breachedSince, windowEnd, minimumValue, maxObservedTemp, meanValue, observationCount, timeOutsideThresholdSeconds, coverageRatio, sourceQueryHash, sourceReadingSetHash }) {
    const specimenId = specimen.specimenId || String(specimen._id);
    const identity = [specimenId, freezerKey, new Date(breachedSince).toISOString(), assignment?.containerPositionAssignmentId || 'unassigned'].join('|');
    return {
      telemetryExposureSummaryId: `telemetry-summary:${sha256(identity)}`,
      specimenId: String(specimenId),
      specimenContainerAssignmentId: assignment?.specimenContainerAssignmentId || null,
      containerPositionAssignmentId: assignment?.containerPositionAssignmentId || null,
      rackLocationAssignmentId: assignment?.rackLocationAssignmentId || null,
      exposurePathHash: `sha256:${sha256([
        assignment?.specimenContainerAssignmentId,
        assignment?.containerPositionAssignmentId,
        assignment?.rackLocationAssignmentId
      ].filter(Boolean).join('|'))}`,
      datastreamIds: [String(freezerKey)],
      windowStart: new Date(breachedSince),
      windowEnd: new Date(windowEnd || new Date()),
      observationCount: Number(observationCount || 0),
      minimumValue: minimumValue ?? null,
      maximumValue: maxObservedTemp ?? null,
      meanValue: meanValue ?? null,
      timeOutsideThresholdSeconds: Number(timeOutsideThresholdSeconds || 0),
      excursionCount: 1,
      coverageRatio: coverageRatio ?? null,
      sourceQueryHash: sourceQueryHash || null,
      sourceReadingSetHash: sourceReadingSetHash || null,
      calculationVersion: TELEMETRY_CALCULATION_VERSION,
      calculatedAt: new Date()
    };
  }

  /**
   * Compatibility name retained from the legacy monitor. It no longer
   * writes Neo4j or sets a non-canonical COMPROMISED status. Instead it
   * persists TelemetryExposureSummary for the root and descendants and
   * enqueues the derived graph projection in the same Mongo transaction.
   */
  async propagateCompromise(input) {
    const { rootSampleId, freezerKey } = input;
    logger.info(`[ISO20387][TELEMETRY] Registrando exposição v2: freezer=${freezerKey}, specimen=${rootSampleId}`);
    if (!rootSampleId) return { summarized: 0 };

    let summarized = 0;
    await withMongoTransaction(this.db, async (session) => {
      const specimens = await this.resolveDescendantSpecimens(rootSampleId, session);
      const collection = this.db.collection(TELEMETRY_SUMMARY_COLLECTION);

      for (const specimen of specimens) {
        const assignment = this.physicalStore
          ? await this.physicalStore.findCurrentBySpecimen(specimen._id, session)
          : null;
        const summary = this.buildExposureSummary({ specimen, assignment, ...input });
        await collection.updateOne(
          { telemetryExposureSummaryId: summary.telemetryExposureSummaryId },
          { $setOnInsert: summary },
          { upsert: true, session }
        );
        await this.graphProjectionService.appendTelemetryExposureSummaryEvent(
          this.db,
          { ...summary, sourceService: 'telemetry-monitor-v2' },
          { session }
        );
        summarized += 1;
      }
    });

    logger.info(`[ISO20387][TELEMETRY] ${summarized} resumo(s) de exposição persistidos para freezer=${freezerKey}`);
    return { summarized };
  }
}

module.exports = TelemetryMonitor;
