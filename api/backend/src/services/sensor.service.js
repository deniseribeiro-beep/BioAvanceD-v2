const { ObjectId } = require('mongodb');
const SensorModel = require('../models/Sensor');
const logger = require('../utils/logger');
const defaultQuarantineService = require('./equipment-sensor-quarantine.service');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');
const { isTransactionCapable } = require('../utils/mongoTransaction');
const { ensureSensorMetadataIndexes } = require('../utils/storageIndexes');

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
        throw new Error(validation.errors.join(', '));
      }
      await assertOrganizationIdResolves(db, sensorData.organizationId);

      const sensorsCollection = db.collection('sensors');
      const sensor = SensorModel.create(sensorData);

      const result = await sensorsCollection.insertOne(sensor);

      logger.info('Sensor criado:', { sensorId: result.insertedId });

      let metadataLinked;
      if (sensor.macAddress) {
        metadataLinked = await this.linkSensorMetadata(db, sensor.sensorId, sensor.macAddress, sensorData.storageContainer);
      }

      return {
        _id: result.insertedId,
        ...sensor,
        ...(metadataLinked !== undefined && { metadataLinked })
      };
    } catch (error) {
      logger.error('Erro ao criar sensor:', error.message);
      throw error;
    }
  }

  /**
   * Vincula (upsert) o SensorMetadata correspondente ao Sensor recém-criado,
   * incluindo o StorageContainer (RF009 AC#3 - vincular cada leitura ao
   * local de armazenamento). Sem macAddress não há SensorMetadata a criar
   * (campo obrigatório/único no schema), então o sensor básico segue criado
   * normalmente.
   *
   * Retorna true/false (nunca lança) para que o chamador possa reportar
   * a falha (ex.: macAddress duplicado) sem reverter a criação do Sensor,
   * que já foi concluída neste ponto (#313).
   */
  async linkSensorMetadata(db, sensorId, macAddress, storageContainerId) {
    try {
      const sensorMetadataCollection = db.collection('sensorMetadata');
      ensureSensorMetadataIndexes(sensorMetadataCollection);
      const set = { sensorId, macAddress, updatedAt: new Date() };
      if (storageContainerId) {
        set.storageContainer = ObjectId.isValid(storageContainerId)
          ? new ObjectId(storageContainerId)
          : storageContainerId;
      }

      await sensorMetadataCollection.updateOne(
        { sensorId },
        {
          $set: set,
          $setOnInsert: { equipment: null, device: null, temperaturePolicy: null, createdAt: new Date() }
        },
        { upsert: true }
      );
      return true;
    } catch (error) {
      logger.error('Erro ao vincular SensorMetadata:', error.message);
      return false;
    }
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
      // default limit of 50 (e2e fixtures accumulate across sessions, see
      // docker-workflow's local-env), a freshly created sensor silently
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
          : { triggered: false }
      };
    } catch (error) {
      logger.error('Erro ao atualizar sensor:', error.message);
      throw error;
    }
  }

  /**
   * Coleta leitura atual do sensor
   */
  async collectReading(db, sensorId) {
    try {
      const sensor = await this.getSensor(db, sensorId);
      if (!sensor) {
        throw new Error('Sensor não encontrado');
      }

      // Aqui você integraria com o hardware real do sensor
      // Por enquanto, retorna estrutura para leitura
      return {
        sensorId: sensor.sensorId || sensor.sensorID,
        sensorType: sensor.sensorType,
        locationId: sensor.locationId || sensor.locationID,
        policyId: sensor.policyId || sensor.policyID,
        ready: true
      };
    } catch (error) {
      logger.error('Erro ao coletar leitura:', error.message);
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

