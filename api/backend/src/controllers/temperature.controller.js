const temperatureService = require('../services/temperature.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');

/**
 * Controller de Temperatura
 * RF009 - Registro de Temperatura e Alertas
 */
class TemperatureController {
  /**
   * Registra leitura de temperatura
   */
  async createReading(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const temperature = await temperatureService.createTemperatureReading(db, req.body);

      // Registra log (anonimizado via auditLogger)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          resourceType: 'Temperature',
          resourceId: temperature._id.toString(),
          status: 'success',
          severity: 'info',
          message: `Leitura de temperatura registrada: ${temperature.temperatureValue}${temperature.temperatureUnit}`,
          req: req
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Leitura de temperatura registrada',
        data: temperature
      });
    } catch (error) {
      logger.error('Erro ao registrar temperatura:', error.message);
      // #636: organizationId lookup failures throw statusCode:404.
      if (error.statusCode === 404) {
        return res.status(404).json({
          success: false,
          error: error.message,
          message: error.message
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Erro ao registrar temperatura',
        message: error.message
      });
    }
  }

  /**
   * Busca histórico de temperatura
   */
  async getHistory(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const filters = {
        sensorId: req.query.sensorId || req.query.sensorID,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        limit: parseInt(req.query.limit) || 1000,
        skip: parseInt(req.query.skip) || 0,
        organizationScope: req.organizationScope
      };

      const result = await temperatureService.getTemperatureHistory(db, filters);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao buscar histórico:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar histórico',
        message: error.message
      });
    }
  }

  /**
   * Busca alertas ativos
   */
  async getAlerts(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const alerts = await temperatureService.getActiveAlerts(db);

      return res.status(200).json({
        success: true,
        data: alerts
      });
    } catch (error) {
      logger.error('Erro ao buscar alertas:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar alertas',
        message: error.message
      });
    }
  }

  async getAll(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const filters = {
        sensorId: req.query.sensorId,
        limit: parseInt(req.query.limit) || 100,
        skip: parseInt(req.query.skip) || 0,
        organizationScope: req.organizationScope
      };

      const result = await temperatureService.getTemperatureHistory(db, filters);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      logger.error('Erro ao listar leituras:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar leituras',
        message: error.message
      });
    }
  }

  async getById(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const { ObjectId } = require('mongodb');
      const temperaturesCollection = db.collection('temperatures');
      const reading = await temperaturesCollection.findOne({ _id: new ObjectId(req.params.id) });

      if (!reading) {
        return res.status(404).json({
          success: false,
          error: 'Leitura não encontrada'
        });
      }

      // #636 (F3-G09): mirrors sensor.controller.js's own out-of-scope
      // 403 pattern -- a null organizationId (unscoped/legacy reading) is
      // out of scope for anyone but a global caller.
      if (req.organizationScope && !isRecordInOrganizationScope(reading, req.organizationScope, 'organizationId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Esta leitura pertence a outra organização'
        });
      }

      return res.status(200).json({
        success: true,
        data: reading
      });
    } catch (error) {
      logger.error('Erro ao buscar leitura:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar leitura',
        message: error.message
      });
    }
  }

  async getControl(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: req.t ? req.t('errors.databaseUnavailable') : 'Banco de dados não disponível'
        });
      }

      const filters = {
        sensorID: req.query.sensorID,
        policyID: req.query.policyID,
        sensorId: req.query.sensorID || req.query.sensorId
      };

      // Remove filtros undefined
      Object.keys(filters).forEach(key => {
        if (filters[key] === undefined) {
          delete filters[key];
        }
      });

      const result = await temperatureService.getTemperatureHistory(db, {
        ...filters,
        limit: 1000,
        organizationScope: req.organizationScope
      });

      // Retorna os dados no formato esperado
      return res.status(200).json({
        success: true,
        data: result.temperatures || result.data || result || []
      });
    } catch (error) {
      logger.error('Erro ao buscar controle:', error.message);
      logger.error('Rastreamento:', error.stack);
      return res.status(500).json({
        success: false,
        error: req.t ? req.t('errors.serverError') : 'Erro ao buscar controle',
        message: error.message
      });
    }
  }
}

module.exports = new TemperatureController();

