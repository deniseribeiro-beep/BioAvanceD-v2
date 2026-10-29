const { ObjectId } = require('mongodb');
const SensorModel = require('../models/Sensor');
const logger = require('../utils/logger');
const defaultQuarantineService = require('./equipment-sensor-quarantine.service');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');
const { isTransactionCapable } = require('../utils/mongoTransaction');
const { ensureSensorMetadataIndexes } = require('../utils/storageIndexes');
const TelemetryDatastreamModel = require('../models/TelemetryDatastream');
const { createDatastream, listDatastreams, endDatastreamValidity } = require('./telemetryBinding.service');
const { TEMPERATURE_PROPERTY, resolveTemperatureBinding, assertStoredSamplingPolicy } = require('./sensorDatastream.service');

// #1392: the UCUM unit of a temperature datastream, as the migration writes it.
const TEMPERATURE_UNIT = 'Cel';

function createSensorValidationError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// #634: mirrors sample.service.js's own collectionSite validation --
// when organizationId is provided, it must resolve to a real Organization.
async function assertOrganizationIdResolves(db, organizationId) {
  if (organizationId === undefined || organizationId === null || organizationId === '') {
    return;
  }
  const organization = await db.collection('organizations').findOne({ organizationId: String(organizationId) });
  if (!organization) {
    throw createSensorValidationError(`organizationId ${organizationId} não encontrado`, 404);
  }
}

/**
 * Service de Sensores
 * RF009 - Gerenciamento de Sensores
 */
class SensorService {
  constructor() {
    this.quarantineService = defaultQuarantineService;
  }

  setQuarantineService(service) {
    this.quarantineService = service || defaultQuarantineService;
  }

  async createSensor(db, sensorData) {
    try {
      const validation = SensorModel.validate(sensorData);
      if (!validation.isValid) {
        // RNF018 (#1300): a validation failure answers 422; the caller's catch
        // keeps every other error on its own status.
        const validationError = new Error(validation.errors.join(', '));
        validationError.statusCode = 422;

        validationError.details = validation.errors;
        throw validationError;
      }
      await assertOrganizationIdResolves(db, sensorData.organizationId);
      await this.assertTemperaturePolicyExists(db, sensorData.temperaturePolicy);
      const samplingPolicyId = await this.assertSamplingPolicyExists(db, sensorData.samplingPolicyId);

      const sensorsCollection = db.collection('sensors');
      const sensor = SensorModel.create(sensorData);

      const result = await sensorsCollection.insertOne(sensor);

      logger.info('Sensor criado:', { sensorId: result.insertedId });

      let metadataLinked;
      if (sensor.macAddress) {
        metadataLinked = await this.linkSensorMetadata(db, sensor.sensorId, sensor.macAddress, sensorData.storageContainer, sensorData.temperaturePolicy);
      }

      const datastream = samplingPolicyId
        ? await this.bindTemperatureDatastream(db, sensor.sensorId, samplingPolicyId, sensorData)
        : undefined;

      return {
        _id: result.insertedId,
        ...sensor,
        ...(metadataLinked !== undefined && { metadataLinked }),
        ...datastream
      };
    } catch (error) {
      logger.error('Erro ao criar sensor:', error.message);
      throw error;
    }
  }

