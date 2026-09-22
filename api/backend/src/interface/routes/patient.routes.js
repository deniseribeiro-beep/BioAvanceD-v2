const express = require('express');
const router = express.Router();
const patientController = require('../../controllers/paciente.controller');
const consentController = require('../../controllers/consent.controller');
const { authenticate } = require('../../infrastructure/middleware/auth');
const { requirePermission, requireOrganizationScope } = require('../../infrastructure/middleware/rbac');

// RF005 - Cadastro de paciente (Coordenador, Administrador)
router.post('/', authenticate, requirePermission('createPatient'), patientController.cadastrar.bind(patientController));

// Listar pacientes
router.get('/', authenticate, requireOrganizationScope, patientController.listar.bind(patientController));

// Buscar pacientes (busca flexível)
// #626: query-level org-scope filter (searchPatients builds its own $or,
// a separate code path from listPatients), mirroring applyOrganizationScopeFilter's
// use there.
router.get('/search', authenticate, requireOrganizationScope, patientController.search.bind(patientController));

// Rota para modulo operacional - lista apenas IDs (sem dados sensiveis).
// #926: MUST stay above GET /:id. Express matches router registrations in
// file order with no static-over-parameter priority, so registered below it
// this route was answered by patientController.buscar with id='operational'
// and was dead code. /search above is ordered correctly and is the precedent.
router.get('/operational', authenticate, requireOrganizationScope, patientController.listar.bind(patientController));

// Buscar consentimento atual do paciente
router.get('/:participantId/consent', authenticate, consentController.getPatientConsent.bind(consentController));

// Reenviar notificações de consentimento
router.post('/:id/consent/resend', authenticate, requirePermission('createPatient'), requireOrganizationScope, patientController.resendConsentNotification.bind(patientController));

// Observações biomarcadoras do paciente
router.get('/:id/observations', authenticate, requireOrganizationScope, patientController.listBiomarkerObservations.bind(patientController));
router.post('/:id/observations', authenticate, requirePermission('createPatient'), requireOrganizationScope, patientController.createBiomarkerObservation.bind(patientController));

// Buscar paciente por ID
router.get('/:id', authenticate, requireOrganizationScope, patientController.buscar.bind(patientController));

// Reidentificação autorizada e auditada (RNF007 AC#4/AC#5, Administrador)
router.post('/:id/reidentify', authenticate, requirePermission('reidentifyParticipant', 'READ'), requireOrganizationScope, patientController.reidentify.bind(patientController));

// Atualizar paciente
router.put('/:id', authenticate, requirePermission('createPatient'), requireOrganizationScope, patientController.atualizar.bind(patientController));

// Deletar paciente
router.delete('/:id', authenticate, requirePermission('createPatient'), requireOrganizationScope, patientController.deletar.bind(patientController));

// Validar ID de paciente (módulo operacional - sem dados sensíveis)
router.post('/validate-id', authenticate, patientController.validateID.bind(patientController));

// Buscar paciente para edição (apenas módulo de cadastro)
router.post('/find-for-edit', authenticate, requirePermission('createPatient'), patientController.findForEdit.bind(patientController));


module.exports = router;

