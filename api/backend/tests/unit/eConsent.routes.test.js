import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';

const PatientModel = require('../../src/models/Patient');
const consentService = require('../../src/services/consent.service');
const quarantineActionService = require('../../src/services/quarantine-action.service');

const authPath = require.resolve('../../src/infrastructure/middleware/auth');
const rbacPath = require.resolve('../../src/infrastructure/middleware/rbac');
const routePath = require.resolve('../../src/routes/eConsent');

// #1428: the first require(routePath) loads the route's whole graph cold
// (12543 ms under a loaded coverage run, past the 5000 ms case timeout).
// Loading it once here leaves each loader to re-evaluate only auth, rbac and
// eConsent, which clearRouteCache drops; no case's timeout is raised.
require(routePath);

function clearRouteCache() {
  delete require.cache[authPath];
  delete require.cache[rbacPath];
  delete require.cache[routePath];
}

// Loads the router with `authenticate`/`requirePermission` stubbed to allow
// through (issue: /generate-link had neither, letting anyone mint a valid
// consent link for any patientId + attacker-controlled email).
function loadAuthenticatedRouter() {
  clearRouteCache();
  const authModule = require(authPath);
  authModule.authenticate = (req, res, next) => {
    req.user = { id: 'staff-1', roleName: 'Coordenador' };
    next();
  };
  const rbacModule = require(rbacPath);
  rbacModule.requirePermission = () => (req, res, next) => next();
  return require(routePath);
}

function loadRealAuthRouter() {
  clearRouteCache();
  return require(routePath);
}

function buildApp(router, db) {
  const app = express();
  app.use(express.json());
  app.set('io', null);
  app.locals.db = db;
  app.use('/e-consent', router);
  return app;
}

function signToken(payload) {
  return jwt.sign(payload, process.env.CONSENT_SECRET, { expiresIn: 60 * 60 });
}

describe('eConsent.routes POST /generate-link', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRouteCache();
  });

  it('returns 401 when unauthenticated (no staff session)', async () => {
    const router = loadRealAuthRouter();
    const app = buildApp(router);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ patientId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when participantId or email is missing', async () => {
    const router = loadAuthenticatedRouter();
    const app = buildApp(router);

    const res = await request(app).post('/e-consent/generate-link').send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'participantId e email obrigatórios' });
  });

  it('returns 404 when the patient does not exist', async () => {
    const router = loadAuthenticatedRouter();
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(router, db);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(404);
    expect(findOne).toHaveBeenCalledWith({ participantId: '12345678' });
  });

  it('returns 403 when email does not match the patient on file', async () => {
    const router = loadAuthenticatedRouter();
    const patient = { participantId: '12345678', email: 'real-owner@example.com' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(router, db);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'attacker@evil.com' });

    expect(res.status).toBe(403);
  });

  it('sends a consent email and returns the generated link', async () => {
    const router = loadAuthenticatedRouter();
    const notificationService = require('../../src/services/notification.service');
    const sendConsentEmailSpy = vi
      .spyOn(notificationService, 'sendConsentEmail')
      .mockResolvedValue({ channel: 'email', success: true, provider: 'resend' });
    const patient = { participantId: '12345678', email: 'a@b.com' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(router, db);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.link).toContain('/patient/e-consent/');
    expect(sendConsentEmailSpy).toHaveBeenCalledWith(
      { participantId: '12345678', email: 'a@b.com' },
      res.body.link
    );

    sendConsentEmailSpy.mockRestore();
  });

  // #1166 slice 2: the email check compares against the identity record,
  // decrypted, because dict-02 places the contact there and nowhere else.
  // The Patient row here carries no email, as it will after slice 4.
  it('#1166: checks the email against the decrypted identity record, not the Patient document', async () => {
    const router = loadAuthenticatedRouter();
    const notificationService = require('../../src/services/notification.service');
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const sendConsentEmailSpy = vi
      .spyOn(notificationService, 'sendConsentEmail')
      .mockResolvedValue({ channel: 'email', success: true, provider: 'resend' });
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      email: 'a@b.com',
    });
    const byCollection = {
      patients: { findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }) },
      participantIdentities: { findOne: vi.fn().mockResolvedValue({ ...encrypted, email: null }) },
    };
    const db = { collection: vi.fn((name) => byCollection[name]) };
    const app = buildApp(router, db);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'a@b.com' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(byCollection.participantIdentities.findOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(sendConsentEmailSpy).toHaveBeenCalledWith(
      { participantId: '12345678', email: 'a@b.com' },
      res.body.link
    );
  });

  // #829: the handler had no try/catch, so a throw from sendConsentEmail was
  // an unhandled promise rejection and Node *exited the process*. Observed on
  // the test stack: backend-app-test went Up (healthy) -> Exited (1) on a
  // single request. Every existing test above mocks sendConsentEmail to
  // resolve, which is why the throw path was never exercised.
  //
  // sendConsentEmail does network I/O (SMTP) and validates FRONTEND_URL, so
  // both a transient mail failure and a config gap reach this branch.
  it('returns an error response when sendConsentEmail throws, instead of rejecting unhandled', async () => {
    const router = loadAuthenticatedRouter();
    const notificationService = require('../../src/services/notification.service');
    const failure = new Error('FRONTEND_URL deve ser uma URL absoluta válida');
    failure.code = 'CONSENT_FRONTEND_URL_INVALID';
    const sendConsentEmailSpy = vi
      .spyOn(notificationService, 'sendConsentEmail')
      .mockRejectedValue(failure);
    const patient = { participantId: '12345678', email: 'a@b.com' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(router, db);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/consentimento|link/i);
    expect(res.body.message).toContain('FRONTEND_URL');

    sendConsentEmailSpy.mockRestore();
  });

  it('propagates a statusCode the notification service sets, rather than flattening to 500', async () => {
    const router = loadAuthenticatedRouter();
    const notificationService = require('../../src/services/notification.service');
    const failure = new Error('Convites remotos exigem FRONTEND_URL HTTPS');
    failure.statusCode = 422;
    const sendConsentEmailSpy = vi
      .spyOn(notificationService, 'sendConsentEmail')
      .mockRejectedValue(failure);
    const patient = { participantId: '12345678', email: 'a@b.com' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(router, db);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(422);

    sendConsentEmailSpy.mockRestore();
  });

  // The route used to build the emailed link with its own
  // `process.env.FRONTEND_URL || 'http://localhost:5173'` fallback, while
  // sendConsentEmail -> validateFrontendUrl -> getFrontendUrl read the same
  // variable with NO fallback and threw when empty. Two rules for one value in
  // one request: the fallback made the endpoint look configured, and then the
  // strict path crashed on the value the route had already substituted.
  // Worse, had the strict path not thrown, the fallback would have emailed a
  // real participant a link to *their own* localhost.
  it('does not silently substitute a localhost link when FRONTEND_URL is unset', async () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;

    try {
      const router = loadAuthenticatedRouter();
      const patient = { participantId: '12345678', email: 'a@b.com' };
      const findOne = vi.fn().mockResolvedValue(patient);
      const db = { collection: vi.fn().mockReturnValue({ findOne }) };
      const app = buildApp(router, db);

      const res = await request(app)
        .post('/e-consent/generate-link')
        .send({ participantId: '12345678', email: 'a@b.com' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).not.toContain('localhost:5173');
    } finally {
      if (originalFrontendUrl === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = originalFrontendUrl;
      }
    }
  });
});

