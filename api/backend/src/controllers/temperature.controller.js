const temperatureService = require('../services/temperature.service');
const logService = require('../services/log.service');
const logger = require('../utils/logger');
const { resolveOrganizationIdForCreate } = require('../services/rbac-assignment.service');
const { splitContractFields, auditStrippedFields } = require('../services/telemetryReadingContract');

const { TEMPERATURE_API_READING_FIELDS } = temperatureService;

const READING_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// #1080: organization resolution for the machine-ingest path.
//
// POST /temperature/system/reading has no session, so there is no caller
// scope to stamp from -- but the BODY must not choose either. Before this, a
// TELEMETRY_INGEST_SECRET holder could attribute a cold-chain reading to any
// organization in the catalogue, because assertOrganizationIdResolves checks
// only that the organization EXISTS, never that the caller may write to it.
//
// The sensor is the answer. Sensor.organizationId (#634) carries it, and the
// canonical model hangs organizational custody off the device rather than the
// reading (TelemetryReading.sensorId, 1..1 Core, ELM-0357).
//
// An UNKNOWN sensor is a 404 -- this codebase's settled answer for a
// named-but-nonexistent referenced entity (api/backend/docs/
// STORAGE_API_EXAMPLES.js's CODIGOS DE ERRO table; sensor.controller.js does
// the same, deliberately 404ing before any scope check so that a missing
// sensor is never conflated with a foreign-organization one).
//
// A sensor that EXISTS but carries organizationId: null is deliberately NOT a
// refusal, and this is the one judgment call in the change. #634 added the
// field without backfilling, so every sensor predating it is legitimately
// unscoped; refusing those would turn a working telemetry ingest into a hard
// outage on any database older than that commit. Such a reading is stored
// unattributed instead -- exactly what it was before. The defect is closed
// either way, because what is removed is the BODY's ability to choose.
async function resolveMachineIngestOrganization(db, body) {
  const sensorId = body?.sensorId || body?.sensorID;

  if (!sensorId) {
    // Nothing to derive from. TemperatureModel.validate makes sensorId
    // mandatory, so this goes on to the usual 400 -- but the body's
    // organizationId is dropped on the way rather than honoured.
    return { ...body, organizationId: null };
  }

  const sensor = await db.collection('sensors').findOne({ sensorId: String(sensorId) });
  if (!sensor) {
    const error = new Error(`sensorId ${sensorId} não encontrado`);
    error.statusCode = 404;
    error.auditReason = 'unknown_sensor';
    throw error;
  }

  return { ...body, organizationId: sensor.organizationId || null };
}

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

      // RULE-025, RF009 AC8 (#1582): the body's non-contract fields are
      // stripped at receipt, so no value of theirs reaches the organization
      // lookup, the hash, the screen or the store, and the security audit is
      // written here, before any refusal, naming them and never a value.
      const { reading: receivedBody, strippedFields } = splitContractFields(req.body, TEMPERATURE_API_READING_FIELDS);
      await auditStrippedFields(db, { ingestionService: 'temperature-api', strippedFields, sensorId: receivedBody.sensorId || receivedBody.sensorID || null });

      // #1071: stamp the organization from the caller's resolved scope.
      // #1080: req.organizationScope is undefined on POST /system/reading, the
      // machine-ingest sibling, which has no session. That route used to keep
      // the body's value; it now derives the organization from the sensor.
      // See resolveMachineIngestOrganization above for why an unknown sensor
      // is a 404 and an unscoped one is not.
      const temperatureData = req.organizationScope
        ? { ...receivedBody, organizationId: resolveOrganizationIdForCreate(req.organizationScope, receivedBody.organizationId) }
        : await resolveMachineIngestOrganization(db, receivedBody);
      const temperature = await temperatureService.createTemperatureReading(db, temperatureData, { strippedFields });

      // RF009 AC7 (#1317): a replayed idempotencyKey wrote nothing, so it
      // answers 200 with the stored reading and records no CREATE.
      if (temperature.replayed) {
        return res.status(200).json({
          success: true,
          message: 'Leitura já registrada com este idempotencyKey',
          data: temperature
        });
      }

      // Registra log (anonimizado via auditLogger)
      //
      // #1080: this was guarded on `if (req.user)`, so the ONE route here with
      // no session -- machine ingest -- wrote no audit row at all, and a
      // mis-attributed reading arrived with no record that anything submitted
      // it. The guard is gone: auditLogger degrades the actor to USR-SYSTEM by
      // itself when there is no req.user, and ingestionTestSupport.routes.js
      // already audits a sessionless secret-gated route exactly this way. `req`
      // is still passed, so IP, user-agent, method and path are still captured.
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(db);
      await auditLogger.log({
        action: 'CREATE',
        resourceType: 'Temperature',
        resourceId: temperature.telemetryReadingId,
        status: 'success',
        severity: 'info',
        message: `Leitura de temperatura registrada: ${temperature.temperatureValue}${temperature.temperatureUnit}`,
        req: req
      });

      return res.status(201).json({
        success: true,
        message: 'Leitura de temperatura registrada',
        data: temperature
      });
    } catch (error) {
      logger.error('Erro ao registrar temperatura:', error.message);
      // #1120 (Axis E E3): this catch answers 404 and 400 for unrelated
      // causes, and the global audit row recorded them identically. Throw
      // sites that know the cause tag it; audit.middleware.js writes the tag
      // into the row's payload.reason. An untagged failure (e.g. the insert
      // itself) records no reason rather than a guessed one.
      if (error.auditReason) {
        res.locals.auditReason = error.auditReason;
      }
      // #636: organizationId lookup failures throw statusCode:404.
      if (error.statusCode === 404) {
        return res.status(404).json({
          success: false,
          error: error.message,
          message: error.message
        });
      }
      // #1317: InfluxDB did not confirm the write, so nothing was stored.
      if (error.statusCode === 503) {
        return res.status(503).json({
          success: false,
          code: error.code,
          error: error.message,
          message: error.message
        });
      }
      return res.status(error.statusCode === 422 ? 422 : 400).json({
        success: false,
        error: 'Erro ao registrar temperatura',
        message: error.message,
        details: error.details
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

      // #1062: pass the caller's resolved scope, the same way getHistory,
      // getAll, getControl and getById already do.
      const alerts = await temperatureService.getActiveAlerts(db, { organizationScope: req.organizationScope });

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

      // RF009 AC1 (#1391): a reading lives in InfluxDB and is read by its
      // telemetryReadingId, a uuid. Any other id (an old Mongo ObjectId, a
      // shadowed `control`) names no reading, so it answers 404 unread.
      const found = READING_ID_PATTERN.test(req.params.id)
        ? await temperatureService.getReadingById(db, req.params.id, req.organizationScope)
        : null;

      if (!found) {
        return res.status(404).json({
          success: false,
          error: 'Leitura não encontrada'
        });
      }

      // #636 (F3-G09): mirrors sensor.controller.js's own out-of-scope
      // 403 pattern. A point carries no organizationId, so the scope is by
      // sensor: a reading of another organization's sensor, or with no
      // sensorId, is out of scope for anyone but a global caller.
      if (!found.inScope) {
        return res.status(403).json({
          success: false,
          error: 'Acesso negado',
          message: 'Esta leitura pertence a outra organização'
        });
      }

      return res.status(200).json({
        success: true,
        data: found.reading
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

