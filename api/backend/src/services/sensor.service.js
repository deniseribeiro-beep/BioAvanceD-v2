const { ObjectId } = require('mongodb');
const SensorModel = require('../models/Sensor');
const logger = require('../utils/logger');
const defaultQuarantineService = require('./equipment-sensor-quarantine.service');

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

      const sensorsCollection = db.collection('sensors');
      const sensor = SensorModel.create(sensorData);

      const result = await sensorsCollection.insertOne(sensor);

      logger.info('Sensor criado:', { sensorId: result.insertedId });

      if (sensor.macAddress) {
        await this.linkSensorMetadata(db, sensor.sensorId, sensor.macAddress, sensorData.storageContainer);
      }

      return {
        _id: result.insertedId,
        ...sensor
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
   */
  async linkSensorMetadata(db, sensorId, macAddress, storageContainerId) {
    try {
      const sensorMetadataCollection = db.collection('sensorMetadata');
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
    } catch (error) {
      logger.error('Erro ao vincular SensorMetadata:', error.message);
    }
  }

  async getSensor(db, sensorId) {
    try {
      const sensorsCollection = db.collection('sensors');
      const sensor = await sensorsCollection.findOne({
        $or: [
          { sensorId },
          { sensorID: sensorId },
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

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const sensors = await sensorsCollection
        .find(query)
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
      const sensorsCollection = db.collection('sensors');
      const query = { $or: [{ sensorId }, { sensorID: sensorId }, { _id: sensorId }] };
      const normalizedUpdateData = { ...(updateData || {}) };

      const existingSensor = await sensorsCollection.findOne(query);
      if (!existingSensor) {
        throw new Error('Sensor não encontrado');
      }

      normalizedUpdateData.updatedAt = new Date();

      const mergedStatus =
        normalizedUpdateData.maintenanceStatus ??
        normalizedUpdateData.status ??
        normalizedUpdateData.sensorStatus ??
        existingSensor.maintenanceStatus ??
        existingSensor.status ??
        existingSensor.sensorStatus;

      const shouldTriggerQuarantine = this.quarantineService.isQuarantineTriggerStatus(mergedStatus);
      const mongoClient = db?.client;
      const canUseTransaction = shouldTriggerQuarantine && typeof mongoClient?.startSession === 'function';
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
          { sensorID: sensorId },
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