describe('eConsent.routes GET /validate/:token', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRouteCache();
  });

  it('returns 401 for an invalid/expired token', async () => {
    const app = buildApp(loadRealAuthRouter());

    const res = await request(app).get('/e-consent/validate/not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
  });

  // `PatientModel` (src/models/Patient.js) is a plain class with only static
  // utility helpers (isValidEmail, normalizePhone, validate, create, ...) — it
  // has no `findOne`. The route looks up the patient directly via
  // req.app.locals.db instead (issue #81).
  it('confirms PatientModel has no findOne (root cause of issue #81)', () => {
    expect(PatientModel.findOne).toBeUndefined();
  });

  // #562: patientName/birthDate/identityDocument are resolved via
  // ParticipantIdentity, merged into the returned `patient` object — a
  // second db.collection('participantIdentities') lookup alongside the
  // existing db.collection('patients') one.
  function buildPatientDb({ patient, identity = null }) {
    return {
      collection: vi.fn((name) => ({
        findOne: vi.fn().mockResolvedValue(name === 'participantIdentities' ? identity : patient),
      })),
    };
  }

  it('returns the patient (with identity merged from ParticipantIdentity), the active template and current responses for a valid token', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe', email: 'jane@example.com' };
    const identity = { participantId: '12345678', patientName: 'Jane Doe', birthDate: '1990-01-20', identityDocument: '11144477735' };
    const db = buildPatientDb({ patient, identity });
    const template = { _id: 'tmpl-1', title: 'TCLE v1', permissions: [{ key: 'general', label: 'Aceito participar' }] };
    const currentConsent = { _id: 'consent-1', status: 'ACTIVE', responses: { general: true } };
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(template);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(currentConsent);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(db.collection).toHaveBeenCalledWith('patients');
    expect(db.collection).toHaveBeenCalledWith('participantIdentities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      patient: { ...patient, patientName: identity.patientName, birthDate: identity.birthDate, identityDocument: identity.identityDocument },
      template: { id: 'tmpl-1', title: 'TCLE v1', permissions: template.permissions },
      responses: { general: true },
    });
  });

  it('resolves patientName/birthDate/identityDocument from a ciphertext-only ParticipantIdentity record (RF005/RNF007 #574)', async () => {
    const participantIdentityService = require('../../src/services/participantIdentity.service');
    const patient = { participantId: '12345678', name: 'Jane Doe', email: 'jane@example.com' };
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: '12345678',
      patientName: 'Jane Doe',
      birthDate: new Date('1990-01-20'),
      identityDocument: '11144477735'
    });
    const ciphertextOnlyIdentity = { ...encrypted, patientName: null, birthDate: null, identityDocument: null };
    const db = buildPatientDb({ patient, identity: ciphertextOnlyIdentity });
    const template = { _id: 'tmpl-1', title: 'TCLE v1', permissions: [] };
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(template);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.patient.patientName).toBe('Jane Doe');
    expect(res.body.patient.identityDocument).toBe('11144477735');
    // #1412: stored as noon UTC of the day.
    expect(new Date(res.body.patient.birthDate).toISOString()).toBe('1990-01-20T12:00:00.000Z');
  });

  it('returns the raw patient unchanged when no ParticipantIdentity record exists yet', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe' };
    const db = buildPatientDb({ patient, identity: null });
    const template = { _id: 'tmpl-1', title: 'TCLE v1', permissions: [] };
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(template);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.patient).toEqual(patient);
  });

  it('returns empty responses when the patient has no active consent', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe' };
    const db = buildPatientDb({ patient });
    const template = { _id: 'tmpl-1', title: 'TCLE v1', permissions: [{ key: 'general', label: 'Aceito participar' }] };
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(template);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.responses).toEqual({});
  });

  it('returns a null template when no ConsentTemplate is active', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe' };
    const db = buildPatientDb({ patient });
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(null);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.template).toBeNull();
  });

  it('returns 404 when the patient does not exist', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: 'no-such-patient' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente não encontrado' });
  });
});

