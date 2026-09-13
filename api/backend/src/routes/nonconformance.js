const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const nonconformanceController = require('../controllers/nonconformance.controller');

// RF025 AC#5/#6 (Ensaios, reagentes e não conformidades) -- Ator primário
// Técnico (dict-02/requisitos-index.md), so opening a nonconformance uses
// the same 2,3,4 gate Técnico already has elsewhere (createSample etc.).
// Recording the corrective action and verifying its effectiveness are
// oversight actions -- gated to Coordenador/Administrador (3,4), same
// level as retentionPolicy.js's requireRole(4) precedent for a
// supervisory action, one notch down since RF026's own primary actor for
// an analogous oversight role is Coordenador, not Administrador-only.
router.post('/', authenticate, requireRole(2, 3, 4), nonconformanceController.open.bind(nonconformanceController));
router.post('/:id/corrective-action', authenticate, requireRole(3, 4), nonconformanceController.recordCorrectiveAction.bind(nonconformanceController));
router.post('/:id/verify-effectiveness', authenticate, requireRole(3, 4), nonconformanceController.verifyEffectiveness.bind(nonconformanceController));
router.get('/:id', authenticate, nonconformanceController.getById.bind(nonconformanceController));
router.get('/', authenticate, nonconformanceController.getAll.bind(nonconformanceController));

module.exports = router;
