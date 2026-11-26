// backend/src/routes/eConsent.js
const express = require('express');
// #1045: stripConsentSecrets -- this route returns a raw patients document.
const PatientModel = require('../models/Patient');
const jwt = require('jsonwebtoken');
const router = express.Router();
const notificationService = require('../services/notification.service');
const { authenticate } = require('../infrastructure/middleware/auth');
const { requireRole, requirePermission, requireOrganizationScope } = require('../infrastructure/middleware/rbac');
const consentController = require('../controllers/consent.controller');
const participantIdentityService = require('../services/participantIdentity.service');
const logger = require('../utils/logger');
const { effectivePermissionsOf } = require('../services/consentHistory.service');
const consentQuarantineService = require('../services/consentQuarantine.service');
const CONSENT_EXPIRATION = 60 * 60 * 2; // 2h
// RF010 AC4: a manifestation through the signed consent link is the
// participant's own, authenticated by the link's token.
const PARTICIPANT_LINK_ACTOR = Object.freeze({
  channel: 'electronic_link',
  signerRole: 'participant',
  authenticationLevel: 'token'
});

/**
 * #1097: read the secret at CALL time, not at module load.
 *
 * This file used to do the read and the throw at module scope. server.js:3
 * requires ./app, app.js mounts this router, so that throw fired before
 * server.js installed its #1040 uncaughtException handler and before
 * startServer()'s critical-variable guards ran -- a missing secret killed the
 * backend with a bare Node loader stack trace, unattributed, and masked every
 * other boot guard by firing first.
 *
 * The refusal is still absolute; it just happens somewhere it can be reported.
 * server.js now names CONSENT_SECRET alongside MONGO_URI/JWT_SECRET/
 * USER_ANON_SALT, so a misconfigured stack still refuses to start -- loudly,
 * through the logger, and without hiding its siblings.
 *
 * Same shape as fhir-import-staging.service.js's getConsentSecret(), which
 * already read this variable this way.
 */
function getConsentSecret() {
  const secret = String(process.env.CONSENT_SECRET || '').trim();
  if (!secret) {
    const error = new Error(
      'CONSENT_SECRET e obrigatorio para fluxos de consentimento e nao esta configurado.'
    );
    error.statusCode = 500;
    throw error;
  }
  return secret;
}

/**
 * #1097: a MISSING SECRET is a server misconfiguration, not a bad token.
 *
 * The two token-consuming handlers below answer 401 'Token invalido ou
 * expirado' from a catch that wraps the whole body. Reading the secret
 * inside that catch would launder a config fault into an authentication
 * failure -- the operator would chase a token bug forever. So the read
 * happens first, in its own try, and reports 500.
 *
 * Deliberately not hoisted OUTSIDE a try: #829 records that an uncaught
 * throw in a handler here becomes an unhandled rejection, which this
 * process treats as fatal (server.js:41). One request would take the API
 * down -- the exact hazard #829 closed.
 */
function resolveConsentSecretOr500(res) {
  try {
    return getConsentSecret();
  } catch (configError) {
    logger.error('Erro de configuracao no fluxo de consentimento:', configError);
    res.status(500).json({
      error: 'Erro de configuracao do servidor',
      message: configError.message,
    });
    return null;
  }
}

