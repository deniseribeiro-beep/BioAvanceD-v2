const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');
const logger = require('../../utils/logger');
const binding = require('../../services/telemetryBinding.service');

/**
 * DeviceRegistration routes (#1317; RF009 AC4, RF017 AC7).
 * Base: /api/device-registrations
 *
 * A registration (V2E-0618..0623) enrols a device on a communication
 * profile. It records only an opaque credentialReference
 * (`<manager>:<path>`); a body carrying a credential field is refused. It is
 * never edited: it is deactivated (`suspended` or `revoked`) and a new one
 * is created. The ingestion contract checks a reading's sensor has an
 * active one.
 *
 * Gates: the device routes' own. Writes take manageStorageTopology; reads
 * take viewEquipment. A registration carries no organization in the canon,
 * so no route bounds it by one.
 */

router.use(authenticate);

function sendError(res, error) {
  if (error?.statusCode && error?.code) {
    const details = error.statusCode === 422 ? { details: [error.message] } : {};
    return res.status(error.statusCode).json({ success: false, error: error.code, message: error.message, ...details });
  }
  logger.error('[DeviceRegistrations] Erro não tratado:', error);
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
    resourceType: 'DeviceRegistration',
    resourceId: String(resourceId),
    status: 'success',
    severity: 'info',
    message,
    payload: { ...payload, actorId: actorId(req) },
    req,
    module: 'Equipamentos',
  });
}

/** GET /api/device-registrations?deviceId=  200 { data: DeviceRegistration[] } */
router.get('/', requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    return res.json({ success: true, data: await binding.listRegistrations(req.app.locals.db, { deviceId }) });
  } catch (error) {
    return sendError(res, error);
  }
});

/** GET /api/device-registrations/:deviceRegistrationId  200 { data }; 404 REGISTRATION_NOT_FOUND */
router.get('/:deviceRegistrationId', requirePermission('viewEquipment'), requireOrganizationScope, async (req, res) => {
  try {
    return res.json({ success: true, data: await binding.getRegistration(req.app.locals.db, req.params.deviceRegistrationId) });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/device-registrations
 * Body: { deviceId, communicationProfileId, credentialReference, registeredAt? }
 * 201 { data } with status `active`; 422, including a body carrying a
 * credential field.
 */
router.post('/', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const registration = await binding.createRegistration(req.app.locals.db, req.body || {});
    await audit(req, 'CREATE', registration.deviceRegistrationId, 'DeviceRegistration criado', {
      deviceId: registration.deviceId, communicationProfileId: registration.communicationProfileId,
    });
    return res.status(201).json({ success: true, data: registration });
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * POST /api/device-registrations/:deviceRegistrationId/deactivate
 * Body: { status?: suspended | revoked } (default revoked)
 * 200 { data }; 404; 409 REGISTRATION_INACTIVE; 422.
 */
router.post('/:deviceRegistrationId/deactivate', requirePermission('manageStorageTopology'), requireOrganizationScope, async (req, res) => {
  try {
    const registration = await binding.deactivateRegistration(req.app.locals.db, req.params.deviceRegistrationId, { status: req.body?.status });
    await audit(req, 'UPDATE', registration.deviceRegistrationId, 'DeviceRegistration desativado', { status: registration.status });
    return res.json({ success: true, data: registration });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
