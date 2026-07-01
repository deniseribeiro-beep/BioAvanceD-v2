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
    vi.spyOn(analysisValidationService, 'validateUploadEligibility').mockResolvedValue({
      success: true,
      sample: { sampleID: 'SMP-001' },
      patient: { patientID: 'PAT-001' },
    });

    const res = await request(app)
      .get('/api/analysis-files/validate/SMP-001')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.success).toBe(true);
  });
});
