const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requireRole } = require('../../infrastructure/middleware/rbac');
const consentController = require('../../controllers/consent.controller');

router.post('/consent-templates', authenticate, requireRole(4), consentController.createTemplate.bind(consentController));
router.get('/consent-templates/active', authenticate, consentController.getActiveTemplate.bind(consentController));
router.get('/consent-templates/:id', authenticate, requireRole(4), consentController.getTemplateById.bind(consentController));
router.put('/consent-templates/:id', authenticate, requireRole(4), consentController.updateTemplate.bind(consentController));

router.post('/consent-policies', authenticate, requireRole(3, 4), consentController.createPolicy.bind(consentController));
router.put('/consent-policies/:id', authenticate, requireRole(3, 4), consentController.updatePolicy.bind(consentController));
router.get('/consent-policies/active', authenticate, consentController.getActivePolicy.bind(consentController));
router.get('/consent-policies/active-with-caae', authenticate, consentController.getActivePoliciesWithCaae.bind(consentController));
router.get('/consent-policies/history', authenticate, requireRole(3, 4), consentController.getPoliciesHistory.bind(consentController));
router.get('/consent-policies', authenticate, requireRole(3, 4), consentController.getAllPolicies.bind(consentController));

router.post('/consents', authenticate, consentController.createPatientConsent.bind(consentController));
router.post('/consents/:id/revoke', authenticate, consentController.revokeConsent.bind(consentController));

// Consent token validation/acceptance (public)
router.post('/consent-tokens/validate', consentController.validateConsentToken.bind(consentController));
router.post('/consent-tokens/accept', consentController.acceptConsentToken.bind(consentController));

module.exports = router;