// Gera link seguro para o paciente
router.post('/generate-link', authenticate, requirePermission('requestConsent'), async (req, res) => {
  const { participantId, email } = req.body;
  if (!participantId || !email) return res.status(400).json({ error: 'participantId e email obrigatórios' });

  const db = req.app.locals.db;
  const patient = await db.collection('patients').findOne({ participantId });
  if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

  // #1166: the address on file is identity data (dict-02 P1X-0352), so the
  // check reads the decrypted ParticipantIdentity record, its only home since
  // slice 4. Compared case-insensitively because every writer canonicalizes
  // the address to lowercase before encrypting it, so only the caller's
  // spelling can differ in case.
  const rawIdentity = await db.collection('participantIdentities').findOne({ participantId });
  const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
  const emailOnFile = participantIdentityService.withIdentityContact(patient, identity).email;
  const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
  if (!emailOnFile || normalizeEmail(emailOnFile) !== normalizeEmail(email)) {
    return res.status(403).json({ error: 'Email não corresponde ao paciente' });
  }

  // #829: this block had no try/catch. sendConsentEmail throws on an invalid
  // FRONTEND_URL and does SMTP I/O besides, so a config gap or a transient
  // mail failure became an unhandled promise rejection -- which Node does not
  // treat as a caught error: it exits the process. One authenticated request
  // took the whole API down. The four sibling handlers in this file
  // (/validate/:token, /update, and the FHIR import consent pair) all already
  // had one; this was an omission, not a pattern.
  try {
    const token = jwt.sign({ participantId }, getConsentSecret(), { expiresIn: CONSENT_EXPIRATION });
    // #829: the link is built from the service's own resolver rather than a
    // second, more lenient reading of the same variable. The route used to
    // default to 'http://localhost:5173' while getFrontendUrl() threw on an
    // empty value -- two rules for one value in one request. The lenient one
    // was the more dangerous of the two: had the strict path not thrown, it
    // would have emailed a real participant a link to their own localhost.
    const link = `${notificationService.getFrontendUrl()}/patient/e-consent/${token}`;
    await notificationService.sendConsentEmail({ participantId, email: emailOnFile }, link);
    return res.json({ success: true, link });
  } catch (error) {
    logger.error('Erro ao gerar link de consentimento:', error);
    return res.status(error.statusCode || 500).json({
      error: 'Erro ao gerar link de consentimento',
      message: error.message,
    });
  }
});

