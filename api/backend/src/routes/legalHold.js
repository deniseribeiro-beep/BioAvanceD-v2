const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const legalHoldController = require('../controllers/legalHold.controller');

// RF026 AC#2/#6 (Retenção e destinação) -- Ator primário Coordenador
// (requisitos-index.md), same requireRole(3,4) level Assay/ReagentLot
// already use (#641/RF025) rather than RetentionPolicy's own
// Administrador-only requireRole(4) -- imposing/releasing a hold is the
// Coordenador-level oversight action RF026 itself names, not the
// Administrador-only security-policy action RF014 gates.
router.post('/', authenticate, requireRole(3, 4), legalHoldController.impose.bind(legalHoldController));
router.post('/:id/release', authenticate, requireRole(3, 4), legalHoldController.release.bind(legalHoldController));
router.get('/:id', authenticate, legalHoldController.getById.bind(legalHoldController));
router.get('/', authenticate, legalHoldController.getAll.bind(legalHoldController));

module.exports = router;