  /**
   * Vincula (upsert) o SensorMetadata correspondente ao Sensor recém-criado,
   * incluindo o StorageContainer (RF009 AC#3 - vincular cada leitura ao
   * local de armazenamento) e, desde #1140, a TemperaturePolicy que define
   * os limites contra os quais as leituras do sensor são avaliadas.
   * Sem macAddress não há SensorMetadata a criar
   * (campo obrigatório/único no schema), então o sensor básico segue criado
   * normalmente.
   *
   * Retorna true/false (nunca lança) para que o chamador possa reportar
   * a falha (ex.: macAddress duplicado) sem reverter a criação do Sensor,
   * que já foi concluída neste ponto (#313).
   */
  async linkSensorMetadata(db, sensorId, macAddress, storageContainerId, temperaturePolicyId) {
    try {
      const sensorMetadataCollection = db.collection('sensorMetadata');
      ensureSensorMetadataIndexes(sensorMetadataCollection);
      const set = { sensorId, macAddress, updatedAt: new Date() };
      if (storageContainerId) {
        set.storageContainer = ObjectId.isValid(storageContainerId)
          ? new ObjectId(storageContainerId)
          : storageContainerId;
      }

      // #1140: this field had no writer anywhere in src/ -- it was pinned
      // null below and nothing ever set it, so the only real values in the
      // tracked tree came from the e2e fixture helper. Both live consumers
      // degraded silently: TelemetryMonitor's per-sensor minimumDuration
      // (#688) fell back to the global threshold for every sensor, and
      // iot.controller#resolveTemperaturePolicy gates its entire threshold
      // comparison on the populated value, so machine ingest checked nothing.
      //
      // Bound at registration, the same shape and the same place be435d6c
      // (#311) used for storageContainer above, on Dennis's call there.
      if (temperaturePolicyId) {
        set.temperaturePolicy = ObjectId.isValid(temperaturePolicyId)
          ? new ObjectId(temperaturePolicyId)
          : temperaturePolicyId;
      }

      // #1140: unlike storageContainer, this field ALSO has a null default
      // below, and MongoDB rejects an update naming the same field in both
      // $set and $setOnInsert (ConflictingUpdateOperators). So the default
      // has to drop out exactly when a value is supplied -- copying the
      // storageContainer pattern verbatim would have thrown on a real
      // connection while passing against a mock.
      const setOnInsert = { equipment: null, device: null, createdAt: new Date() };
      if (!set.temperaturePolicy) {
        setOnInsert.temperaturePolicy = null;
      }

      await sensorMetadataCollection.updateOne(
        { sensorId },
        {
          $set: set,
          $setOnInsert: setOnInsert
        },
        { upsert: true }
      );
      return true;
    } catch (error) {
      logger.error('Erro ao vincular SensorMetadata:', error.message);
      return false;
    }
  }

  /**
   * #1179: a temperaturePolicy reference must name a real
   * temperaturePolicies document. linkSensorMetadata used to bind any
   * string, and a dangling one makes iot.controller#resolveTemperaturePolicy
   * resolve null and check nothing -- the sensor looks governed and is not.
   * Absent/empty is not checked here: it means "no policy".
   */
  async assertTemperaturePolicyExists(db, temperaturePolicyId) {
    if (!temperaturePolicyId) return;
    const filter = ObjectId.isValid(temperaturePolicyId)
      ? { _id: new ObjectId(temperaturePolicyId) }
      : { _id: temperaturePolicyId };
    const policy = await db.collection('temperaturePolicies').findOne(filter, { projection: { _id: 1 } });
    if (!policy) {
      throw new Error(`temperaturePolicy não encontrada: ${temperaturePolicyId}`);
    }
  }

  /**
   * #1392: a samplingPolicyId (V2E-0568) must name a stored
   * ConfigurationProfile, checked before anything is written. Absent/empty
   * means "no datastream at registration": the sensor is bound by a later
   * run of the migration (docs/decisions/2026-10-21-sensor-registration-writes-datastream.md).
   */
  async assertSamplingPolicyExists(db, samplingPolicyId) {
    if (samplingPolicyId === undefined || samplingPolicyId === null || String(samplingPolicyId) === '') return null;
    try {
      return await assertStoredSamplingPolicy(db, samplingPolicyId);
    } catch (error) {
      // Only the missing profile is the caller's 422; a DB error keeps its own.
      if (error.message !== `ConfigurationProfile ${String(samplingPolicyId)} não encontrado`) throw error;
      throw createSensorValidationError(`samplingPolicyId ${samplingPolicyId} não encontrado`, 422);
    }
  }

