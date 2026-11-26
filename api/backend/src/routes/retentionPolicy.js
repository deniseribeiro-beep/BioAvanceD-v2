const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const retentionPolicyController = require('../controllers/retentionPolicy.controller');

// RF014 (Políticas de segurança) -- Administrador é o ator primário, mesmo
// gate usado por eConsent.js para as rotas de policy admin (requireRole(4)).
router.post('/', authenticate, requireRole(4), retentionPolicyController.createPolicy.bind(retentionPolicyController));
router.put('/:id', authenticate, requireRole(4), retentionPolicyController.updatePolicy.bind(retentionPolicyController));
router.get('/active', authenticate, requireRole(4), retentionPolicyController.getActivePolicy.bind(retentionPolicyController));
router.get('/data-classes', authenticate, requireRole(4), retentionPolicyController.getDataClasses.bind(retentionPolicyController));
router.get('/:id', authenticate, requireRole(4), retentionPolicyController.getPolicyById.bind(retentionPolicyController));
router.get('/', authenticate, requireRole(4), retentionPolicyController.getAllPolicies.bind(retentionPolicyController));

module.exports = router;
