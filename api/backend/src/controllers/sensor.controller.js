const sensorService = require('../services/sensor.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { isRecordInOrganizationScope } = require('../services/rbac-assignment.service');

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
          resourceType: 'Sensor',
          resourceId: sensor._id.toString(),
          status: 'success',
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
      // #634: organizationId lookup failures throw statusCode:404.
      if (error.statusCode === 404) {
        return res.status(404).json({
          success: false,
          error: error.message,
          message: error.message
        });
      }
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
        skip: parseInt(req.query.skip) || 0,
        organizationScope: req.organizationScope
      };

      const result = await sensorService.listSensors(db, filters);

      // Registra log de consulta
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      const sensorsArray = (result && result.sensors) || (Array.isArray(result) ? result : []);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Sensor',
        status: 'success',
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
          resourceType: 'Sensor',
          status: 'error',
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

      // #634 (F3-G09): mirrors sample-file.controller.js's own
      // out-of-scope 403 pattern -- a null organizationId (unscoped/
      // legacy sensor) is out of scope for anyone but a global caller.
      if (req.organizationScope && !isRecordInOrganizationScope(sensor, req.organizationScope, 'organizationId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este sensor pertence a outra organização'
        });
      }

      // Registra log de busca
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'QUERY',
        resourceType: 'Sensor',
        resourceId: req.params.id,
        status: 'success',
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

      // #1029: fetch BEFORE mutating, 404 before the scope check, and 403
      // before any service call that writes. Copied from this file's own
      // #634 `get` handler and from createLinkedFileController's shape: the
      // 404-first ordering is what keeps a MISSING sensor from being
      // indistinguishable from a foreign-org one, which is exactly the
      // null-tolerance that would have made this check a silent no-op
      // against the existing fixtures.
      const existing = await sensorService.getSensor(db, req.params.id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Sensor não encontrado'
        });
      }
      if (req.organizationScope && !isRecordInOrganizationScope(existing, req.organizationScope, 'organizationId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este sensor pertence a outra organização'
        });
      }

      const reading = await sensorService.collectReading(db, req.params.id);

      // Registra log de coleta de leitura
      if (req.user) {
        const auditLogger = require('../utils/auditLogger');
        auditLogger.init(db);
        const hasTemperatureValue = typeof reading?.temperatureValue === 'number';
        await auditLogger.log({
          action: 'READ',
          resourceType: 'Sensor',
          resourceId: req.params.id,
          status: hasTemperatureValue ? 'success' : 'warning',
          severity: hasTemperatureValue ? 'info' : 'warning',
          message: hasTemperatureValue
            ? `Leitura coletada do sensor: ${req.params.id}`
            : `Nenhum valor de temperatura foi obtido do sensor: ${req.params.id}`,
          payload: { temperature: reading?.temperatureValue ?? null },
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

      // #1029: fetch BEFORE mutating, 404 before the scope check, and 403
      // before any service call that writes. Copied from this file's own
      // #634 `get` handler and from createLinkedFileController's shape: the
      // 404-first ordering is what keeps a MISSING sensor from being
      // indistinguishable from a foreign-org one, which is exactly the
      // null-tolerance that would have made this check a silent no-op
      // against the existing fixtures.
      const existing = await sensorService.getSensor(db, req.params.id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Sensor não encontrado'
        });
      }
      if (req.organizationScope && !isRecordInOrganizationScope(existing, req.organizationScope, 'organizationId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este sensor pertence a outra organização'
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
          resourceType: 'Sensor',
          resourceId: req.params.id,
          status: 'success',
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
      // #634: organizationId lookup failures throw statusCode:404.
      if (error.statusCode === 404) {
        return res.status(404).json({
          success: false,
          error: error.message,
          message: error.message
        });
      }
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

      // #1029: fetch BEFORE mutating, 404 before the scope check, and 403
      // before any service call that writes. Copied from this file's own
      // #634 `get` handler and from createLinkedFileController's shape: the
      // 404-first ordering is what keeps a MISSING sensor from being
      // indistinguishable from a foreign-org one, which is exactly the
      // null-tolerance that would have made this check a silent no-op
      // against the existing fixtures.
      const existing = await sensorService.getSensor(db, req.params.id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Sensor não encontrado'
        });
      }
      if (req.organizationScope && !isRecordInOrganizationScope(existing, req.organizationScope, 'organizationId')) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Este sensor pertence a outra organização'
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
          resourceType: 'Sensor',
          resourceId: req.params.id,
          status: 'success',
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