// Valida token e retorna dados do paciente, o template de consentimento
// ativo (para renderizar as permissões granulares dinamicamente) e as
// respostas já registradas no Consent ativo do paciente, se houver.
router.get('/validate/:token', async (req, res) => {
  // #1097: resolved before the 401 catch below, so a missing secret reports
  // a 500 configuration error instead of an invalid-token answer.
  const consentSecret = resolveConsentSecretOr500(res);
  if (!consentSecret) return;

  try {
    const { token } = req.params;
    const payload = jwt.verify(token, consentSecret);
    const db = req.app.locals.db;
    const patient = await db.collection('patients').findOne({ participantId: payload.participantId });
    if (!patient) return res.status(404).json({ error: 'Paciente não encontrado' });

    // RF005/RNF007 (#562/#574): patientName/birthDate/identityDocument are civil
    // identity — resolved via ParticipantIdentity, never from the Patient
    // document (#575). All three are ciphertext-only there (#1104), so
    // decryptIdentity is what recovers them.
    const rawIdentity = await db.collection('participantIdentities').findOne({ participantId: payload.participantId });
    const identity = rawIdentity ? participantIdentityService.decryptIdentity(rawIdentity) : null;
    const patientWithIdentity = identity
      ? {
        ...patient,
        patientName: identity.patientName,
        birthDate: identity.birthDate,
        identityDocument: identity.identityDocument,
      }
      : patient;

    const consentService = require('../services/consent.service');
    // #1181: the active term of the participant's own lineage.
    const template = await consentService.getActiveTemplateForParticipant(db, payload.participantId);
    const currentConsent = await consentService.getPatientConsent(db, payload.participantId);

    res.json({
      // #1045: this is the OTHER consent system -- a JWT flow with its own
      // CONSENT_SECRET -- but it reads the same `patients` document, so it was
      // echoing the bulk flow's plaintext `consentToken` to whoever holds a
      // valid JWT for that participant. Different route file, same credential.
      patient: PatientModel.stripConsentSecrets(patientWithIdentity),
      template: template
        ? { id: String(template._id), title: template.title, permissions: template.permissions || [] }
        : null,
      // RF010 AC6: what the consent still permits, less any scoped revocation.
      responses: currentConsent && currentConsent.status === 'ACTIVE' ? effectivePermissionsOf(currentConsent) : {},
    });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
});

// Atualiza consentimento (aceite ou revogação)
router.post('/update', async (req, res) => {
  const { token, consents } = req.body;
  // #1097: same reason as /validate/:token -- a config fault must not be
  // reported as an invalid token.
  const consentSecret = resolveConsentSecretOr500(res);
  if (!consentSecret) return;

  let participantId;
  try {
    participantId = jwt.verify(token, consentSecret).participantId;
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
          await consentService.revokeConsent(db, String(currentConsent._id), {}, PARTICIPANT_LINK_ACTOR);
        }
      } else {
        const template = await consentService.getActiveTemplateForParticipant(db, participantId);
        if (!template) {
          return res.status(409).json({ error: 'Nenhum template de consentimento ativo' });
        }
        await consentService.createPatientConsent(db, {
          participantId,
          consentTemplateId: String(template._id),
          responses,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
          userAgent: req.headers['user-agent'],
        }, PARTICIPANT_LINK_ACTOR);
      }
    }

    // Se algum consentimento foi revogado, coloca amostras em quarentena
    if (consents.some(c => c.status === 'REVOKED')) {
      if (db) {
        await consentQuarantineService.quarantineForRevocation(db, participantId, { req });
      }
      // Emite evento BullMQ/Socket.IO (mock)
      const io = req.app.get('io');
      if (io) io.to(`patient-${participantId}`).emit('sample-quarantined', { participantId });
    }
    // Se todos os consentimentos necessários foram aceitos, libera amostras de quarentena
    else if (consents.every(c => c.status === 'ACTIVE' || c.status === 'GRANTED')) {
      if (db) {
        // Only the quarantines consent opened are lifted (RF019 AC5).
        await consentQuarantineService.releaseForConsent(db, participantId, { req });
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
router.post('/consent-templates', authenticate, requireRole(3, 4), consentController.createTemplate.bind(consentController));
router.get('/consent-templates', authenticate, requireRole(3, 4), consentController.getAllTemplates.bind(consentController));
// #1349: the builder's purpose select, read by whoever may list terms.
router.get('/purpose-codes', authenticate, requireRole(3, 4), consentController.listPurposeCodes.bind(consentController));
router.get('/consent-templates/current', authenticate, consentController.getCurrentTemplate.bind(consentController));
router.get('/consent-templates/active', authenticate, consentController.getActiveTemplate.bind(consentController));
router.get('/consent-templates/:id', authenticate, requireRole(3, 4), consentController.getTemplateById.bind(consentController));
router.put('/consent-templates/:id', authenticate, requireRole(3, 4), consentController.updateTemplate.bind(consentController));

router.post('/consent-policies', authenticate, requireRole(3, 4), consentController.createPolicy.bind(consentController));
router.put('/consent-policies/:id', authenticate, requireRole(3, 4), consentController.updatePolicy.bind(consentController));
router.get('/consent-policies/active', authenticate, consentController.getActivePolicy.bind(consentController));
router.get('/consent-policies/active-with-caae', authenticate, consentController.getActivePoliciesWithCaae.bind(consentController));
router.get('/consent-policies/history', authenticate, requireRole(3, 4), consentController.getPoliciesHistory.bind(consentController));
router.get('/consent-policies', authenticate, requireRole(3, 4), consentController.getAllPolicies.bind(consentController));

router.post('/consents', authenticate, requireRole(3, 4), consentController.createPatientConsent.bind(consentController));
// #684: was authenticate-only, while every neighbouring consent-policy
// route gates on requireRole(3, 4) -- so any authenticated user of any
// role could revoke any patient's consent by guessing a Mongo _id.
// RF010's only named actor for revocation is the Participante, and the
// participant's own path is the separate CONSENT_SECRET-token flow
// (/generate-link -> /validate/:token -> /update), which does not pass
// through `authenticate`. This route is therefore the staff-acting-on-
// behalf case, and it takes the same gate as its siblings. An ownership
// check is not the alternative it looks like: req.user carries a userID
// into `users`, never a participantId, so there is nothing on this route
// to compare against the consent's owner.
router.post('/consents/:id/revoke', authenticate, requireRole(3, 4), consentController.revokeConsent.bind(consentController));
// RF010 AC5: the decision events and revocations a consent's state derives from.
router.get('/consents/:id/history', authenticate, requireRole(3, 4), consentController.getConsentHistory.bind(consentController));
router.get('/consents/:id/signed-tcle', authenticate, requireRole(3, 4), requireOrganizationScope, consentController.getSignedTcle.bind(consentController));
router.get('/patients/:participantId/consent', authenticate, consentController.getPatientConsent.bind(consentController));

// Consent token validation/acceptance (public)
router.post('/consent-tokens/validate', consentController.validateConsentToken.bind(consentController));
router.post('/consent-tokens/accept', consentController.acceptConsentToken.bind(consentController));
router.post('/consent-tokens/revoke', consentController.revokeConsentToken.bind(consentController));
router.post('/consent-tokens/signed-tcle', consentController.getSignedTcleByToken.bind(consentController));

// gov.br OIDC for remote TCLE (ADR 2026-11-26) — public, token still required at accept
router.use('/govbr', require('./govbrConsent'));

module.exports = router;

