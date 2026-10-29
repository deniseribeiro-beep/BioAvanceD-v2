const express = require('express');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const collectionGovernanceService = require('../../services/collectionGovernance.service');
const auditLogger = require('../../utils/auditLogger');
const logger = require('../../utils/logger');

// RF004 AC3-AC5, RF020 AC2-AC4, RF021 AC2/AC3: a collection's approvals and
// its governance context, mounted under /api/collections/:collectionId/
// governance. The context and the regime are written only by POST /events
// (RF020 AC4: no silent conversion). Writes take the same roles as editing a
// collection through /api/collections.
const router = express.Router({ mergeParams: true });

function statusOf(error) {
  return [404, 409, 422].includes(error.statusCode) ? error.statusCode : 500;
}

function sendError(res, error, label) {
  const status = statusOf(error);
  if (status === 500) logger.error(`${label}:`, error.message);
  return res.status(status).json({ success: false, error: label, message: error.message, details: error.details || [error.message] });
}

async function audit(req, db, resourceId, message, payload) {
  if (!req.user) return;
  auditLogger.init(db);
  await auditLogger.log({
    action: 'CREATE',
    resourceType: 'Collection',
    resourceId,
    status: 'success',
    severity: 'critical',
    message,
    payload,
    req,
    module: 'Governança da coleção',
  });
}

function dbOf(req, res) {
  const db = req.app.locals.db;
  if (!db) res.status(503).json({ success: false, error: 'Banco de dados não disponível' });
  return db;
}

router.get('/', authenticate, async (req, res) => {
  const db = dbOf(req, res);
  if (!db) return undefined;
  try {
    const data = await collectionGovernanceService.getGovernance(db, req.params.collectionId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Erro ao buscar governança da coleção');
  }
});

router.post('/approvals', authenticate, requireRole(3, 4), async (req, res) => {
  const db = dbOf(req, res);
  if (!db) return undefined;
  try {
    const approval = await collectionGovernanceService.createApproval(db, req.params.collectionId, req.body, req.user?.userID || null);
    await audit(req, db, approval.collectionId, `Aprovação de governança registrada (${approval.approvalId})`, {
      approvalId: approval.approvalId, authority: approval.authority, status: approval.status,
    });
    return res.status(201).json({ success: true, message: 'Aprovação registrada', data: approval });
  } catch (error) {
    return sendError(res, error, 'Erro ao registrar aprovação');
  }
});

router.post('/approvals/:approvalId/status', authenticate, requireRole(3, 4), async (req, res) => {
  const db = dbOf(req, res);
  if (!db) return undefined;
  try {
    const approval = await collectionGovernanceService.setApprovalStatus(
      db, req.params.collectionId, req.params.approvalId, req.body, req.user?.userID || null
    );
    await audit(req, db, approval.collectionId, `Aprovação ${approval.approvalId} passou a ${approval.status}`, {
      approvalId: approval.approvalId, status: approval.status,
    });
    return res.status(200).json({ success: true, message: 'Status da aprovação atualizado', data: approval });
  } catch (error) {
    return sendError(res, error, 'Erro ao atualizar aprovação');
  }
});

router.post('/events', authenticate, requireRole(3, 4), async (req, res) => {
  const db = dbOf(req, res);
  if (!db) return undefined;
  try {
    const result = await collectionGovernanceService.recordEvent(db, req.params.collectionId, req.body, req.user?.userID || null);
    const { event } = result;
    await audit(req, db, event.collectionId, `Decisão de governança: ${event.decisionType} (${event.previousRegime || '-'} -> ${event.newRegime})`, {
      collectionGovernanceEventId: event.collectionGovernanceEventId,
      decisionType: event.decisionType,
      previousRegime: event.previousRegime,
      newRegime: event.newRegime,
      approvalIds: event.approvalIds,
    });
    return res.status(201).json({ success: true, message: 'Decisão de governança registrada', data: result });
  } catch (error) {
    return sendError(res, error, 'Erro ao registrar decisão de governança');
  }
});

module.exports = router;