  /**
   * #1392: writes the just-created sensor's temperature TelemetryDatastream
   * from the same freezer and policy linkSensorMetadata bound, so the
   * readers, which take the datastream first, see the registration. Never
   * throws: the sensor is already created (#313), so a binding that does not
   * resolve or cannot be written is reported, as metadataLinked is, and
   * SensorMetadata stays the readers' fallback.
   */
  async bindTemperatureDatastream(db, sensorId, samplingPolicyId, sensorData) {
    try {
      const binding = await resolveTemperatureBinding(db, {
        storageContainer: sensorData.storageContainer,
        equipment: null,
        temperaturePolicy: sensorData.temperaturePolicy
      });
      if (!binding.ok) return { datastreamBound: false, datastreamUnresolved: binding.reason };
      const stream = await createDatastream(db, {
        sensorId,
        equipmentId: binding.equipmentId,
        storageLocationId: binding.storageLocationId,
        observedProperty: TEMPERATURE_PROPERTY,
        unit: TEMPERATURE_UNIT,
        samplingPolicyId,
        thresholdProfileId: binding.thresholdProfileId,
        validityPeriod: { start: new Date() }
      });
      return { datastreamBound: true, telemetryDatastreamId: stream.telemetryDatastreamId };
    } catch (error) {
      logger.error('Erro ao vincular TelemetryDatastream:', error.message);
      return { datastreamBound: false, datastreamUnresolved: error.message };
    }
  }

  /**
   * #1392: after an edit rebinds the SensorMetadata row, the temperature
   * datastream valid now is moved onto the new binding: a datastream is
   * never rewritten in place, so it is ended at `now` and, when the new
   * binding resolves, a new one starts at `now` with the old one's sampling
   * policy and unit. A binding that no longer resolves (policy or freezer
   * cleared) only ends it, so the readers fall back to SensorMetadata, which
   * holds the edit. A sensor with no datastream gets none here. Never throws:
   * the sensors write has landed.
   */
  async rebindTemperatureDatastream(db, sensorId) {
    const outcome = { ended: false, rebound: false };
    try {
      const now = new Date();
      const current = (await listDatastreams(db, { sensorId }))
        .find((stream) => stream.observedProperty === TEMPERATURE_PROPERTY && TelemetryDatastreamModel.validAt(stream, now));
      if (!current) return outcome;

      const row = await db.collection('sensorMetadata').findOne({ sensorId });
      const binding = await resolveTemperatureBinding(db, {
        storageContainer: row?.storageContainer ?? null,
        equipment: row?.equipment ?? null,
        temperaturePolicy: row?.temperaturePolicy ?? null
      });
      if (binding.ok
        && binding.equipmentId === String(current.equipmentId)
        && binding.storageLocationId === String(current.storageLocationId)
        && binding.thresholdProfileId === String(current.thresholdProfileId)) {
        return outcome;
      }

      await endDatastreamValidity(db, current.telemetryDatastreamId, { end: now });
      outcome.ended = true;
      if (!binding.ok) {
        outcome.reason = binding.reason;
        return outcome;
      }
      await createDatastream(db, {
        sensorId,
        equipmentId: binding.equipmentId,
        storageLocationId: binding.storageLocationId,
        observedProperty: TEMPERATURE_PROPERTY,
        unit: current.unit,
        samplingPolicyId: current.samplingPolicyId,
        thresholdProfileId: binding.thresholdProfileId,
        validityPeriod: { start: now }
      });
      outcome.rebound = true;
      return outcome;
    } catch (error) {
      logger.error('Erro ao revincular TelemetryDatastream:', error.message);
      return { ...outcome, reason: error.message };
    }
  }

