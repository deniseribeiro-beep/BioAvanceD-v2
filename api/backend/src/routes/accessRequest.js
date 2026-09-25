const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requirePermission } = require('../infrastructure/middleware/rbac');
const accessRequestController = require('../controllers/accessRequest.controller');

// RF024 (Solicitações de acesso e distribuição) -- Fase 1 contrato. Neither
// RF024's "Pesquisador" (requester) nor "comitê responsável" (decision)
// actor maps to an existing role in this repo's 4-role RBAC model, so the
// whole lifecycle is gated behind one governance-level permission
// (Administrador-only since #662) rather than inventing new roles this slice
// doesn't otherwise need -- same scope precedent as RF014's requireRole(4).
router.post('/', authenticate, requirePermission('manageAccessRequests'), accessRequestController.createAccessRequest.bind(accessRequestController));
router.post('/:id/evaluate', authenticate, requirePermission('manageAccessRequests', 'UPDATE'), accessRequestController.evaluateCompatibility.bind(accessRequestController));
router.post('/:id/decision', authenticate, requirePermission('manageAccessRequests', 'UPDATE'), accessRequestController.recordDecision.bind(accessRequestController));
router.post('/:id/distribute', authenticate, requirePermission('manageAccessRequests', 'UPDATE'), accessRequestController.distribute.bind(accessRequestController));
router.post('/:id/revoke', authenticate, requirePermission('manageAccessRequests', 'UPDATE'), accessRequestController.revoke.bind(accessRequestController));
router.get('/:id/access-check', authenticate, requirePermission('manageAccessRequests'), accessRequestController.getAccessCheck.bind(accessRequestController));
router.get('/:id', authenticate, requirePermission('manageAccessRequests'), accessRequestController.getById.bind(accessRequestController));
router.get('/', authenticate, requirePermission('manageAccessRequests'), accessRequestController.getAll.bind(accessRequestController));

module.exports = router;