describe('eConsent.routes POST /update', () => {
  // Migrated off the legacy `recordConsentProjectionEvent`-only write (#384,
  // dict-07 row 3 / RF010): every manifestation now goes through the
  // canonical consentId-bearing flow — createPatientConsent for a
  // grant/partial-layer change, revokeConsent for a full revoke-all (since
  // createPatientConsent's `required`-permission gate would otherwise block
  // a legitimate full revocation). Quarantine/release side effects
  // (#409-era specimenStatus + QuarantineAction) stay driven off the raw
  // `consents` payload, unchanged from before #384.
  function buildMockDb({ samples = [], quarantineActions = [] } = {}) {
    const samplesCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(samples) }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const quarantineActionsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'action-1' }),
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(quarantineActions) }) }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const operationalStateDecisionsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'decision-1' }),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return samplesCollection;
        if (name === 'quarantineActions') return quarantineActionsCollection;
        if (name === 'operationalStateDecisions') return operationalStateDecisionsCollection;
        throw new Error(`unexpected collection: ${name}`);
      }),
      samplesCollection,
      quarantineActionsCollection,
      operationalStateDecisionsCollection,
    };
    return db;
  }

  const activeTemplate = { _id: 'tmpl-1', title: 'TCLE v1' };

  beforeEach(() => {
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(activeTemplate);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({ _id: 'consent-1', consentId: 'uuid-1' });
    vi.spyOn(consentService, 'revokeConsent').mockResolvedValue({ _id: 'consent-1', status: 'REVOKED' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRouteCache();
  });

  it('returns 401 for an invalid/expired token', async () => {
    const app = buildApp(loadRealAuthRouter());

    const res = await request(app).post('/e-consent/update').send({ token: 'bad-token', consents: [] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
  });

  it('creates a canonical patient consent against the active template when at least one permission is accepted', async () => {
    const db = buildMockDb();
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'ACCEPTED' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // #1181: the term is the active one of this participant's own lineage.
    expect(consentService.getActiveTemplateForParticipant).toHaveBeenCalledWith(db, '12345678');
    expect(consentService.createPatientConsent).toHaveBeenCalledWith(db, expect.objectContaining({
      participantId: '12345678',
      consentTemplateId: 'tmpl-1',
      responses: { general: true },
    }), { channel: 'electronic_link', signerRole: 'participant', authenticationLevel: 'token' });
    expect(consentService.revokeConsent).not.toHaveBeenCalled();
  });

  it('revokes the patient\'s active consent instead of creating a new one when every permission is revoked', async () => {
    const db = buildMockDb();
    consentService.getPatientConsent.mockResolvedValue({ _id: 'consent-1', status: 'ACTIVE' });
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(consentService.revokeConsent).toHaveBeenCalledWith(db, 'consent-1', {}, { channel: 'electronic_link', signerRole: 'participant', authenticationLevel: 'token' });
    expect(consentService.createPatientConsent).not.toHaveBeenCalled();
  });

  it('no-ops the canonical write when a full revoke-all is submitted but the patient has no active consent', async () => {
    const db = buildMockDb();
    consentService.getPatientConsent.mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(consentService.revokeConsent).not.toHaveBeenCalled();
    expect(consentService.createPatientConsent).not.toHaveBeenCalled();
  });

  it('returns 409 when no ConsentTemplate is active and at least one permission is accepted', async () => {
    const db = buildMockDb();
    consentService.getActiveTemplateForParticipant.mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'ACCEPTED' }] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Nenhum template de consentimento ativo' });
  });

  it('surfaces a validation error from createPatientConsent as 422', async () => {
    const db = buildMockDb();
    const validationError = new Error('responses inválidas');
    validationError.statusCode = 422;
    consentService.createPatientConsent.mockRejectedValue(validationError);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'ACCEPTED' }] });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'responses inválidas' });
  });

  it('quarantines samples and records one QuarantineAction per newly-quarantined sample when any consent is REVOKED', async () => {
    const sample = { _id: 'sample-1', participantId: '12345678', specimenStatus: 'available' };
    const db = buildMockDb({ samples: [sample] });
    const auditSpy = vi.spyOn(quarantineActionService, 'auditDecision').mockResolvedValue(undefined);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });
    const emit = vi.fn();
    const io = { to: vi.fn().mockReturnValue({ emit }) };
    app.set('io', io);

    const res = await request(app)
      .post('/e-consent/update')
      .send({
        token,
        consents: [
          { key: 'general', status: 'ACCEPTED' },
          { key: 'sharing', status: 'REVOKED' },
        ],
      });

    expect(res.status).toBe(200);
    expect(db.samplesCollection.find).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(db.samplesCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'sample-1' },
      {
        $set: expect.objectContaining({
          specimenStatus: 'quarantined',
        }),
      }
    );
    // #540: status is a legacy field canonical-data-contract-v1.md bans on
    // the Sample document — specimenStatus is the sole persisted signal.
    expect(db.samplesCollection.updateOne.mock.calls[0][1].$set.status).toBeUndefined();
    expect(db.quarantineActionsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(db.quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ specimenIds: ['sample-1'], reasonCodes: ['CONSENT_REVOKED'] }),
      undefined
    );
    // RF019 AC#6: the quarantine decision is audited, naming the action just recorded.
    const recorded = db.quarantineActionsCollection.insertOne.mock.calls[0][0];
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({ decision: 'applied', action: recorded }));
    expect(io.to).toHaveBeenCalledWith('patient-12345678');
    expect(emit).toHaveBeenCalledWith('sample-quarantined', { participantId: '12345678' });
    // RF006 AC7 (#1315): the change is a decision triggered by that action.
    expect(db.operationalStateDecisionsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(db.operationalStateDecisionsCollection.insertOne.mock.calls[0][0]).toMatchObject({
      specimenId: 'sample-1',
      previousStatus: 'available',
      newStatus: 'quarantined',
      triggerEventId: recorded.quarantineActionId,
      rulesApplied: ['consent_revocation_quarantine'],
      reasonCodes: ['CONSENT_REVOKED'],
    });
  });

  it('#1315: leaves a destroyed or disposed specimen as it is when consent is revoked', async () => {
    const samples = [
      { _id: 'sample-d', participantId: '12345678', specimenStatus: 'destroyed' },
      { _id: 'sample-x', participantId: '12345678', specimenStatus: 'disposed' },
    ];
    const db = buildMockDb({ samples });
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(db.samplesCollection.updateOne).not.toHaveBeenCalled();
    expect(db.quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
    expect(db.operationalStateDecisionsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('#1315: a restored consent leaves a specimen quarantined by another source (RF019 AC5)', async () => {
    const sample = { _id: 'sample-1', participantId: '12345678', specimenStatus: 'quarantined' };
    const quarantineActions = [
      { quarantineActionId: 'qa-consent', specimenIds: ['sample-1'], reasonCodes: ['CONSENT_REVOKED'], actionStatus: 'active' },
      { quarantineActionId: 'qa-cold', specimenIds: ['sample-1'], reasonCodes: ['COLD_CHAIN_INCIDENT'], actionStatus: 'active' },
    ];
    const db = buildMockDb({ samples: [sample], quarantineActions });
    const releaseSpy = vi.spyOn(quarantineActionService, 'releaseActiveAction');
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'ACTIVE' }] });

    expect(res.status).toBe(200);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(db.samplesCollection.updateOne).not.toHaveBeenCalled();
    expect(db.operationalStateDecisionsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('#1315: a restored consent leaves a quarantined specimen with no active action quarantined', async () => {
    const sample = { _id: 'sample-1', participantId: '12345678', specimenStatus: 'quarantined' };
    const db = buildMockDb({ samples: [sample], quarantineActions: [] });
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'ACTIVE' }] });

    expect(res.status).toBe(200);
    expect(db.samplesCollection.updateOne).not.toHaveBeenCalled();
  });

  it('does not record a duplicate QuarantineAction for a sample already quarantined', async () => {
    const sample = { _id: 'sample-1', participantId: '12345678', specimenStatus: 'quarantined' };
    const db = buildMockDb({ samples: [sample] });
    consentService.getPatientConsent.mockResolvedValue({ _id: 'consent-1', status: 'ACTIVE' });
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(db.samplesCollection.updateOne).toHaveBeenCalled();
    expect(db.quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('releases quarantined samples and calls releaseActiveAction when every consent is ACTIVE or GRANTED', async () => {
    const sample = { _id: 'sample-1', participantId: '12345678', specimenStatus: 'quarantined' };
    const activeAction = { quarantineActionId: 'qa-1', specimenIds: ['sample-1'], reasonCodes: ['CONSENT_REVOKED'], actionStatus: 'active' };
    const db = buildMockDb({ samples: [sample], quarantineActions: [activeAction] });
    const releasedAction = { ...activeAction, actionStatus: 'released' };
    const releaseSpy = vi.spyOn(quarantineActionService, 'releaseActiveAction').mockResolvedValue(releasedAction);
    const auditSpy = vi.spyOn(quarantineActionService, 'auditDecision').mockResolvedValue(undefined);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });
    const emit = vi.fn();
    const io = { to: vi.fn().mockReturnValue({ emit }) };
    app.set('io', io);

    const res = await request(app)
      .post('/e-consent/update')
      .send({
        token,
        consents: [
          { key: 'general', status: 'ACTIVE' },
          { key: 'research', status: 'GRANTED' },
        ],
      });

    expect(res.status).toBe(200);
    // #540: filters on the canonical specimenStatus field now, not the
    // legacy status field (which is no longer written, so a stale-status
    // filter would silently stop matching any sample).
    expect(db.samplesCollection.find).toHaveBeenCalledWith({ participantId: '12345678', specimenStatus: 'quarantined' });
    expect(db.samplesCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'sample-1' },
      {
        $set: expect.objectContaining({
          specimenStatus: 'available',
        }),
      }
    );
    expect(db.samplesCollection.updateOne.mock.calls[0][1].$set.status).toBeUndefined();
    // #1219: handed the sample, so the release matches its specimenId and its _id.
    expect(releaseSpy).toHaveBeenCalledWith(db, expect.objectContaining({ _id: 'sample-1' }), 'SYSTEM');
    expect(auditSpy).toHaveBeenCalledWith(db, expect.objectContaining({ decision: 'released', action: releasedAction }));
    expect(io.to).toHaveBeenCalledWith('patient-12345678');
    expect(emit).toHaveBeenCalledWith('sample-released', { participantId: '12345678' });
    expect(db.operationalStateDecisionsCollection.insertOne.mock.calls[0][0]).toMatchObject({
      specimenId: 'sample-1',
      previousStatus: 'quarantined',
      newStatus: 'available',
      triggerEventId: 'qa-1',
      rulesApplied: ['consent_revocation_quarantine'],
    });
  });

  it('neither quarantines nor releases when consents are a mix of other statuses', async () => {
    const db = buildMockDb();
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({
        token,
        consents: [
          { key: 'general', status: 'PENDING' },
          { key: 'research', status: 'ACTIVE' },
        ],
      });

    expect(res.status).toBe(200);
    expect(db.samplesCollection.find).not.toHaveBeenCalled();
  });

  it('no-ops the socket emit when no io instance is registered on the app', async () => {
    const db = buildMockDb({ samples: [] });
    consentService.getPatientConsent.mockResolvedValue({ _id: 'consent-1', status: 'ACTIVE' });
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

// #684: POST /consents/:id/revoke carried `authenticate` and nothing else,
// while six neighbouring consent-policy routes in the same file gate on
// requireRole(3, 4). So any authenticated user of any role -- including
// accessType 1, Usuario Externo -- could revoke ANY patient's consent by
// guessing a Mongo _id, and a revoked consent has real downstream effect:
// authConsent.js blocks operations on that participant's data once
// status === 'REVOKED'.
//
// The issue offered an ownership check as the alternative gate. It is not
// implementable on this route: `authenticate` sets req.user from the staff
// JWT, whose identity is a `userID` into `users`. There is no participantId
// on it, and the two identity spaces are disjoint. The participant's own
// self-service path is the separate CONSENT_SECRET-token flow
// (/generate-link -> /validate/:token -> /update), which does not go
// through `authenticate` at all -- so gating this route on staff roles does
// not lock a participant out of revoking their own consent.
describe('eConsent.routes POST /consents/:id/revoke (#684)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRouteCache();
  });

  function loadRouterAsRole(hierarchyLevel) {
    clearRouteCache();
    const authModule = require(authPath);
    authModule.authenticate = (req, res, next) => {
      req.user = { userID: 'user-1', id: 'user-1' };
      next();
    };
    const assignmentService = require('../../src/services/rbac-assignment.service');
    vi.spyOn(assignmentService, 'resolveUserHierarchyLevel').mockResolvedValue(hierarchyLevel);
    return require(routePath);
  }

  // The first request that reaches the handler loads its lazy graph (audit
  // logger, alerts) cold: about 260 ms alone, and past the 5000 ms case
  // timeout under a parallel run's contention. Warm it once here, under its
  // own timeout, as #1297 did; no case's timeout is raised.
  beforeAll(async () => {
    vi.spyOn(consentService, 'revokeConsent').mockResolvedValue({ _id: 'consent-1', status: 'REVOKED' });
    const app = buildApp(loadRouterAsRole(3), { collection: () => ({}) });
    await request(app).post('/e-consent/consents/consent-1/revoke').send({});
    vi.restoreAllMocks();
    clearRouteCache();
  }, 30_000);

  it('refuses a Usuario Externo (level 1) instead of revoking', async () => {
    const revokeSpy = vi
      .spyOn(consentService, 'revokeConsent')
      .mockResolvedValue({ _id: 'consent-1', status: 'REVOKED' });

    const app = buildApp(loadRouterAsRole(1), { collection: () => ({}) });

    const res = await request(app).post('/e-consent/consents/consent-1/revoke').send({});

    expect(res.status).toBe(403);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('refuses a Tecnico (level 2) instead of revoking', async () => {
    const revokeSpy = vi
      .spyOn(consentService, 'revokeConsent')
      .mockResolvedValue({ _id: 'consent-1', status: 'REVOKED' });

    const app = buildApp(loadRouterAsRole(2), { collection: () => ({}) });

    const res = await request(app).post('/e-consent/consents/consent-1/revoke').send({});

    expect(res.status).toBe(403);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('lets a Coordenador (level 3) through to the handler', async () => {
    const revokeSpy = vi
      .spyOn(consentService, 'revokeConsent')
      .mockResolvedValue({ _id: 'consent-1', status: 'REVOKED' });

    const app = buildApp(loadRouterAsRole(3), { collection: () => ({}) });

    const res = await request(app).post('/e-consent/consents/consent-1/revoke').send({});

    expect(res.status).not.toBe(403);
    // RF010 AC6: staff revoke on the participant's behalf, under their session.
    expect(revokeSpy).toHaveBeenCalledWith(expect.anything(), 'consent-1', expect.any(Object), expect.objectContaining({
      channel: 'staff_portal', signerRole: 'staff_on_behalf', signerId: 'user-1', authenticationLevel: 'session',
    }));
  });
});

// #1150: POST /consents carried `authenticate` and nothing else, while the
// revoke sibling four lines below it gates on requireRole(3, 4) -- so any
// authenticated principal of any role, UsuarioExterno included, could record
// a consent for any participant. createPatientConsent (consent.controller.js
// :496-548) performs no role and no ownership check: it spreads req.body
// wholesale and uses req.user only to write the audit row, which it labels
// action: SIGN. So the trail recorded the fabricated consent as a signature.
//
// #684 settled the identical question for the revoke sibling and its
// reasoning transfers verbatim, including why ownership is not the
// alternative it looks like: req.user carries a userID into `users`, never a
// participantId, so there is nothing on this route to compare against the
// consent's owner. Creating is the stronger case than revoking -- revocation
// destroys a permission the biobank holds, creation manufactures one, and
// the Consent record is the legal artifact the whole eConsent flow exists to
// produce.
//
// Gating at 3, not a new permission code: verified before choosing it that no
// caller below accessType 3 exists. `git grep -n -I "createPatientConsent" --
// frontend/src` returns only the api.ts definition and two comments -- the
// client method has no caller at all -- and every e2e caller
// (pipeline-continuity, study-protocol-collection-crud, interop-monitoring)
// authenticates as admin via realLogin().
describe('eConsent.routes POST /consents (#1150)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRouteCache();
  });

  function loadRouterAsRole(hierarchyLevel) {
    clearRouteCache();
    const authModule = require(authPath);
    authModule.authenticate = (req, res, next) => {
      req.user = { userID: 'user-1', id: 'user-1' };
      next();
    };
    const assignmentService = require('../../src/services/rbac-assignment.service');
    vi.spyOn(assignmentService, 'resolveUserHierarchyLevel').mockResolvedValue(hierarchyLevel);
    return require(routePath);
  }

  function stubCreate() {
    return vi
      .spyOn(consentService, 'createPatientConsent')
      .mockResolvedValue({ _id: 'consent-1', participantId: 'p-1', consentTemplateId: 't-1', status: 'ACTIVE' });
  }

  it('refuses a Usuario Externo (level 1) instead of recording a consent', async () => {
    const createSpy = stubCreate();

    const app = buildApp(loadRouterAsRole(1), { collection: () => ({}) });

    const res = await request(app).post('/e-consent/consents').send({ participantId: 'p-1' });

    expect(res.status).toBe(403);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('refuses a Tecnico (level 2) instead of recording a consent', async () => {
    const createSpy = stubCreate();

    const app = buildApp(loadRouterAsRole(2), { collection: () => ({}) });

    const res = await request(app).post('/e-consent/consents').send({ participantId: 'p-1' });

    expect(res.status).toBe(403);
    expect(createSpy).not.toHaveBeenCalled();
  });

  // CONTROL: green before and after the gate lands. A Coordenador could
  // record a consent before #1150 and must still be able to afterwards --
  // this is the case that catches a gate set one tier too high.
  it('lets a Coordenador (level 3) through to the handler', async () => {
    const createSpy = stubCreate();

    const app = buildApp(loadRouterAsRole(3), { collection: () => ({}) });

    const res = await request(app).post('/e-consent/consents').send({ participantId: 'p-1' });

    expect(res.status).not.toBe(403);
    expect(createSpy).toHaveBeenCalled();
  });
});

// Issue #921 slice 5: table-driven RBAC gate-argument pinning. Every test
// above this point asserts gate PRESENCE (401/403 outcomes) but not the
// arguments the route handed the gate factory, so a stub that discards its
// arguments -- `rbacModule.requirePermission = () => (req, res, next) =>
// next();` above included -- would answer identically no matter what
// permission code or role list the route actually declared (issue #888).
// Pattern copied from tests/unit/storage.routes.test.js:1174-1205 (read in
// full and confirmed against source before use): a factory stub records its
// own `...args` into a `recordedCalls` array the test then asserts against.
//
// #929: POST /generate-link used to carry requirePermission('createPatient') --
// a Patient-domain permission code gating a Consent-domain route (confirmed
// against eConsent.js:73). It now carries 'requestConsent', the Consent-domain
// code #888 said it needed and #929 added. Seeded to Coordenador +
// Administrador, the same tier createPatient already resolved to, so the swap
// is a no-op for every real caller -- which is exactly why it needs pinning.
//
// requireOrganizationScope: the staff signed-term route is the call site.
// The participant route that returns the same file stays outside that gate.
describe('eConsent.routes RBAC gate argument pinning (issue #921)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRouteCache();
  });

  it('scopes the staff signed term and leaves the participant route open', () => {
    const fs = require('fs');
    const source = fs.readFileSync(routePath, 'utf8');
    expect(source).toContain("router.get('/consents/:id/signed-tcle', authenticate, requireRole(3, 4), requireOrganizationScope");
    expect(source).toContain("router.post('/consent-tokens/signed-tcle', consentController.getSignedTcleByToken.bind(consentController))");
  });

  // Adapted from storage.routes.test.js:1174-1205: that file's router is
  // loaded once and a permanent proxy defers the factory call to request
  // time, so its factory is invoked exactly once per test (only for the
  // route actually hit). This file's loadRouterWithGate instead does a
  // FRESH require(routePath) per test (matching loadAuthenticatedRouter's
  // existing convention above), which re-executes every `requireRole(...)`
  // / `requirePermission(...)` call in eConsent.js at require time -- so if
  // the factory itself pushed to recordedCalls, every one of the file's
  // gated registrations would land in the array on every test, not just
  // the one under test (confirmed the hard way: first run of this suite
  // showed exactly that -- every prior test case's args accumulating in
  // recordedCalls). Recording inside the returned middleware instead defers
  // the push to request time, so only the one route actually reached by
  // the test's request pushes its args.
  function denyingRequirePermission() {
    const recordedCalls = [];
    const factory = (...args) => (req, res) => {
      recordedCalls.push(args);
      return res.status(403).json({ success: false, error: 'Acesso negado', gate: 'permission' });
    };
    factory.recordedCalls = recordedCalls;
    return factory;
  }

  function denyingRequireRole() {
    const recordedCalls = [];
    const factory = (...args) => (req, res) => {
      recordedCalls.push(args);
      return res.status(403).json({ success: false, error: 'Acesso negado', gate: 'role' });
    };
    factory.recordedCalls = recordedCalls;
    return factory;
  }

  // Loads the router with `authenticate` passing through (so the gate under
  // test -- not the auth step ahead of it -- is what answers), swapping in
  // the given requirePermission/requireRole factory BEFORE the single
  // require(routePath) call below. Same freeze-at-require-time reasoning as
  // loadAuthenticatedRouter above: eConsent.js destructures both gates from
  // rbac at require time, so the module-level rbacModule properties have to
  // be set first or the route would keep whatever implementation was
  // current at its own require().
  function loadRouterWithGate({ requirePermissionImpl, requireRoleImpl } = {}) {
    clearRouteCache();
    const authModule = require(authPath);
    authModule.authenticate = (req, res, next) => {
      req.user = { id: 'staff-1', userID: 'staff-1', roleName: 'Coordenador' };
      next();
    };
    const rbacModule = require(rbacPath);
    rbacModule.requirePermission = requirePermissionImpl || (() => (req, res, next) => next());
    rbacModule.requireRole = requireRoleImpl || (() => (req, res, next) => next());
    return require(routePath);
  }

  // One entry per requireRole-gated registration -- 11 of the file's 12
  // gated sites (re-derived via `git grep -n -I -E
  // "requirePermission[(]|requireRole[(]|requireOrganizationScope" --
  // api/backend/src/routes/eConsent.js`: 13 matching lines, one of which,
  // eConsent.js:333, is a comment referencing requireRole(3, 4) in prose,
  // not a call site -- 12 real sites). The 12th, the single
  // requirePermission call, is pinned separately below.
  const ROLE_CASES = [
    { label: 'GET /consent-policies/:id/pending-patients', method: 'get', path: '/consent-policies/cp1/pending-patients', expectedArgs: [3, 4] },
    { label: 'POST /consent-templates', method: 'post', path: '/consent-templates', expectedArgs: [3, 4] },
    { label: 'GET /consent-templates', method: 'get', path: '/consent-templates', expectedArgs: [3, 4] },
    { label: 'GET /consent-templates/:id', method: 'get', path: '/consent-templates/tmpl-1', expectedArgs: [3, 4] },
    { label: 'PUT /consent-templates/:id', method: 'put', path: '/consent-templates/tmpl-1', expectedArgs: [3, 4] },
    { label: 'POST /consent-policies', method: 'post', path: '/consent-policies', expectedArgs: [3, 4] },
    { label: 'PUT /consent-policies/:id', method: 'put', path: '/consent-policies/cp1', expectedArgs: [3, 4] },
    { label: 'GET /consent-policies/history', method: 'get', path: '/consent-policies/history', expectedArgs: [3, 4] },
    { label: 'GET /consent-policies', method: 'get', path: '/consent-policies', expectedArgs: [3, 4] },
    // #1150: POST /consents was authenticate-only while its revoke sibling
    // one line below gated on requireRole(3, 4). Now gated the same way, and
    // pinned here so the argument cannot drift back.
    { label: 'POST /consents', method: 'post', path: '/consents', expectedArgs: [3, 4] },
    { label: 'POST /consents/:id/revoke', method: 'post', path: '/consents/consent-1/revoke', expectedArgs: [3, 4] },
    { label: 'GET /consents/:id/history', method: 'get', path: '/consents/consent-1/history', expectedArgs: [3, 4] },
  ];

  for (const { label, method, path, expectedArgs } of ROLE_CASES) {
    it(`pins requireRole(${expectedArgs.join(', ')}) for ${label}`, async () => {
      const requireRoleImpl = denyingRequireRole();
      const router = loadRouterWithGate({ requireRoleImpl });
      const app = buildApp(router);

      const res = await request(app)[method](`/e-consent${path}`).send({});

      expect(res.status).toBe(403);
      expect(res.body.gate).toBe('role');
      // The load-bearing assertion: a stub that discarded its arguments
      // would 403 identically no matter which role list the route
      // actually declared requireRole with.
      expect(requireRoleImpl.recordedCalls).toEqual([expectedArgs]);
    });
  }

  it("pins requirePermission('requestConsent') for POST /generate-link (#929: the Consent-domain code that replaced the borrowed createPatient)", async () => {
    const requirePermissionImpl = denyingRequirePermission();
    const router = loadRouterWithGate({ requirePermissionImpl });
    const app = buildApp(router);

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ participantId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(403);
    expect(res.body.gate).toBe('permission');
    expect(requirePermissionImpl.recordedCalls).toEqual([['requestConsent']]);
  });
});

