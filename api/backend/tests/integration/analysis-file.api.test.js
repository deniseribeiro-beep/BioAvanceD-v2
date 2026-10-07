import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const analysisValidationService = require('../../src/services/analysisValidation.service');
const { createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 2) {
  return jwt.sign(
    { userID: 'qa-1', accessType, roleName: 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => {
  givenSession();
  app.locals.db = createDbMock({});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/analysis-files/validate/:sampleIdentifier', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/analysis-files/validate/SMP-001');
    expect(res.status).toBe(401);
  });

  it('returns 404 when sample not found', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: false,
      error: 'Amostra não encontrada',
    });

    const res = await request(app)
      .get('/api/analysis-files/validate/SMP-NOT-FOUND')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 409 when patient consent is pending', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: false,
      error: 'Consentimento pendente',
      patientStatus: 'PENDING_CONSENT',
    });

    const res = await request(app)
      .get('/api/analysis-files/validate/SMP-PENDING')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONSENT_PENDING');
  });

  it('returns eligible: true when sample passes validation', async () => {
    // The shape validateUploadEligibility returns on success.
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      eligible: true,
      sample: {
        _id: '507f1f77bcf86cd799439011',
        specimenId: 'SMP-001',
        barcode: 'BC-001',
        participantId: '12345678',
        sampleType: 'blood',
        specimenStatus: 'available',
      },
      patient: { participantId: '12345678', consentStatus: 'ACTIVE', consentAcceptedAt: null },
    });

    const res = await request(app)
      .get('/api/analysis-files/validate/SMP-001')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.success).toBe(true);
  });

  it('returns 503 when db is not available', async () => {
    app.locals.db = undefined;

    const res = await request(app)
      .get('/api/analysis-files/validate/SMP-001')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when validation service throws', async () => {
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/analysis-files/validate/SMP-001')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
