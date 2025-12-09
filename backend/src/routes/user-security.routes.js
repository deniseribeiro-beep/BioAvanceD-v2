const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const userSecurityController = require('../controllers/user-security.controller');

/**
 * Todas as rotas de segurança do usuário requerem autenticação
 */
router.use(authenticate);

/**
 * GET /api/user/security/status
 * Obtém status geral de segurança
 */
router.get('/status', userSecurityController.getStatus.bind(userSecurityController));

/**
 * GET /api/user/security/mfa
 * Obtém status do MFA
 */
router.get('/mfa', userSecurityController.getMFAStatus.bind(userSecurityController));

/**
 * GET /api/user/security/password
 * Obtém status da senha
 */
router.get('/password', userSecurityController.getPasswordStatus.bind(userSecurityController));

/**
 * GET /api/user/security/sessions
 * Obtém sessões ativas
 */
router.get('/sessions', userSecurityController.getSessions.bind(userSecurityController));

/**
 * GET /api/user/security/activities
 * Obtém atividades recentes
 */
router.get('/activities', userSecurityController.getActivities.bind(userSecurityController));

/**
 * PUT /api/user/security/mfa
 * Atualiza MFA (telefone ou passkey)
 */
router.put('/mfa', userSecurityController.updateMFA.bind(userSecurityController));

/**
 * PUT /api/user/security/password
 * Atualiza senha
 */
router.put('/password', userSecurityController.updatePassword.bind(userSecurityController));

/**
 * PUT /api/user/security/phone
 * Atualiza telefone
 */
router.put('/phone', userSecurityController.updatePhone.bind(userSecurityController));

/**
 * POST /api/user/security/passkey/start
 * Inicia o processo de registro de passkey
 */
router.post('/passkey/start', userSecurityController.startPasskeyRegistration.bind(userSecurityController));

/**
 * POST /api/user/security/passkey
 * Completa o registro de passkey (FIDO2/WebAuthn)
 */
router.post('/passkey', userSecurityController.completePasskeyRegistration.bind(userSecurityController));

/**
 * DELETE /api/user/security/passkey/:id
 * Remove passkey
 */
router.delete('/passkey/:id', userSecurityController.removePasskey.bind(userSecurityController));

/**
 * POST /api/user/security/recovery-codes
 * Gera códigos de recuperação
 */
router.post('/recovery-codes', userSecurityController.generateRecoveryCodes.bind(userSecurityController));

/**
 * DELETE /api/user/security/sessions/:id
 * Revoga uma sessão específica
 */
router.delete('/sessions/:id', userSecurityController.revokeSession.bind(userSecurityController));

/**
 * DELETE /api/user/security/sessions
 * Revoga todas as sessões (exceto a atual)
 */
router.delete('/sessions', userSecurityController.revokeAllSessions.bind(userSecurityController));

/**
 * POST /api/user/security/password-reset/request
 * Solicita reset de senha com tempo de expiração
 */
router.post('/password-reset/request', userSecurityController.requestPasswordReset.bind(userSecurityController));

module.exports = router;

