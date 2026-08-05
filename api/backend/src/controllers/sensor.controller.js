const sensorService = require('../services/sensor.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');

/**
 * Controller de Sensores
 * RF009 - Gerenciamento de Sensores
 */
class SensorController {
  async create(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const sensor = await sensorService.createSensor(db, req.body);

      // Registra log (anonimizado via auditLogger)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'CREATE',
          entityType: 'Sensor',
          entityId: sensor._id.toString(),
          result: 'success',
          severity: 'info',
          message: `Sensor ${sensor.sensorId || sensor.sensorID} criado`,
          req: req
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Sensor criado com sucesso',
        data: sensor
      });
    } catch (error) {
      logger.error('Erro ao criar sensor:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao criar sensor',
        message: error.message
      });
    }
  }

  async list(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const filters = {
        locationId: req.query.locationId || req.query.locationID,
        maintenanceStatus: req.query.maintenanceStatus,
        limit: parseInt(req.query.limit) || 50,
        skip: parseInt(req.query.skip) || 0
      };

      const result = await sensorService.listSensors(db, filters);

      // Registra log de consulta
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      const sensorsArray = (result && result.sensors) || (Array.isArray(result) ? result : []);
      await auditLogger.log({
        action: 'QUERY',
        entityType: 'Sensor',
        result: 'success',
        severity: 'info',
        message: `Consulta de sensores - ${sensorsArray.length || 0} registros`,
        payload: { total: sensorsArray.length || 0, filters },
        req: req,
        module: 'Sensores'
      });

      // Retorna array de sensores diretamente para compatibilidade com frontend
      return res.status(200).json({
        success: true,
        data: sensorsArray
      });
    } catch (error) {
      logger.error('Erro ao listar sensores:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao listar sensores',
        message: error.message
      });
    }
  }

  async get(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const sensor = await sensorService.getSensor(db, req.params.id);

      if (!sensor) {
        // Registra tentativa de busca de sensor inexistente
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'QUERY',
          entityType: 'Sensor',
          result: 'error',
          severity: 'warning',
          message: `Tentativa de buscar sensor inexistente: ${req.params.id}`,
          req: req,
          module: 'Sensores'
        });
        
        return res.status(404).json({
          success: false,
          error: 'Sensor não encontrado'
        });
      }

      // Registra log de busca
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        entityType: 'Sensor',
        entityId: req.params.id,
        result: 'success',
        severity: 'info',
        message: 'Sensor consultado',
        req: req,
        module: 'Sensores'
      });

      return res.status(200).json({
        success: true,
        data: sensor
      });
    } catch (error) {
      logger.error('Erro ao buscar sensor:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar sensor',
        message: error.message
      });
    }
  }

  async collectReading(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const reading = await sensorService.collectReading(db, req.params.id);

      // Registra log de coleta de leitura
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'READ',
          entityType: 'Sensor',
          entityId: req.params.id,
          result: 'success',
          severity: 'info',
          message: `Leitura coletada do sensor: ${req.params.id}`,
          payload: { temperature: reading?.temperatureValue || null },
          req: req,
          module: 'Sensores'
        });
      }

      return res.status(200).json({
        success: true,
        data: reading
      });
    } catch (error) {
      logger.error('Erro ao coletar leitura:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erro ao coletar leitura',
        message: error.message
      });
    }
  }

  async update(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const result = await sensorService.updateSensor(db, req.params.id, req.body);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Sensor não encontrado'
        });
      }

      // Registra log (anonimizado via auditLogger)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'UPDATE',
          entityType: 'Sensor',
          entityId: req.params.id,
          result: 'success',
          severity: 'info',
          message: 'Sensor atualizado',
          req: req
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Sensor atualizado com sucesso',
        data: result
      });
    } catch (error) {
      logger.error('Erro ao atualizar sensor:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao atualizar sensor',
        message: error.message
      });
    }
  }

  async delete(req, res) {
    try {
      const db = req.app.locals.db;
      if (!db) {
        return res.status(503).json({
          success: false,
          error: 'Banco de dados não disponível'
        });
      }

      const result = await sensorService.deleteSensor(db, req.params.id);

      if (!result) {
        return res.status(404).json({
          success: false,
          error: 'Sensor não encontrado'
        });
      }

      // Registra log (anonimizado via auditLogger)
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        await auditLogger.log({
          action: 'DELETE',
          entityType: 'Sensor',
          entityId: req.params.id,
          result: 'success',
          severity: 'warning',
          message: 'Sensor deletado',
          req: req
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Sensor deletado com sucesso'
      });
    } catch (error) {
      logger.error('Erro ao deletar sensor:', error.message);
      return res.status(400).json({
        success: false,
        error: 'Erro ao deletar sensor',
        message: error.message
      });
    }
  }
}

module.exports = new SensorController();

