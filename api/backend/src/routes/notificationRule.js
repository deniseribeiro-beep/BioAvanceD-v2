const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const notificationRuleController = require('../controllers/notificationRule.controller');

// RF015 (Alertas e notificações) -- Administrador gerencia as regras
// versionadas, mesmo gate de RF014's retention-policy routes (requireRole(4)).
router.post('/', authenticate, requireRole(4), notificationRuleController.createRule.bind(notificationRuleController));
router.put('/:id', authenticate, requireRole(4), notificationRuleController.updateRule.bind(notificationRuleController));
router.get('/active', authenticate, requireRole(4), notificationRuleController.getActiveRule.bind(notificationRuleController));
router.get('/:id', authenticate, requireRole(4), notificationRuleController.getRuleById.bind(notificationRuleController));
router.get('/', authenticate, requireRole(4), notificationRuleController.getAllRules.bind(notificationRuleController));

module.exports = router;
