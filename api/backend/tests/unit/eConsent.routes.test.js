import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';

const PatientModel = require('../../src/models/Patient');
const Sample = require('../../src/models/Sample');
const connection = require('../../src/infrastructure/database/neo4j/connection');
const router = require('../../src/routes/eConsent');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.set('io', null);
  app.use('/e-consent', router);
  return app;
}

function signToken(payload) {
  return jwt.sign(payload, process.env.CONSENT_SECRET, { expiresIn: 60 * 60 });
}

describe('eConsent.routes POST /generate-link', () => {
  it('returns 400 when patientId or email is missing', async () => {
    const app = buildApp();

    const res = await request(app).post('/e-consent/generate-link').send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'patientId e email obrigatórios' });
  });

  // notification.service does not export a `sendConsentLink` function (only
  // sendConsentEmail/sendConsentSmsFallback/sendConsentWhatsappFallback), so the
  // destructured import at the top of eConsent.js resolves to undefined and the
  // happy path of this route throws unconditionally, hanging the request since
  // the async handler has no try/catch. Filed as issue #80; not exercised here
  // via supertest to avoid hanging the test run.
  it('notification.service does not export sendConsentLink (root cause of issue #80)', () => {
    const notificationService = require('../../src/services/notification.service');
    expect(notificationService.sendConsentLink).toBeUndefined();
  });
});

describe('eConsent.routes GET /validate/:token', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 for an invalid/expired token', async () => {
    const app = buildApp();

    const res = await request(app).get('/e-consent/validate/not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
  });

  // `PatientModel` (src/models/Patient.js) is a plain class with only static
  // utility helpers (isValidEmail, normalizePhone, validate, create, ...) — it
  // has no `findOne`. The route's try/catch maps that thrown TypeError to a
  // 401, so this endpoint returns "Token inválido ou expirado" for every
  // request regardless of token validity. Filed as issue #81; asserting the
  // actual (broken) behavior below rather than the intended one.
  it('returns 401 even for a valid token, because PatientModel.findOne does not exist (issue #81)', async () => {
    const app = buildApp();
    const token = signToken({ patientId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(PatientModel.findOne).toBeUndefined();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
  });
});

describe('eConsent.routes POST /update', () => {
  let fakeSession;

  beforeEach(() => {
    fakeSession = { run: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue() };
    vi.spyOn(connection, 'getNeo4jDriver').mockReturnValue({ session: () => fakeSession });
    vi.spyOn(Sample, 'updateMany').mockResolvedValue({ modifiedCount: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 for an invalid/expired token', async () => {
    const app = buildApp();

    const res = await request(app).post('/e-consent/update').send({ token: 'bad-token', consents: [] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token inválido ou expirado' });
  });

  it('merges each consent via a Neo4j MERGE statement and returns success', async () => {
    const app = buildApp();
    const token = signToken({ patientId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'PENDING' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fakeSession.run).toHaveBeenCalledWith(
      expect.stringContaining('MERGE (p:Patient'),
      { patientId: '12345678', key: 'general', status: 'PENDING' }
    );
    expect(fakeSession.close).toHaveBeenCalledTimes(1);
  });

  it('quarantines samples in Neo4j and MongoDB when any consent is REVOKED', async () => {
    const app = buildApp();
    const token = signToken({ patientId: '12345678' });
    const emit = vi.fn();
    const io = { to: vi.fn().mockReturnValue({ emit }) };
    app.set('io', io);

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(fakeSession.run).toHaveBeenCalledWith(
      expect.stringContaining('QUARANTINED'),
      { patientId: '12345678' }
    );
    expect(Sample.updateMany).toHaveBeenCalledWith(
      { patientID: '12345678' },
      { $set: { status: 'QUARANTINED' } }
    );
    expect(io.to).toHaveBeenCalledWith('patient-12345678');
    expect(emit).toHaveBeenCalledWith('sample-quarantined', { patientId: '12345678' });
  });

  it('releases quarantined samples when every consent is ACTIVE or GRANTED', async () => {
    const app = buildApp();
    const token = signToken({ patientId: '12345678' });
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
    expect(fakeSession.run).toHaveBeenCalledWith(
      expect.stringContaining('AVAILABLE'),
      { patientId: '12345678' }
    );
    expect(Sample.updateMany).toHaveBeenCalledWith(
      { patientID: '12345678', status: 'QUARANTINED' },
      { $set: { status: 'AVAILABLE', updatedAt: expect.any(Date) } }
    );
    expect(io.to).toHaveBeenCalledWith('patient-12345678');
    expect(emit).toHaveBeenCalledWith('sample-released', { patientId: '12345678' });
  });

  it('neither quarantines nor releases when consents are a mix of other statuses', async () => {
    const app = buildApp();
    const token = signToken({ patientId: '12345678' });

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
    // Only the per-consent MERGE calls happened; no quarantine/release run.
    expect(fakeSession.run).toHaveBeenCalledTimes(2);
    expect(Sample.updateMany).not.toHaveBeenCalled();
  });

  it('no-ops the socket emit when no io instance is registered on the app', async () => {
    const app = buildApp();
    const token = signToken({ patientId: '12345678' });

    const res = await request(app)
      .post('/e-consent/update')
      .send({ token, consents: [{ key: 'general', status: 'REVOKED' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
