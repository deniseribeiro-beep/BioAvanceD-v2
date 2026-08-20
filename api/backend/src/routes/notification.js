const express = require('express');
const router = express.Router();
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole } = require('../infrastructure/middleware/rbac');
const notificationRuleController = require('../controllers/notificationRule.controller');

// RF015 AC#3 - individual notification instances the dispatch engine
// created (attempts/delivery/confirmation), separate from the rules that
// generated them (notificationRule.js). Same admin-only gate for now --
// v1 doesn't yet scope a notification to a specific recipient (see
// notificationDispatch.service.js's in_app-channel comment).
router.get('/', authenticate, requireRole(4), notificationRuleController.listNotifications.bind(notificationRuleController));
router.put('/:id/confirm', authenticate, requireRole(4), notificationRuleController.confirmNotification.bind(notificationRuleController));

module.exports = router;
