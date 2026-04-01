const SensorModel = require('../models/Sensor');
const logger = require('../utils/logger');

/**
 * Service de Sensores
 * RF009 - Gerenciamento de Sensores
 */
class SensorService {
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
      
      updateData.updatedAt = new Date();

      const result = await sensorsCollection.updateOne(
        { $or: [{ sensorId }, { sensorID: sensorId }, { _id: sensorId }] },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        throw new Error('Sensor não encontrado');
      }

      return { success: true };
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

