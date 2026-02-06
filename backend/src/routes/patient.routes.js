const express = require('express');
const router = express.Router();
const patientController = require('../controllers/paciente.controller');
const consentController = require('../controllers/consent.controller');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

// RF005 - Cadastro de paciente (Coordenador, Administrador)
router.post('/', authenticate, requirePermission('createPatient'), patientController.cadastrar.bind(patientController));

// Listar pacientes
router.get('/', authenticate, patientController.listar.bind(patientController));

// Buscar pacientes (busca flexível)
router.get('/search', authenticate, patientController.search.bind(patientController));

// Buscar consentimento atual do paciente
router.get('/:patientId/consent', authenticate, consentController.getPatientConsent.bind(consentController));

// Reenviar notificações de consentimento
router.post('/:id/consent/resend', authenticate, requirePermission('createPatient'), patientController.resendConsentNotification.bind(patientController));

// Buscar paciente por ID
router.get('/:id', authenticate, patientController.buscar.bind(patientController));

// Atualizar paciente
router.put('/:id', authenticate, requirePermission('createPatient'), patientController.atualizar.bind(patientController));

// Deletar paciente
router.delete('/:id', authenticate, requirePermission('createPatient'), patientController.deletar.bind(patientController));

// Validar ID de paciente (módulo operacional - sem dados sensíveis)
router.post('/validate-id', authenticate, patientController.validateID.bind(patientController));

// Buscar paciente para edição (apenas módulo de cadastro)
router.post('/find-for-edit', authenticate, requirePermission('createPatient'), patientController.findForEdit.bind(patientController));

// Rota para módulo operacional - lista apenas IDs (sem dados sensíveis)
router.get('/operational', authenticate, patientController.listar.bind(patientController));

module.exports = router;

