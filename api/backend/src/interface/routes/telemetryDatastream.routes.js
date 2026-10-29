const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const binding = require('../../services/telemetryBinding.service');

/**
 * TelemetryDatastream routes (#1317; RF009 AC4, RF017 AC5).
 * Base: /api/telemetry-datastreams
 *
 * A datastream (V2E-0562..0571) binds a sensor to its equipment, storage
 * location, observed property, UCUM unit and profiles for a validity period
 * [start, end). There is no update: a changed binding is a new datastream,
 * created after the old one's validity is ended, so a reading stays
 * interpreted through the binding valid when it was observed.
 *
 * Gates: the device routes' own. Writes take manageStorageTopology
 * (Coordenador + Administrador, RF017); reads take viewEquipment. A
 * datastream carries no organization in the canon, so no route bounds it
 * by one.
 */

router.use(authenticate);

function sendError(res, error) {
  if (error?.statusCode && error?.code) {
    const details = error.statusCode === 422 ? { details: [error.message] } : {};
    return res.status(error.statusCode).json({ success: false, error: error.code, message: error.message, ...details });
  }
  logger.error('[TelemetryDatastreams] Erro não tratado:', error);
  return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error?.message });
}

function actorId(req) {
  return req.user?.userID || req.user?.userId || req.user?._id || null;
}

async function audit(req, action, resourceId, message, payload) {
  const auditLogger = require('../../utils/auditLogger');
  auditLogger.init(req.app.locals.db);
  await auditLogger.log({
    action,
    resourceType: 'TelemetryDatastream',
    resourceId: String(resourceId),
    status: 'success',
    severity: 'info',
    message,
    payload: { ...payload, actorId: actorId(req) },
    req,
    module: 'Equipamentos',
  });
}

/** GET /api/telemetry-datastreams?sensorId=  200 { data: TelemetryDatastream[] } */
router.get('/', requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    const sensorId = typeof req.query.sensorId === 'string' ? req.query.sensorId : undefined;
    return res.json({ success: true, data: await binding.listDatastreams(req.app.locals.db, { sensorId }) });
  } catch (error) {
    return sendError(res, error);
  }
});

/** GET /api/telemetry-datastreams/:telemetryDatastreamId  200 { data }; 404 DATASTREAM_NOT_FOUND */
router.get('/:telemetryDatastreamId', requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    return res.json({ success: true, data: await binding.getDatastream(req.app.locals.db, req.params.telemetryDatastreamId) });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/telemetry-datastreams
 * Body: { sensorId, equipmentId, storageLocationId, observedProperty, unit (UCUM),
 *         samplingPolicyId, thresholdProfileId, validityPeriod: { start, end? } }
 * 201 { data }; 409 DATASTREAM_OVERLAP (same sensor and property); 422.
 */
router.post('/', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const stream = await binding.createDatastream(req.app.locals.db, req.body || {});
    await audit(req, 'CREATE', stream.telemetryDatastreamId, 'TelemetryDatastream criado', {
      sensorId: stream.sensorId, observedProperty: stream.observedProperty,
    });
    return res.status(201).json({ success: true, data: stream });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/telemetry-datastreams/:telemetryDatastreamId/end
 * Body: { end? } (ISO 8601, exclusive; default now)
 * 200 { data } with status `retired`; 404; 409 DATASTREAM_ENDED; 422.
 */
router.post('/:telemetryDatastreamId/end', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const stream = await binding.endDatastreamValidity(req.app.locals.db, req.params.telemetryDatastreamId, { end: req.body?.end });
    await audit(req, 'UPDATE', stream.telemetryDatastreamId, 'Validade do TelemetryDatastream encerrada', {
      end: stream.validityPeriod.end,
    });
    return res.json({ success: true, data: stream });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
