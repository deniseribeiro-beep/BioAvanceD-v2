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

async function assertOrganizationIdResolves(db, organizationId) {
  if (organizationId === undefined || organizationId === null || organizationId === '') return;
  const organization = await db.collection('organizations').findOne({ organizationId: String(organizationId) });
  if (!organization) throw createSensorValidationError(`organizationId ${organizationId} não encontrado`, 404);
}

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
      if (!validation.isValid) throw new Error(validation.errors.join(', '));
      await assertOrganizationIdResolves(db, sensorData.organizationId);

      const sensorsCollection = db.collection('sensors');
      const sensor = SensorModel.create(sensorData);
      const result = await sensorsCollection.insertOne(sensor);
      logger.info('Sensor criado:', { sensorId: result.insertedId });

      let metadataLinked;
      if (sensor.macAddress) {
        metadataLinked = await this.linkSensorMetadata(db, sensor.sensorId, sensor.macAddress, sensorData.storageContainer);
      }

      return { _id: result.insertedId, ...sensor, ...(metadataLinked !== undefined && { metadataLinked }) };
    } catch (error) {
      logger.error('Erro ao criar sensor:', error.message);
      throw error;
    }
  }

  async linkSensorMetadata(db, sensorId, macAddress, storageContainerId) {
    try {
      const sensorMetadataCollection = db.collection('sensorMetadata');
      // #941: the sensorId unique constraint is part of the correctness of
      // updateOne({sensorId}, {upsert:true}); do not race the first write
      // against an un-awaited index build.
      await ensureSensorMetadataIndexes(sensorMetadataCollection);
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

  async getSensor(db, sensorId) {
    try {
      const sensorsCollection = db.collection('sensors');
      return await sensorsCollection.findOne({ $or: [{ sensorId }, { _id: sensorId }] });
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
        query.$or = [{ locationId: { $in: locationVariants } }, { locationID: { $in: locationVariants } }];
      }
      if (filters.maintenanceStatus) query.maintenanceStatus = filters.maintenanceStatus;
      if (filters.organizationScope) applyOrganizationScopeFilter(query, filters.organizationScope, 'organizationId');

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;
      const sensors = await sensorsCollection.find(query).sort({ createdAt: -1 }).limit(limit).skip(skip).toArray();
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
      const aliasedUpdateData = { ...(updateData || {}) };
      if (aliasedUpdateData.maintenanceStatus === undefined) {
        if (aliasedUpdateData.status !== undefined) aliasedUpdateData.maintenanceStatus = aliasedUpdateData.status;
        else if (aliasedUpdateData.sensorStatus !== undefined) aliasedUpdateData.maintenanceStatus = aliasedUpdateData.sensorStatus;
      }
      if (aliasedUpdateData.locationId === undefined && aliasedUpdateData.locationID !== undefined) aliasedUpdateData.locationId = aliasedUpdateData.locationID;
      if (aliasedUpdateData.policyId === undefined && aliasedUpdateData.policyID !== undefined) aliasedUpdateData.policyId = aliasedUpdateData.policyID;

      const ALLOWED_SENSOR_UPDATE_FIELDS = [
        'sensorType', 'sensorModel', 'maintenanceStatus', 'lastCalibration',
        'nextCalibration', 'calibrationCertificate', 'locationId', 'policyId',
        'macAddress', 'organizationId'
      ];
      const normalizedUpdateData = {};
      for (const field of ALLOWED_SENSOR_UPDATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(aliasedUpdateData, field)) normalizedUpdateData[field] = aliasedUpdateData[field];
      }

      const existingSensor = await sensorsCollection.findOne(query);
      if (!existingSensor) throw new Error('Sensor não encontrado');
      normalizedUpdateData.updatedAt = new Date();
      const mergedStatus = normalizedUpdateData.maintenanceStatus ?? existingSensor.maintenanceStatus ?? existingSensor.status ?? existingSensor.sensorStatus;
      const shouldTriggerQuarantine = this.quarantineService.isQuarantineTriggerStatus(mergedStatus);
      const mongoClient = db?.client;
      const canUseTransaction = shouldTriggerQuarantine && (await isTransactionCapable(db));
      let result;
      let quarantineResult = null;

      if (canUseTransaction) {
        const session = mongoClient.startSession();
        try {
          await session.withTransaction(async () => {
            result = await sensorsCollection.updateOne(query, { $set: normalizedUpdateData }, { session });
            quarantineResult = await this.quarantineService.quarantineBySensorStatus(
              db,
              { ...existingSensor, ...normalizedUpdateData },
              mergedStatus,
              { session, updateData: normalizedUpdateData }
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
            { updateData: normalizedUpdateData }
          );
        }
      }

      if (result.matchedCount === 0) throw new Error('Sensor não encontrado');
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
          ? { triggered: true, matched: quarantineResult.matched, quarantined: quarantineResult.quarantined, movements: quarantineResult.movements, reason: quarantineResult.reason }
          : { triggered: false }
      };
    } catch (error) {
      logger.error('Erro ao atualizar sensor:', error.message);
      throw error;
    }
  }

  async collectReading(db, sensorId) {
    try {
      const sensor = await this.getSensor(db, sensorId);
      if (!sensor) throw new Error('Sensor não encontrado');
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
      const result = await sensorsCollection.deleteOne({ $or: [{ sensorId }, { _id: sensorId }] });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Erro ao deletar sensor:', error.message);
      throw error;
    }
  }
}

module.exports = new SensorService();
