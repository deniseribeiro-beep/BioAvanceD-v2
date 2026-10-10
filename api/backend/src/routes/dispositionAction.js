const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const dispositionActionController = require('../controllers/dispositionAction.controller');

// RF026 AC#1/#3/#4/#5 (Retenção e destinação) -- Ator primário Coordenador,
// same requireRole(3,4) level as legalHold.js above.
router.post('/', authenticate, requireRole(3, 4), dispositionActionController.record.bind(dispositionActionController));
// #1315 (RF026 AC4/AC5): the authorization is the policy-level gate,
// requireRole(4) as on retentionPolicy.js; execution and cancellation stay
// with the recording coordinator's level.
router.post('/:id/approve', authenticate, requireRole(4), dispositionActionController.approve.bind(dispositionActionController));
router.post('/:id/execute', authenticate, requireRole(3, 4), dispositionActionController.execute.bind(dispositionActionController));
router.post('/:id/cancel', authenticate, requireRole(3, 4), dispositionActionController.cancel.bind(dispositionActionController));
router.get('/:id/certificate', authenticate, dispositionActionController.getCertificate.bind(dispositionActionController));
router.get('/:id', authenticate, dispositionActionController.getById.bind(dispositionActionController));
router.get('/', authenticate, dispositionActionController.getAll.bind(dispositionActionController));

module.exports = router;
