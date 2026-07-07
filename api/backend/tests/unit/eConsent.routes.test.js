import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';

const PatientModel = require('../../src/models/Patient');
const Sample = require('../../src/models/Sample');
const connection = require('../../src/infrastructure/database/neo4j/connection');
const router = require('../../src/routes/eConsent');

function buildApp(db) {
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
  it('returns 400 when patientId or email is missing', async () => {
    const app = buildApp();

    const res = await request(app).post('/e-consent/generate-link').send({ email: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'patientId e email obrigatórios' });
  });

  it('sends a consent email and returns the generated link', async () => {
    const notificationService = require('../../src/services/notification.service');
    const sendConsentEmailSpy = vi
      .spyOn(notificationService, 'sendConsentEmail')
      .mockResolvedValue({ channel: 'email', success: true, provider: 'resend' });

    const app = buildApp();

    const res = await request(app)
      .post('/e-consent/generate-link')
      .send({ patientId: '12345678', email: 'a@b.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.link).toContain('/patient/e-consent/');
    expect(sendConsentEmailSpy).toHaveBeenCalledWith(
      { patientID: '12345678', email: 'a@b.com' },
      res.body.link
    );

    sendConsentEmailSpy.mockRestore();
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
  // has no `findOne`. The route looks up the patient directly via
  // req.app.locals.db instead (issue #81).
  it('confirms PatientModel has no findOne (root cause of issue #81)', () => {
    expect(PatientModel.findOne).toBeUndefined();
  });

  it('returns the patient and consents for a valid token', async () => {
    const patient = { patientID: '12345678', name: 'Jane Doe', consents: [{ key: 'general', status: 'ACTIVE' }] };
    const findOne = vi.fn().mockResolvedValue(patient);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(db);
    const token = signToken({ patientId: '12345678' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(db.collection).toHaveBeenCalledWith('patients');
    expect(findOne).toHaveBeenCalledWith({ patientID: '12345678' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ patient, consents: patient.consents });
  });

  it('returns 404 when the patient does not exist', async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const db = { collection: vi.fn().mockReturnValue({ findOne }) };
    const app = buildApp(db);
    const token = signToken({ patientId: 'no-such-patient' });

    const res = await request(app).get(`/e-consent/validate/${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente não encontrado' });
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
