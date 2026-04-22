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

      return {
        _id: result.insertedId,
        ...sensor
      };
    } catch (error) {
      logger.error('Erro ao criar sensor:', error.message);
      throw error;
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
        query.$or = [
          { locationId: filters.locationId || filters.locationID },
          { locationID: filters.locationId || filters.locationID }
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

      const existingSensor = await sensorsCollection.findOne(query);
      if (!existingSensor) {
        throw new Error('Sensor não encontrado');
      }

      updateData.updatedAt = new Date();

      const mergedStatus =
        updateData.maintenanceStatus ??
        updateData.status ??
        updateData.sensorStatus ??
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
              { $set: updateData },
              { session }
            );

            quarantineResult = await this.quarantineService.quarantineBySensorStatus(
              db,
              { ...existingSensor, ...updateData },
              mergedStatus,
              {
                session,
                updateData
              }
            );
          });
        } finally {
          await session.endSession();
        }
      } else {
        result = await sensorsCollection.updateOne(query, { $set: updateData });

        if (shouldTriggerQuarantine) {
          quarantineResult = await this.quarantineService.quarantineBySensorStatus(
            db,
            { ...existingSensor, ...updateData },
            mergedStatus,
            {
              updateData
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

