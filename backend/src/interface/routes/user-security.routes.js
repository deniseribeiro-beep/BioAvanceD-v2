const express = require('express');
const router = express.Router();
const { authenticate } = require('../../infrastructure/middleware/auth');
const userSecurityController = require('../../controllers/user-security.controller');

router.use(authenticate);

router.get('/status', userSecurityController.getStatus.bind(userSecurityController));
router.get('/mfa', userSecurityController.getMFAStatus.bind(userSecurityController));
router.get('/password', userSecurityController.getPasswordStatus.bind(userSecurityController));
router.get('/sessions', userSecurityController.getSessions.bind(userSecurityController));
router.get('/activities', userSecurityController.getActivities.bind(userSecurityController));

router.put('/password', userSecurityController.updatePassword.bind(userSecurityController));

router.post('/recovery-codes', userSecurityController.generateRecoveryCodes.bind(userSecurityController));
router.delete('/sessions/:id', userSecurityController.revokeSession.bind(userSecurityController));
router.delete('/sessions', userSecurityController.revokeAllSessions.bind(userSecurityController));
router.post('/password-reset/request', userSecurityController.requestPasswordReset.bind(userSecurityController));

module.exports = router;
