const TemperatureModel = require('../models/Temperature');
const PolicyModel = require('../models/Policy');
const logger = require('../utils/logger');
const influxTelemetryWriteRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const notificationServiceV2 = require('./NotificationService');

/**
 * Service de Temperatura
 * RF009 - Registro de Temperatura e Alertas
 */
class TemperatureService {
  async createTemperatureReading(db, temperatureData) {
    try {
      const validation = TemperatureModel.validate(temperatureData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      const temperaturesCollection = db.collection('temperatures');
      const temperature = TemperatureModel.create(temperatureData);

      // Verifica política e gera alerta se necessário
      if (temperatureData.policyId || temperatureData.policyID) {
        await this.checkPolicyAndAlert(db, temperature);
      }

      const result = await temperaturesCollection.insertOne(temperature);

      void Promise.resolve().then(() => {
        influxTelemetryWriteRepository.enqueueTemperatureReading({
          _id: result.insertedId,
          ...temperature
        });
      });

      logger.info('Leitura de temperatura registrada:', { logID: result.insertedId });

      return {
        _id: result.insertedId,
        ...temperature
      };
    } catch (error) {
      logger.error('Erro ao criar leitura de temperatura:', error.message);
      throw error;
    }
  }

  async checkPolicyAndAlert(db, temperature) {
    try {
      const policiesCollection = db.collection('policies');
      const policyId = temperature.policyId || temperature.policyID;

      if (!policyId) {
        return;
      }

      // Busca por policyId (String) ou _id
      const policy = await policiesCollection.findOne({ $or: [{ policyId }, { _id: policyId }] });

      if (!policy) {
        return;
      }

      // Usa thresholds da policy se não estiverem no temperature
      const minThreshold = temperature.minThreshold || policy.minThreshold;
      const maxThreshold = temperature.maxThreshold || policy.maxThreshold;

      const isValid = TemperatureModel.validateReading(
        temperature.temperatureValue,
        minThreshold,
        maxThreshold
      );

      if (!isValid) {
        // Gera alerta
        const alertsCollection = db.collection('alerts');
        await alertsCollection.insertOne({
          sensorId: temperature.sensorId || temperature.sensorID,
          policyId: policyId,
          temperatureValue: temperature.temperatureValue,
          threshold: {
            min: minThreshold,
            max: maxThreshold
          },
          timestamp: new Date(),
          severity: 'warning',
          status: 'active',
          createdAt: new Date()
        });

        logger.warn('Alerta de temperatura gerado:', {
          sensorId: temperature.sensorId || temperature.sensorID,
          value: temperature.temperatureValue
        });

        void notificationServiceV2.sendCriticalTempAlert(
          temperature.sampleId || temperature.sampleID || 'N/A',
          temperature.temperatureValue
        ).catch((error) => {
          logger.error('[NOTIFICATION] Falha ao disparar alerta crítico:', error.message || error);
        });
      }
    } catch (error) {
      logger.error('Erro ao verificar política:', error.message);
    }
  }

  async getTemperatureHistory(db, filters = {}) {
    try {
      const temperaturesCollection = db.collection('temperatures');
      const query = {};

      const sensorIdValue = filters.sensorId || filters.sensorID;
      if (sensorIdValue) {
        query.$or = [
          { sensorId: sensorIdValue },
          { sensorID: sensorIdValue }
        ];
      }

      if (filters.startDate || filters.endDate) {
        const dateQuery = {};
        if (filters.startDate) {
          dateQuery.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          dateQuery.$lte = new Date(filters.endDate);
        }
        
        // Busca tanto em timestamp quanto em dateTime (compatibilidade)
        if (query.$or) {
          // Se já existe $or, usa $and para combinar
          query.$and = [
            { $or: query.$or },
            { $or: [{ timestamp: dateQuery }, { dateTime: dateQuery }] }
          ];
          delete query.$or;
        } else {
          query.$or = [
            { timestamp: dateQuery },
            { dateTime: dateQuery }
          ];
        }
      }

      const limit = filters.limit || 1000;
      const skip = filters.skip || 0;

      // Tenta ordenar por timestamp, se não existir, ordena por dateTime ou _id
      let sortQuery = { timestamp: -1 };
      try {
        // Verifica se existe pelo menos um documento com timestamp
        const sample = await temperaturesCollection.findOne({ timestamp: { $exists: true } });
        if (!sample) {
          // Se não existe timestamp, tenta dateTime
          const sampleWithDateTime = await temperaturesCollection.findOne({ dateTime: { $exists: true } });
          if (sampleWithDateTime) {
            sortQuery = { dateTime: -1 };
          } else {
            // Se não existe nenhum, ordena por _id (mais recente primeiro)
            sortQuery = { _id: -1 };
          }
        }
      } catch (sortError) {
        // Em caso de erro, usa _id como fallback
        sortQuery = { _id: -1 };
      }

      const temperatures = await temperaturesCollection
        .find(query)
        .sort(sortQuery)
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await temperaturesCollection.countDocuments(query);

      return { temperatures: temperatures || [], total: total || 0, limit, skip };
    } catch (error) {
      logger.error('Erro ao buscar histórico de temperatura:', error.message);
      throw error;
    }
  }

  async getActiveAlerts(db) {
    try {
      if (!db) {
        // Se o banco não está disponível, retorna array vazio
        return [];
      }
      const alertsCollection = db.collection('alerts');
      const alerts = await alertsCollection
        .find({ status: 'active' })
        .sort({ timestamp: -1 })
        .toArray();

      return alerts;
    } catch (error) {
      // Em caso de erro (ex: IoT/sensores offline), retorna array vazio
      logger.error('Erro ao buscar alertas:', error.message);
      return [];
    }
  }
}

module.exports = new TemperatureService();

