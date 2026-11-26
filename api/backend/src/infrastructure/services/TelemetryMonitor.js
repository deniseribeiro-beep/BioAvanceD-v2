const cron = require('node-cron');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { getCollection } = require('../../utils/collectionResolver');
const { ensureStorageContainerIndexes, ensureStorageBoxIndexes } = require('../../utils/storageIndexes');
const {
  connectInfluxDB,
  getInfluxQueryApi,
  getInfluxConfig
} = require('../database/influxdb/connection');
const { CURRENT_REVISION_FLUX } = require('../persistence/influxdb/telemetryRevisions');
const EnvironmentalExcursionModel = require('../../models/EnvironmentalExcursion');
const { quarantineByColdChainIncident } = require('../../services/equipment-sensor-quarantine.service');
const { currentDatastreamsBySensor, datastreamEquipmentIdsBySensor, policiesByProfileId, freezerContainerIdOf } = require('../../services/sensorDatastream.service');
const { GraphProjectionService } = require('../../services/graphProjection.service');
const { withTransactionWhereSupported } = require('../../utils/mongoTransaction');

// #688: TemperaturePolicy.schema.js's minimumDuration is in MINUTES (see
// that file's field comment), while criticalDurationHours below is in
// HOURS -- this constant makes every conversion between the two an
// explicit, named multiplication/division instead of a bare * 60 / 60.
const MINUTES_PER_HOUR = 60;

/**
 * Monitor de Telemetria (InfluxDB -> outbox -> Neo4j)
 *
 * Se a temperatura ficar acima do limite crítico (ex.: -80°C) por > N horas,
 * registra no outbox o comprometimento da amostra raiz, que a projeção
 * propaga para os descendentes no grafo (#1312).
 *
 * RF009 AC1 (#1317): as leituras vêm das duas measurements do InfluxDB,
 * `temperature` (campo `value`, POST /api/iot/telemetry) e
 * `freezer_temperature` (campo `temperatureValue`, rota de temperatura, MQTT
 * e fila IoT), com Celsius calculado no Flux para o filtro crítico.
 */
