import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
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

  it('returns the patient, the active template and current responses for a valid token', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const template = { _id: 'tmpl-1', title: 'TCLE v1', permissions: [{ key: 'general', label: 'Aceito participar' }] };
    const currentConsent = { _id: 'consent-1', status: 'ACTIVE', responses: { general: true } };
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(template);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(currentConsent);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(db.collection).toHaveBeenCalledWith('patients');
    expect(findOne).toHaveBeenCalledWith({ participantId: '12345678' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      patient,
      template: { id: 'tmpl-1', title: 'TCLE v1', permissions: template.permissions },
      responses: { general: true },
    });
  });

  it('returns empty responses when the patient has no active consent', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const template = { _id: 'tmpl-1', title: 'TCLE v1', permissions: [{ key: 'general', label: 'Aceito participar' }] };
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(template);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const app = buildApp(loadRealAuthRouter(), db);
    const token = signToken({ participantId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.responses).toEqual({});
  });

  it('returns a null template when no ConsentTemplate is active', async () => {
    const patient = { participantId: '12345678', name: 'Jane Doe' };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
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
  function buildMockDb({ samples = [] } = {}) {
    const samplesCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(samples) }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const quarantineActionsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'action-1' }),
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const db = {
      collection: vi.fn((name) => {
        if (name === 'samples') return samplesCollection;
        if (name === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`unexpected collection: ${name}`);
      }),
      samplesCollection,
      quarantineActionsCollection,
    };
    return db;
  }

  const activeTemplate = { _id: 'tmpl-1', title: 'TCLE v1' };

  beforeEach(() => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(activeTemplate);
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
    expect(consentService.createPatientConsent).toHaveBeenCalledWith(db, expect.objectContaining({
      participantId: '12345678',
      consentTemplateId: 'tmpl-1',
      responses: { general: true },
    }));
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
    expect(consentService.revokeConsent).toHaveBeenCalledWith(db, 'consent-1');
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
    consentService.getActiveTemplate.mockResolvedValue(null);
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
    expect(io.to).toHaveBeenCalledWith('patient-12345678');
    expect(emit).toHaveBeenCalledWith('sample-quarantined', { participantId: '12345678' });
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
    const db = buildMockDb({ samples: [sample] });
    const releaseSpy = vi.spyOn(quarantineActionService, 'releaseActiveAction').mockResolvedValue(null);
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
    expect(releaseSpy).toHaveBeenCalledWith(db, 'sample-1', 'SYSTEM');
    expect(io.to).toHaveBeenCalledWith('patient-12345678');
    expect(emit).toHaveBeenCalledWith('sample-released', { participantId: '12345678' });
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
