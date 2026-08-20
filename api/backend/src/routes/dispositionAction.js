const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const dispositionActionController = require('../controllers/dispositionAction.controller');

// RF026 AC#1/#3/#4/#5 (Retenção e destinação) -- Ator primário Coordenador,
// same requireRole(3,4) level as legalHold.js above.
router.post('/', authenticate, requireRole(3, 4), dispositionActionController.record.bind(dispositionActionController));
router.get('/:id/certificate', authenticate, dispositionActionController.getCertificate.bind(dispositionActionController));
router.get('/:id', authenticate, dispositionActionController.getById.bind(dispositionActionController));
router.get('/', authenticate, dispositionActionController.getAll.bind(dispositionActionController));

module.exports = router;
