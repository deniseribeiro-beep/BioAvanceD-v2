import { describe, it, expect, afterEach, vi } from 'vitest';
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

// Route is mounted at /api/patient
const BASE = '/api/patient';
const TOKEN = 'valid-token-abc';
const FAKE_PATIENT = {
  _id: { toString: () => '507f1f77bcf86cd799439011' },
  patientID: '12345678',
  consentToken: TOKEN,
  consentTemplateId: '507f1f77bcf86cd799439011',
  status: 'PENDING_CONSENT',
};

afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/patient/consent-by-token/:token', () => {
  it('returns 503 when db unavailable', async () => {
    app.locals.db = null;
    const res = await request(app).get(`${BASE}/consent-by-token/${TOKEN}`);
    expect(res.status).toBe(503);
  });

  it('returns 404 when token not found', async () => {
    const patientsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ patients: patientsColl, consentTemplates: createCollectionMock() });

    const res = await request(app).get(`${BASE}/consent-by-token/bad-token`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns patient and template on valid token', async () => {
    const patientsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(FAKE_PATIENT) });
    const templatesColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439011', title: 'Consent v1' }) });
    app.locals.db = createDbMock({ patients: patientsColl, consentTemplates: templatesColl });

    const res = await request(app).get(`${BASE}/consent-by-token/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('patient');
    expect(res.body.data).toHaveProperty('consentToken', TOKEN);
  });

  it('returns null template when templateId is invalid ObjectId', async () => {
    const patientNoTemplate = { ...FAKE_PATIENT, consentTemplateId: '' };
    const patientsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(patientNoTemplate) });
    const templatesColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ patients: patientsColl, consentTemplates: templatesColl });

    const res = await request(app).get(`${BASE}/consent-by-token/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.template).toBeNull();
  });
});

describe('PUT /api/patient/consent-by-token/:token', () => {
  it('returns 503 when db unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .put(`${BASE}/consent-by-token/${TOKEN}`)
      .send({ responses: { q1: true } });
    expect(res.status).toBe(503);
  });

  it('returns 404 when token not found', async () => {
    const patientsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ patients: patientsColl });

    const res = await request(app)
      .put(`${BASE}/consent-by-token/bad-token`)
      .send({ responses: {} });
    expect(res.status).toBe(404);
  });

  it('creates consent and updates patient status', async () => {
    const patientsColl = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(FAKE_PATIENT),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    const consentsColl = createCollectionMock({
      insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439012' }),
    });
    app.locals.db = createDbMock({ patients: patientsColl, consents: consentsColl });

    const res = await request(app)
      .put(`${BASE}/consent-by-token/${TOKEN}`)
      .send({ responses: { question1: 'yes' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ACTIVE');
  });
});