class TelemetryMonitor {
  constructor(options = {}) {
    this.db = options.db;
    this.graphProjection = options.graphProjection || new GraphProjectionService();
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

    const criticalFreezers = await this.findCriticalFreezers();
    if (criticalFreezers.length === 0) {
      return;
    }
    for (const critical of criticalFreezers) {
      await this.propagateCompromise({
        rootSampleId: critical.rootSampleId,
        freezerKey: critical.freezerKey,
        breachedSince: critical.breachedSince
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
  // reading for longer than its excursion threshold. The Flux filter below
  // only returns above-threshold points, so a dip back into range simply
  // stops appearing as rows — we detect that by walking each sensor's
  // points newest-first and stopping at the first gap larger than
  // expectedReadingIntervalMinutes (same missing-reading tolerance
  // findSensorsWithMissingReadings uses), which marks where the current
  // above-threshold streak actually began.
  //
  // RF009 AC1 (#1317): both reading measurements are read, `temperature`
  // (field `value`) and `freezer_temperature` (field `temperatureValue`).
  // criticalTemp is Celsius, so the map() converts a `freezer_temperature`
  // point by its `temperatureUnit` tag ('°F', 'K', else Celsius) into
  // `_value` before the threshold filter; a `temperature` point has no unit
  // tag and stays as it is. Everything below `_value` is therefore Celsius.
  // #1518 (RNF025 C8): only the current revision of each reading is read
  // (CURRENT_REVISION_FLUX), so a corrected reading's original is no breach.
  //
  // #688: the excursion threshold itself is per-sensor now -- each sensor's
  // bound TemperaturePolicy.minimumDuration (minutes) governs when present
  // and positive; criticalDurationHours (converted to minutes) is the
  // fallback, which keeps every policy still carrying the seeded
  // `minimumDuration: null` default behaving exactly as before.
  async findCriticalFreezers() {
    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const fluxQuery = `from(bucket: \"${getInfluxConfig().bucket}\")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => (r._measurement == \"freezer_temperature\" and r._field == \"temperatureValue\") or (r._measurement == \"temperature\" and r._field == \"value\"))${CURRENT_REVISION_FLUX}
      |> map(fn: (r) => ({r with _value: if exists r.temperatureUnit and r.temperatureUnit == \"°F\" then (r._value - 32.0) * 5.0 / 9.0 else if exists r.temperatureUnit and r.temperatureUnit == \"K\" then r._value - 273.15 else r._value}))
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
    const now = Date.now();

    const durationMinutesBySensor = await this.resolveCriticalDurationMinutesBySensor(
      [...pointsBySensor.keys()]
    );

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
      const durationThresholdMs = durationMinutesBySensor.get(sensorId) * 60 * 1000;
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

  // #688: batched per-sensor excursion-duration lookup, in MINUTES. One
  // sensorMetadata query + one temperaturePolicies query for the whole
  // sensorIds batch (not one pair per sensor), matching this file's other
  // batched-lookup methods (resolveRootSamples/findSensorsWithMissingReadings).
  // A sensor falls back to the global criticalDurationHours (converted to
  // minutes) whenever it has no bound policy, the policy doesn't resolve,
  // or the policy's minimumDuration isn't a usable (positive number) value
  // -- this is what keeps the seeded `minimumDuration: null` default
  // behaving exactly as it did before #688.
  //
  // #1392: the temperature datastream valid now is read first. A sensor
  // whose datastream's thresholdProfileId names a policy takes that
  // policy's minimumDuration; every other sensor (unbound, or a profile
  // naming no policy) goes through sensorMetadata as before. The
  // usable-value rule applies to both sources.
  //
  // Guarded on `this.db` so it degrades to "every sensor gets the global
  // default" instead of throwing when findCriticalFreezers() is exercised
  // without a Mongo db wired up (production always has one by the time
  // this runs -- runCycle() already returns early otherwise).
  async resolveCriticalDurationMinutesBySensor(sensorIds) {
    const defaultMinutes = this.criticalDurationHours * MINUTES_PER_HOUR;
    const durationMinutesBySensor = new Map();

    if (!this.db || sensorIds.length === 0) {
      for (const sensorId of sensorIds) {
        durationMinutesBySensor.set(sensorId, defaultMinutes);
      }
      return durationMinutesBySensor;
    }

    const usableMinutes = (minimumDuration) => (
      typeof minimumDuration === 'number' && minimumDuration > 0 ? minimumDuration : defaultMinutes
    );

    const streams = await currentDatastreamsBySensor(this.db, sensorIds);
    const streamPolicies = await policiesByProfileId(this.db, [...streams.values()].map((stream) => stream.thresholdProfileId));
    const legacySensorIds = [];
    for (const sensorId of sensorIds) {
      const stream = streams.get(String(sensorId));
      const policy = stream?.thresholdProfileId ? streamPolicies.get(String(stream.thresholdProfileId)) : null;
      if (policy) {
        durationMinutesBySensor.set(sensorId, usableMinutes(policy.minimumDuration));
      } else {
        legacySensorIds.push(sensorId);
      }
    }
    if (legacySensorIds.length === 0) {
      return durationMinutesBySensor;
    }

    const sensors = await this.db.collection('sensorMetadata')
      .find({ sensorId: { $in: legacySensorIds } })
      .toArray();

    const policyIdBySensorId = new Map();
    for (const sensor of sensors) {
      if (sensor.temperaturePolicy) {
        policyIdBySensorId.set(sensor.sensorId, sensor.temperaturePolicy);
      }
    }

    const policyIds = [...policyIdBySensorId.values()];
    const policies = policyIds.length
      ? await this.db.collection('temperaturePolicies').find({ _id: { $in: policyIds } }).toArray()
      : [];
    const policyById = new Map(policies.map((policy) => [String(policy._id), policy]));

    for (const sensorId of legacySensorIds) {
      const policyId = policyIdBySensorId.get(sensorId);
      const policy = policyId ? policyById.get(String(policyId)) : null;
      durationMinutesBySensor.set(sensorId, usableMinutes(policy?.minimumDuration));
    }

    return durationMinutesBySensor;
  }

  // #308: freezerKey is the sensor's sensorId (see findCriticalFreezers).
  // No sample ever carries a freezerKey field directly — the real, already
  // populated link from a sensor to "which samples live in this freezer" is
  // SensorMetadata.storageContainer (the FREEZER-type StorageContainer the
  // sensor is mounted in) down through the existing storage hierarchy
  // (FREEZER -> SHELF -> RACK -> StorageBox), joined to
  // Sample.storageLocation.boxId. Raw db.collection() access here matches
  // findSensorsWithMissingReadings()'s existing pattern for sensorMetadata
  // (not in getCollection()'s canonical-name whitelist); storageContainers/
  // storageBoxes aren't in that whitelist either.
  //
  // #1392: the temperature datastream valid now is read first. When its
  // storageLocationId is a mirrored freezer's location, that freezer is
  // walked; otherwise SensorMetadata.storageContainer is, as before.
  async resolveRootSamples(freezerKey) {
    const stream = (await currentDatastreamsBySensor(this.db, [freezerKey])).get(String(freezerKey));
    let freezerContainerId = stream ? await freezerContainerIdOf(this.db, stream.storageLocationId) : null;
    if (!freezerContainerId) {
      const sensor = await this.db.collection('sensorMetadata').findOne({ sensorId: freezerKey });
      freezerContainerId = sensor?.storageContainer || null;
    }
    if (!freezerContainerId) {
      return [];
    }

    const boxIds = await this.resolveBoxIdsUnderFreezer(freezerContainerId);
    if (boxIds.length === 0) {
      return [];
    }

    const samples = await getCollection(this.db, 'samples')
      .find({ 'storageLocation.boxId': { $in: boxIds } })
      .toArray();
    return samples.map(s => s._id);
  }

  // Walks StorageContainer's FREEZER -> SHELF -> RACK chain (see
  // StorageContainer.js/StorageBox.js) to collect every StorageBox id
  // physically inside the given freezer container.
  async resolveBoxIdsUnderFreezer(freezerContainerId) {
    const containers = this.db.collection('storageContainers');
    // #1163: this walk runs per reading, the hottest reader of the parent_id
    // lookup indexes, so they are ensured here rather than only at the
    // one-time backfill that used to be their sole call site.
    ensureStorageContainerIndexes(containers);

    const shelves = await containers.find({ parent_id: freezerContainerId, containerType: 'SHELF' }).toArray();
    const shelfIds = shelves.map(s => s._id);
    if (shelfIds.length === 0) {
      return [];
    }

    const racks = await containers.find({ parent_id: { $in: shelfIds }, containerType: 'RACK' }).toArray();
    const rackIds = racks.map(r => r._id);
    if (rackIds.length === 0) {
      return [];
    }

    const boxesCollection = this.db.collection('storageBoxes');
    ensureStorageBoxIndexes(boxesCollection);
    const boxes = await boxesCollection.find({ parent_id: { $in: rackIds } }).toArray();
    return boxes.map(b => b._id);
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
  //
  // RF009 AC1 (#1317): a reading in either measurement, `temperature` or
  // `freezer_temperature`, counts. last() runs per series, and the two
  // measurements (and other tags) split one sensor into several series, so
  // the newest time per sensor is kept in JS, keyed by String(sensorId).
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
    // #1392: the excursion key is the equipmentId of the sensor's temperature
    // datastream valid now, the device's deviceId the fallback.
    const equipmentIdBySensor = await datastreamEquipmentIdsBySensor(this.db, sensors.map(s => s.sensorId));

    await connectInfluxDB();
    const queryApi = getInfluxQueryApi();
    const fluxQuery = `from(bucket: \"${getInfluxConfig().bucket}\")
      |> range(start: -${this.lookbackHours}h)
      |> filter(fn: (r) => (r._measurement == \"freezer_temperature\" and r._field == \"temperatureValue\") or (r._measurement == \"temperature\" and r._field == \"value\"))
      |> last()
      |> keep(columns: [\"sensorId\", \"_time\"])`;
    const rows = await queryApi.collectRows(fluxQuery);

    const lastReadingAtBySensor = new Map();
    for (const row of rows) {
      if (row.sensorId === undefined || row.sensorId === null || row.sensorId === '') continue;
      const readingAt = new Date(row._time);
      if (Number.isNaN(readingAt.getTime())) continue;

      const key = String(row.sensorId);
      const current = lastReadingAtBySensor.get(key);
      if (!current || readingAt.getTime() > current.getTime()) {
        lastReadingAtBySensor.set(key, readingAt);
      }
    }

    const thresholdMs = this.expectedReadingIntervalMinutes * 60 * 1000;
    const now = Date.now();
    const missing = [];
    for (const sensor of sensors) {
      const lastReadingAt = lastReadingAtBySensor.get(String(sensor.sensorId)) || null;
      const elapsedMs = lastReadingAt ? now - lastReadingAt.getTime() : Infinity;
      if (elapsedMs > thresholdMs) {
        const device = sensor.device ? deviceById.get(String(sensor.device)) : null;
        const deviceId = device?.deviceId || null;
        const equipmentId = equipmentIdBySensor.get(String(sensor.sensorId)) || deviceId;
        missing.push({ sensorId: sensor.sensorId, deviceId, equipmentId, lastReadingAt });
      }
    }
    return missing;
  }

  // Same open/widen pattern as iot.controller.js's upsertEnvironmentalExcursion,
  // scoped to excursionType 'missing_reading' so it never collides with an
  // in-flight temperature_out_of_range excursion on the same device.
  async upsertMissingReadingExcursion({ sensorId, equipmentId, lastReadingAt }) {
    const ExcursionCollection = this.db.collection('environmentalExcursions');
    const existingExcursion = await ExcursionCollection.findOne({
      equipmentId,
      excursionType: 'missing_reading',
      excursionStatus: { $in: ['open', 'under_assessment'] }
    });

    if (existingExcursion) {
      await ExcursionCollection.updateOne({ _id: existingExcursion._id }, { $set: { updatedAt: new Date() } });
    } else {
      const excursion = EnvironmentalExcursionModel.create({
        equipmentId,
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
      if (!missing.equipmentId) {
        continue;
      }
      await this.upsertMissingReadingExcursion(missing);
    }
    return missingSensors;
  }

  // AC#6 (#304), through the outbox since #1312 (RF023 AC8/AC9, RNF019 C8):
  // appends SPECIMEN_COMPROMISED for the root sample, and the projector marks
  // it and every DERIVED_FROM descendant COMPROMISED. No request or job
  // writes Neo4j directly, and the event carries the excursion (freezer and
  // start), never the temperature reading itself.
  async propagateCompromise({ rootSampleId, freezerKey, breachedSince }) {
    logger.info(`[ISO20387][TELEMETRY] Propagando comprometimento: freezer=${freezerKey}, sample=${rootSampleId}`);

    if (!rootSampleId) {
      logger.warn(`[ISO20387][TELEMETRY] Nenhuma amostra raiz resolvida para freezer=${freezerKey}; propagação ignorada`);
      return;
    }

    // #1313 (RF023 AC3, RNF019 C1): the compromise writes nothing in Mongo
    // in this call, so the event joins no aggregate write. Its own two
    // writes, the aggregate's version counter and the event, commit
    // together wherever a transaction runs, so a failed insert cannot
    // leave a version no event holds.
    await withTransactionWhereSupported(this.db, (session) => this.graphProjection.appendSpecimenCompromiseEvent(this.db, {
      specimenId: String(rootSampleId),
      freezerKey,
      breachedSince: breachedSince ? new Date(breachedSince).toISOString() : null,
      sourceService: 'telemetry-monitor',
    }, session ? { session } : {}));
    logger.info(`[ISO20387][TELEMETRY] SPECIMEN_COMPROMISED registrado no outbox para freezer=${freezerKey}`);
  }
}

module.exports = TelemetryMonitor;