  /**
   * #1179: the storageContainer and temperaturePolicy bindings live on the
   * sensor's SensorMetadata row, not on `sensors`, so updateSensor used to
   * accept neither and the edit modal saved nothing for them. Returns the
   * $set for that row, or null when the caller sent neither field. Throws
   * BEFORE anything is written when the change cannot apply: no
   * SensorMetadata row (the sensor was registered without a MAC address)
   * or a policy that does not exist.
   */
  async prepareMetadataRebind(db, sensorKey, updateData) {
    const has = (field) => Object.prototype.hasOwnProperty.call(updateData || {}, field);
    const bindsSomething = has('storageContainer') || has('temperaturePolicy');
    const changesMac = has('macAddress') && Boolean(updateData.macAddress);
    if (!bindsSomething && !changesMac) return null;

    const metadataCollection = db.collection('sensorMetadata');
    const existing = await metadataCollection.findOne({ sensorId: sensorKey }, { projection: { _id: 1, macAddress: 1 } });
    if (!existing) {
      if (!bindsSomething) return null; // a MAC-only edit on a sensor with no row stays a sensors-only change
      throw new Error('Sensor sem SensorMetadata (cadastrado sem macAddress): freezer e política não podem ser vinculados');
    }

    const toRef = (value) => {
      if (!value) return null;
      return ObjectId.isValid(value) ? new ObjectId(value) : value;
    };
    const set = { updatedAt: new Date() };
    // #1179: the MAC is read off BOTH collections (equipment-sensor-quarantine's
    // buildSensorLookup), so a MAC changed on `sensors` alone left the
    // metadata row answering to the old one. The row carries a unique index
    // (sensor_metadata_macaddress_unique_v2); a collision is refused here,
    // before any write, rather than surfacing as an E11000 after the sensors
    // document has already changed.
    if (changesMac && updateData.macAddress !== existing.macAddress) {
      const clash = await metadataCollection.findOne(
        { macAddress: updateData.macAddress, sensorId: { $ne: sensorKey } },
        { projection: { _id: 1 } }
      );
      if (clash) {
        throw new Error(`macAddress já vinculado a outro sensor: ${updateData.macAddress}`);
      }
      set.macAddress = updateData.macAddress;
    }
    if (has('storageContainer')) set.storageContainer = toRef(updateData.storageContainer);
    if (has('temperaturePolicy')) {
      await this.assertTemperaturePolicyExists(db, updateData.temperaturePolicy);
      set.temperaturePolicy = toRef(updateData.temperaturePolicy);
    }
    return set;
  }

  // #917: the `{ sensorID: sensorId }` branch is gone from all three lookups
  // in this file (getSensor / updateSensor / deleteSensor). `sensorID` has
  // never been a persisted field -- `SensorModel.create` writes
  // `sensorId: data.sensorId || data.sensorID` and has since the initial
  // commit -- so the branch matched nothing this codebase ever wrote. The
  // `_id` branch stays; that one is real.
  async getSensor(db, sensorId) {
    try {
      const sensorsCollection = db.collection('sensors');
      const sensor = await sensorsCollection.findOne({
        $or: [
          { sensorId },
          { _id: sensorId }
        ]
      });
      return sensor;
    } catch (error) {
      logger.error('Erro ao buscar sensor:', error.message);
      throw error;
    }
  }

