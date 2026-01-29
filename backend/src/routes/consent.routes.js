const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const consentController = require('../controllers/consent.controller');

router.post('/consent-templates', authenticate, requireRole(4), consentController.createTemplate.bind(consentController));
router.get('/consent-templates/active', authenticate, consentController.getActiveTemplate.bind(consentController));

router.post('/consents', authenticate, consentController.createPatientConsent.bind(consentController));
router.post('/consents/:id/revoke', authenticate, consentController.revokeConsent.bind(consentController));

module.exports = router;
