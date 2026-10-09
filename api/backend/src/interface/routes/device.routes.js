const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const devices = require('../../services/deviceLifecycle.service');

/**
 * Device routes (#1316; RF017 AC6/AC8). Base: /api/devices
 *
 * A device (ELM-0305..0315) is registered not homologated, and its
 * installation, movement, homologation, withdrawal and retirement are
 * appended as lifecycle events; the row carries the state they derive.
 * Nothing here edits or deletes an event.
 *
 * Gates: RF017 names the Coordenador, so registering a device and recording
 * its lifecycle take manageStorageTopology (Coordenador + Administrador);
 * reads take viewEquipment, whose resourceType is Device. A device carries
 * no organization in the canon, so no route bounds it by one.
 */

router.use(authenticate);

function sendError(res, error) {
  if (error?.statusCode && error?.code) {
    const details = error.statusCode === 422 ? { details: [error.message] } : {};
    return res.status(error.statusCode).json({ success: false, error: error.code, message: error.message, ...details });
  }
  logger.error('[Devices] Erro não tratado:', error);
  return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: error?.message });
}

function actorId(req) {
  return req.user?.userID || req.user?.userId || req.user?._id || null;
}

async function audit(req, resourceId, payload) {
  const auditLogger = require('../../utils/auditLogger');
  auditLogger.init(req.app.locals.db);
  await auditLogger.log({
    action: 'CREATE',
    resourceType: 'Device',
    resourceId: String(resourceId),
    status: 'success',
    severity: 'info',
    message: 'Dispositivo registrado ou evento de ciclo de vida anexado',
    payload: { ...payload, actorId: actorId(req) },
    req,
    module: 'Equipamentos',
  });
}

/** GET /api/devices  200 { data: Device[] } */
router.get('/', requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    return res.json({ success: true, data: await devices.listDevices(req.app.locals.db) });
  } catch (error) {
    return sendError(res, error);
  }
});

/** GET /api/devices/:deviceId  200 { data: Device & { history } }; 404 DEVICE_NOT_FOUND */
router.get('/:deviceId', requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    return res.json({ success: true, data: await devices.getDevice(req.app.locals.db, req.params.deviceId) });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/devices
 * Body: { deviceId, deviceType, manufacturer?, modelNumber?, serialNumber?,
 *         firmwareVersion?, softwareVersion?, calibrationDate?, calibrationDueDate?,
 *         maintenanceRecords?: string[] }
 * 201 { data } with qualificationStatus `pending`; 409 DEVICE_EXISTS; 422.
 */
router.post('/', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const device = await devices.registerDevice(req.app.locals.db, req.body || {});
    await audit(req, device.deviceId, { deviceType: device.deviceType });
    return res.status(201).json({ success: true, data: device });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/devices/:deviceId/events
 * Body: { eventType: installed | moved | qualified | disqualified | retired,
 *         locationId? (installed, moved), evidenceUri? (qualified),
 *         reason? (disqualified, retired), occurredAt? }
 * 201 { data: { device, event } }; 404 DEVICE_NOT_FOUND; 409 LIFECYCLE_CONFLICT; 422.
 */
router.post('/:deviceId/events', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const result = await devices.recordEvent(req.app.locals.db, req.params.deviceId, { ...(req.body || {}), actorId: actorId(req) });
    await audit(req, req.params.deviceId, { eventType: result.event.eventType, deviceLifecycleEventId: result.event.deviceLifecycleEventId });
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