// #1325: App.tsx admitted the Coordenador to the TCLE builder while three of
// the e-consent routes the builder calls were requireRole(4), so its save and
// edit answered 403. RF002 AC5 makes the backend the authority; this sweep
// fails when a role a /admin/tcle route admits is refused by one of them.
describe('eConsent.routes: the TCLE builder\'s calls admit every role the frontend admits to /admin/tcle (#1325)', () => {
  it('every e-consent route the TCLE builder calls admits every role App.tsx admits to /admin/tcle', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const appSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'App.tsx'), 'utf8');

    // The seed's hierarchyLevel per role name (rbac.js's header comment).
    const LEVEL_BY_ROLE = { 'Usuário Externo': 1, 'Técnico': 2, 'Coordenador': 3, 'Administrador': 4 };

    // The calls TcleBuilderPage.tsx makes, through the consentService URLs
    // in frontend/src/services/api.ts, relative to the /api/e-consent mount.
    const BUILDER_CALLS = [
      { method: 'GET', path: '/purpose-codes' },
      { method: 'GET', path: '/consent-templates' },
      { method: 'GET', path: '/consent-templates/:id' },
      { method: 'POST', path: '/consent-templates' },
      { method: 'PUT', path: '/consent-templates/:id' },
    ];

    const tcleRoutes = Array.from(appSource.matchAll(/<Route\b[\s\S]*?\/>/g))
      .map((match) => match[0])
      .map((block) => ({ block, routePath: (block.match(/path="([^"]+)"/) || [])[1] }))
      .filter(({ routePath }) => routePath && routePath.startsWith('/admin/tcle'));

    // Guards the regex: a refactor of the <Route> shape must not make this
    // case vacuously green.
    expect(tcleRoutes.map(({ routePath }) => routePath).sort()).toEqual(['/admin/tcle/edit/:templateId', '/admin/tcle/new']);

    const { pins } = require('../rbac-pins/eConsent.pins.js');
    const disagreements = [];
    for (const { block, routePath } of tcleRoutes) {
      const roleList = (block.match(/requiredRole=\{\[([^\]]*)\]\}/) || [])[1] || '';
      const roleNames = Array.from(roleList.matchAll(/'([^']+)'|"([^"]+)"/g)).map((match) => match[1] || match[2]);
      expect(roleNames, `requiredRole of ${routePath}`).not.toEqual([]);

      for (const roleName of roleNames) {
        const level = LEVEL_BY_ROLE[roleName];
        if (level === undefined) {
          disagreements.push(`unmapped role ${roleName} (admitted on ${routePath})`);
          continue;
        }
        for (const call of BUILDER_CALLS) {
          const pin = pins.find((row) => row.method === call.method && row.path === call.path);
          if (!pin) {
            disagreements.push(`no pin for ${call.method} ${call.path}`);
          } else if (!(pin.roles || []).includes(level)) {
            disagreements.push(`${level} refused ${call.method} ${call.path} (admitted on ${routePath})`);
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});

// #1505 (RF019 AC6): recordAction appends a QUARANTINE_APPLIED outbox event;
// this file's fake db has no outbox, and the event's contract is pinned in
// quarantine-action.service.test.js.
beforeEach(() => {
  const { GraphProjectionService } = require('../../src/services/graphProjection.service');
  vi.spyOn(GraphProjectionService.prototype, 'appendQuarantineApplyEvent').mockResolvedValue(null);
});
