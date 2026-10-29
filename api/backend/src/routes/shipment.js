const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole, requireOrganizationScope } = require('../infrastructure/middleware/rbac');
const shipmentService = require('../services/shipment.service');
const logger = require('../utils/logger');

// #660 (RF024 AC5): Shipment, the remessa an executed transfer or a released
// distribution is carried out by. Dispatch and receipt are the coordinator's
// level, as on dispositionAction.js; reads are any authenticated user, scoped
// to the sender's or recipient's organization.

function fail(res, error, label) {
  if (error instanceof shipmentService.ShipmentError) {
    return res.status(error.statusCode).json({ success: false, error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
  }
  logger.error(`Erro ao ${label} remessa:`, error.message);
  return res.status(500).json({ success: false, error: `Erro ao ${label} remessa`, message: error.message });
}

async function audit(req, db, shipment, message) {
  const auditLogger = require('../utils/auditLogger');
  auditLogger.init(db);
  await auditLogger.log({
    action: 'UPDATE',
    resourceType: 'Shipment',
    resourceId: shipment.shipmentId,
    status: 'success',
    severity: 'warning',
    message,
    payload: {
      shipmentStatus: shipment.shipmentStatus,
      specimenIds: shipment.specimenIds,
      senderOrganization: shipment.senderOrganization,
      recipientOrganization: shipment.recipientOrganization,
      dispositionActionId: shipment.dispositionActionId,
      accessRequestId: shipment.accessRequestId,
    },
    req,
    module: 'Transporte e distribuição',
  });
}

const actorOf = (req) => (req.user ? String(req.user.userID) : null);

router.post('/', authenticate, requireRole(3, 4), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    const shipment = await shipmentService.createShipment(db, req.body || {}, { actorId: actorOf(req), organizationScope: req.organizationScope });
    await audit(req, db, shipment, 'Remessa despachada');
    return res.status(201).json({ success: true, data: shipment });
  } catch (error) {
    return fail(res, error, 'registrar');
  }
});

router.post('/:id/receive', authenticate, requireRole(3, 4), requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    const shipment = await shipmentService.receiveShipment(db, req.params.id, req.body || {}, { actorId: actorOf(req), organizationScope: req.organizationScope });
    await audit(req, db, shipment, 'Remessa recebida');
    return res.status(200).json({ success: true, data: shipment });
  } catch (error) {
    return fail(res, error, 'receber');
  }
});

router.get('/:id', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    return res.status(200).json({ success: true, data: await shipmentService.getShipment(db, req.params.id, req.organizationScope) });
  } catch (error) {
    return fail(res, error, 'buscar');
  }
});

router.get('/', authenticate, requireOrganizationScope, async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) return res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
    return res.status(200).json({ success: true, data: await shipmentService.listShipments(db, req.organizationScope) });
  } catch (error) {
    return fail(res, error, 'listar');
  }
});

module.exports = router;
