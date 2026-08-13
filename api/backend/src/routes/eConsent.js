// backend/src/routes/eConsent.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const notificationService = require('../services/notification.service');
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole, requirePermission } = require('../infrastructure/middleware/rbac');
const consentController = require('../controllers/consent.controller');
const CONSENT_SECRET = String(process.env.CONSENT_SECRET || '').trim();
const CONSENT_EXPIRATION = 60 * 60 * 2; // 2h

if (!CONSENT_SECRET) {
  throw new Error('CONSENT_SECRET é obrigatório. O servidor não pode inicializar sem esse segredo.');
}

// Gera link seguro para o paciente
router.post('/generate-link', authenticate, requirePermission('createPatient'), async (req, res) => {
  const { participantId, email } = req.body;
  if (!participantId || !email) return res.status(400).json({ error: 'participantId e email obrigatórios' });

  const db = req.app.locals.db;
  const patient = await db.collection('patients').findOne({ participantId });
  if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });
  if (patient.email !== email) {
    return res.status(403).json({ error: 'Email não corresponde ao paciente' });
  }

  const token = jwt.sign({ participantId }, CONSENT_SECRET, { expiresIn: CONSENT_EXPIRATION });
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/patient/e-consent/${token}`;
  await notificationService.sendConsentEmail({ participantId, email }, link);
  res.json({ success: true, link });
});

// Valida token e retorna dados do paciente, o template de consentimento
// ativo (para renderizar as permissões granulares dinamicamente) e as
// respostas já registradas no Consent ativo do paciente, se houver.
router.get('/validate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const payload = jwt.verify(token, CONSENT_SECRET);
    const db = req.app.locals.db;
    const patient = await db.collection('patients').findOne({ participantId: payload.participantId });
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

    // RF005/RNF007 (#562): patientName/birthDate/identityDocument are civil
    // identity — resolved via ParticipantIdentity, not trusted from Patient's
    // own (soon to be removed) copy of the fields.
    const identity = await db.collection('participantIdentities').findOne({ participantId: payload.participantId });
    const patientWithIdentity = identity
      ? {
        ...patient,
        patientName: identity.patientName,
        birthDate: identity.birthDate,
        identityDocument: identity.identityDocument,
      }
      : patient;

    const consentService = require('../services/consent.service');
    const template = await consentService.getActiveTemplate(db);
    const currentConsent = await consentService.getPatientConsent(db, payload.participantId);

    res.json({
      patient: patientWithIdentity,
      template: template
        ? { id: String(template._id), title: template.title, permissions: template.permissions || [] }
        : null,
      responses: currentConsent && currentConsent.status === 'ACTIVE' ? (currentConsent.responses || {}) : {},
    });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
});

// Atualiza consentimento (aceite ou revogação)
router.post('/update', async (req, res) => {
  const { token, consents } = req.body;
  let participantId;
  try {
    participantId = jwt.verify(token, CONSENT_SECRET).participantId;
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  try {
    // Fluxo canônico: cada manifestação vira um Consent identificado por
    // consentId, versionado contra o ConsentTemplate ativo (RF010 #1-#3).
    // Uma revogação total (toda permissão marcada como não concedida) não
    // pode passar por createPatientConsent — permissões `required` do
    // template bloqueariam a criação — então usa revokeConsent sobre o
    // Consent ativo em vez de tentar criar um novo.
    const consentService = require('../services/consent.service');
    const db = req.app.locals.mongoDb || req.app.locals.db;

    if (db) {
      const responses = {};
      for (const item of Array.isArray(consents) ? consents : []) {
        responses[item.key] = item.status === 'ACCEPTED' || item.status === 'ACTIVE' || item.status === 'GRANTED';
      }
      const responseKeys = Object.keys(responses);
      const isFullRevocation = responseKeys.length > 0 && responseKeys.every(key => responses[key] === false);

      if (isFullRevocation) {
        const currentConsent = await consentService.getPatientConsent(db, participantId);
        if (currentConsent && currentConsent.status === 'ACTIVE') {
          await consentService.revokeConsent(db, String(currentConsent._id));
        }
      } else {
        const template = await consentService.getActiveTemplate(db);
        if (!template) {
          return res.status(409).json({ error: 'Nenhum template de consentimento ativo' });
        }
        await consentService.createPatientConsent(db, {
          participantId,
          consentTemplateId: String(template._id),
          responses,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    // Se algum consentimento foi revogado, coloca amostras em quarentena
    if (consents.some(c => c.status === 'REVOKED')) {
      if (db) {
        const { SampleModel } = require('../models/Sample');
        const { getCollection } = require('../utils/collectionResolver');
        const quarantineActionService = require('../services/quarantine-action.service');
        const samplesCollection = await getCollection(db, 'samples');
        const specimenStatus = 'quarantined';
        const samples = await samplesCollection.find({ participantId }).toArray();

        for (const sample of samples) {
          const wasQuarantined = SampleModel.resolveSpecimenStatus(sample) === 'quarantined';
          await samplesCollection.updateOne(
            { _id: sample._id },
            { $set: { specimenStatus, updatedAt: new Date() } }
          );
          if (!wasQuarantined) {
            await quarantineActionService.recordAction(db, {
              specimenIds: [String(sample._id)],
              reasonCodes: ['CONSENT_REVOKED'],
            });
          }
        }
      }
      // Emite evento BullMQ/Socket.IO (mock)
      const io = req.app.get('io');
      if (io) io.to(`patient-${participantId}`).emit('sample-quarantined', { participantId });
    }
    // Se todos os consentimentos necessários foram aceitos, libera amostras de quarentena
    else if (consents.every(c => c.status === 'ACTIVE' || c.status === 'GRANTED')) {
      if (db) {
        const { SampleModel } = require('../models/Sample');
        const { getCollection } = require('../utils/collectionResolver');
        const quarantineActionService = require('../services/quarantine-action.service');
        const samplesCollection = await getCollection(db, 'samples');
        const specimenStatus = 'available';
        // #540: filters on the canonical specimenStatus field, not the
        // legacy status field (no longer written above either — a
        // stale-status filter would silently stop matching anything).
        const samples = await samplesCollection.find({ participantId, specimenStatus: 'quarantined' }).toArray();

        for (const sample of samples) {
          const wasQuarantined = SampleModel.resolveSpecimenStatus(sample) === 'quarantined';
          await samplesCollection.updateOne(
            { _id: sample._id },
            { $set: { specimenStatus, updatedAt: new Date() } }
          );
          if (wasQuarantined) {
            await quarantineActionService.releaseActiveAction(db, String(sample._id), 'SYSTEM');
          }
        }
      }
      // Emite evento de liberação
      const io = req.app.get('io');
      if (io) io.to(`patient-${participantId}`).emit('sample-released', { participantId });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message || 'Erro ao atualizar consentimento' });
  }
});

router.get('/import/fhir/consent/:token', async (req, res) => {
  try {
    const result = await require('../services/fhir-import-staging.service').validateImportConsentToken(req.app.locals.db, req.params.token);
    return res.json({
      success: true,
      batchId: String(result.record.batchId || ''),
      recordId: String(result.record._id || ''),
      participantId: String(result.record.normalized?.participantId || ''),
      patientName: String(result.record.normalized?.patientName || ''),
      patientEmail: String(result.record.normalized?.patientEmail || ''),
      status: result.record.status,
      consentSigned: Boolean(result.record.normalized?.consentSigned),
      consentTracking: result.record.consentTracking || null,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Erro ao validar consentimento de importação' });
  }
});

router.post('/import/fhir/consent/:token/accept', async (req, res) => {
  try {
    const result = await require('../services/fhir-import-staging.service').acceptImportConsentToken(req.app.locals.db, req.params.token);
    return res.json({
      success: true,
      batchId: String(result.record.batchId || ''),
      recordId: String(result.record._id || ''),
      status: result.record.status,
      consentSigned: Boolean(result.record.normalized?.consentSigned),
      consentTracking: result.record.consentTracking || null,
      quarantineStatus: result.record.quarantineStatus || null,
      quarantineReason: result.record.quarantineReason || null,
      availabilityStatus: result.record.availabilityStatus || null,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || 'Erro ao aceitar consentimento de importação' });
  }
});

// List all patients with PENDING_CONSENT for a given TCLE (policy/template ID)
router.get('/consent-policies/:id/pending-patients', authenticate, requireRole(3, 4), consentController.getPendingPatientsForPolicy.bind(consentController));
router.post('/consent-templates', authenticate, requireRole(4), consentController.createTemplate.bind(consentController));
router.get('/consent-templates', authenticate, requireRole(3, 4), consentController.getAllTemplates.bind(consentController));
router.get('/consent-templates/current', authenticate, consentController.getCurrentTemplate.bind(consentController));
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
router.get('/patients/:participantId/consent', authenticate, consentController.getPatientConsent.bind(consentController));

// Consent token validation/acceptance (public)
router.post('/consent-tokens/validate', consentController.validateConsentToken.bind(consentController));
router.post('/consent-tokens/accept', consentController.acceptConsentToken.bind(consentController));

module.exports = router;