  async listSensors(db, filters = {}) {
    try {
      const sensorsCollection = db.collection('sensors');
      const query = {};

      if (filters.locationId || filters.locationID) {
        const locationFilter = filters.locationId || filters.locationID;
        const locationVariants = [...new Set([
          locationFilter,
          String(locationFilter),
          Number.isFinite(Number(locationFilter)) ? Number(locationFilter) : null
        ].filter((value) => value !== null && value !== undefined && value !== ''))];

        query.$or = [
          { locationId: { $in: locationVariants } },
          { locationID: { $in: locationVariants } }
        ];
      }

      if (filters.maintenanceStatus) {
        query.maintenanceStatus = filters.maintenanceStatus;
      }

      // #634 (F3-G09): org-scoped caller sees only sensors whose
      // organizationId is one of their scoped organizations. No-op for a
      // 'global' (Administrador) scope. Caller must resolve+attach
      // organizationScope via rbac.js's requireOrganizationScope first.
      if (filters.organizationScope) {
        applyOrganizationScopeFilter(query, filters.organizationScope, 'organizationId');
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      // #645: no sort meant Mongo's natural (insertion) order decided which
      // page-1 sensors were visible -- once the collection passed the
      // default limit of 50 (e2e fixtures accumulate across sessions in the
      // test stack's named volumes), a freshly created sensor silently
      // never appeared in the default list/UI at all, read from a real
      // Playwright run as a "flaky locator timeout" (#645) rather than the
      // deterministic pagination bug it actually is. Newest-first makes the
      // just-created record always land on page 1 regardless of backlog size.
      const sensors = await sensorsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await sensorsCollection.countDocuments(query);

      // #1179: the edit form needs each sensor's current freezer and policy,
      // which live on SensorMetadata. One batched read for the page.
      const sensorIds = sensors.map((s) => s.sensorId).filter(Boolean);
      if (sensorIds.length > 0) {
        const metadataRows = await db.collection('sensorMetadata')
          .find({ sensorId: { $in: sensorIds } }, { projection: { sensorId: 1, storageContainer: 1, temperaturePolicy: 1 } })
          .toArray();
        const bySensorId = new Map(metadataRows.map((m) => [m.sensorId, m]));
        for (const sensor of sensors) {
          const metadata = bySensorId.get(sensor.sensorId);
          if (!metadata) continue;
          if (metadata.storageContainer) sensor.storageContainer = String(metadata.storageContainer);
          if (metadata.temperaturePolicy) sensor.temperaturePolicy = String(metadata.temperaturePolicy);
        }
      }

      return { sensors, total, limit, skip };
    } catch (error) {
      logger.error('Erro ao listar sensores:', error.message);
      throw error;
    }
  }

  async updateSensor(db, sensorId, updateData) {
    try {
      await assertOrganizationIdResolves(db, updateData && updateData.organizationId);

      const sensorsCollection = db.collection('sensors');
      const query = { $or: [{ sensorId }, { _id: sensorId }] };

      // #875: normalizedUpdateData used to be an unfiltered spread of the
      // caller's updateData, reaching $set as-is on both the transaction
      // and non-transaction paths. First normalize known caller aliases
      // onto their canonical Sensor.create() field name -- maintenanceStatus
      // is the real model field; status/sensorStatus are legacy aliases the
      // quarantine trigger below still needs to recognize, so fold them in
      // only when maintenanceStatus itself is absent (same ?? precedence
      // this code already relied on). Then allowlist to Sensor.create()'s
      // own fields so unrecognized keys never reach $set. sensorId/sensorID
      // are identity and already part of the lookup query above -- excluded.
      const aliasedUpdateData = { ...(updateData || {}) };
      if (aliasedUpdateData.maintenanceStatus === undefined) {
        if (aliasedUpdateData.status !== undefined) {
          aliasedUpdateData.maintenanceStatus = aliasedUpdateData.status;
        } else if (aliasedUpdateData.sensorStatus !== undefined) {
          aliasedUpdateData.maintenanceStatus = aliasedUpdateData.sensorStatus;
        }
      }
      if (aliasedUpdateData.locationId === undefined && aliasedUpdateData.locationID !== undefined) {
        aliasedUpdateData.locationId = aliasedUpdateData.locationID;
      }
      if (aliasedUpdateData.policyId === undefined && aliasedUpdateData.policyID !== undefined) {
        aliasedUpdateData.policyId = aliasedUpdateData.policyID;
      }

      const ALLOWED_SENSOR_UPDATE_FIELDS = [
        'sensorType', 'sensorModel', 'maintenanceStatus', 'lastCalibration',
        'nextCalibration', 'calibrationCertificate', 'locationId', 'policyId',
        'macAddress', 'organizationId'
      ];
      const normalizedUpdateData = {};
      for (const field of ALLOWED_SENSOR_UPDATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(aliasedUpdateData, field)) {
          normalizedUpdateData[field] = aliasedUpdateData[field];
        }
      }

      const existingSensor = await sensorsCollection.findOne(query);
      if (!existingSensor) {
        throw new Error('Sensor não encontrado');
      }

      // #1179: prepared (and refused, if it cannot apply) before the sensors
      // write below, so a bad binding never leaves a half-applied edit.
      const metadataKey = existingSensor.sensorId || sensorId;
      const metadataSet = await this.prepareMetadataRebind(db, metadataKey, updateData);

      normalizedUpdateData.updatedAt = new Date();

      const mergedStatus =
        normalizedUpdateData.maintenanceStatus ??
        existingSensor.maintenanceStatus ??
        existingSensor.status ??
        existingSensor.sensorStatus;

      const shouldTriggerQuarantine = this.quarantineService.isQuarantineTriggerStatus(mergedStatus);
      const mongoClient = db?.client;
      const canUseTransaction = shouldTriggerQuarantine && (await isTransactionCapable(db));
      let result;
      let quarantineResult = null;

      if (canUseTransaction) {
        const session = mongoClient.startSession();

        try {
          await session.withTransaction(async () => {
            result = await sensorsCollection.updateOne(
              query,
              { $set: normalizedUpdateData },
              { session }
            );

            quarantineResult = await this.quarantineService.quarantineBySensorStatus(
              db,
              { ...existingSensor, ...normalizedUpdateData },
              mergedStatus,
              {
                session,
                updateData: normalizedUpdateData
              }
            );
          });
        } finally {
          await session.endSession();
        }
      } else {
        result = await sensorsCollection.updateOne(query, { $set: normalizedUpdateData });

        if (shouldTriggerQuarantine) {
          quarantineResult = await this.quarantineService.quarantineBySensorStatus(
            db,
            { ...existingSensor, ...normalizedUpdateData },
            mergedStatus,
            {
              updateData: normalizedUpdateData
            }
          );
        }
      }

      if (result.matchedCount === 0) {
        throw new Error('Sensor não encontrado');
      }

      let datastream;
      if (metadataSet) {
        await db.collection('sensorMetadata').updateOne({ sensorId: metadataKey }, { $set: metadataSet });
        const has = (field) => Object.prototype.hasOwnProperty.call(updateData || {}, field);
        if (has('storageContainer') || has('temperaturePolicy')) {
          datastream = await this.rebindTemperatureDatastream(db, metadataKey);
        }
      }

      if (quarantineResult && quarantineResult.triggered) {
        logger.warn('Quarentena automática aplicada após atualização de sensor', {
          sensorId: existingSensor.sensorId || existingSensor.sensorID || sensorId,
          mergedStatus,
          matched: quarantineResult.matched,
          quarantined: quarantineResult.quarantined,
          movements: quarantineResult.movements
        });
      }

      return {
        success: true,
        quarantine: quarantineResult && quarantineResult.triggered
          ? {
            triggered: true,
            matched: quarantineResult.matched,
            quarantined: quarantineResult.quarantined,
            movements: quarantineResult.movements,
            reason: quarantineResult.reason
          }
          : { triggered: false },
        ...(datastream && { datastream })
      };
    } catch (error) {
      logger.error('Erro ao atualizar sensor:', error.message);
      throw error;
    }
  }

  async deleteSensor(db, sensorId) {
    try {
      const sensorsCollection = db.collection('sensors');
      const result = await sensorsCollection.deleteOne({
        $or: [
          { sensorId },
          { _id: sensorId }
        ]
      });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar sensor:', error.message);
      throw error;
    }
  }
}

module.exports = new SensorService();

