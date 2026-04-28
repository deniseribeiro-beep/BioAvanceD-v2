import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');

function createAuthToken() {
  return jwt.sign(
    {
      id: 'quality-user-1',
      userID: 'quality-user-1',
      accessType: 2,
      roleName: 'Técnico',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('POST /api/quality/preview', () => {
  beforeEach(() => {
    app.locals.db = {
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit-1' }),
      }),
    };
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'quality-preview-session' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'quality-preview-session' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  it('retorna preview canônico versionado para o wizard', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        sprec: {
          matrixType: 'fluid',
          sampleType: 'BLD',
          primaryContainer: 'A',
          preCentrifugation: 'A',
          centrifugation: 'A',
          secondCentrifugation: 'A',
          postCentrifugationDelay: 'A',
          longTermStorage: 'A',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      version: 'quality-domain-governance-aware-v2',
      ruleTableVersion: 'quality-rule-table-article-v1',
      category: 'A',
      forcedQuarantine: false,
      matrixType: 'fluid',
    });
  });

  it('aceita payload SPREC fluid estruturado com código bruto e label', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        matrixType: 'fluid',
        sprec: {
          matrixType: 'fluid',
          sampleType: { code: 'SER', label: 'Serum' },
          primaryContainer: { code: 'SST', label: 'Serum separator tube with clot activator' },
          preCentrifugation: { code: 'C', label: 'RT; 2 to 4 h' },
          centrifugation1: { code: 'E', label: 'RT; 10 to 15 min; 3000 g to 6000 g; with braking', applicable: true },
          centrifugation2: { code: 'N', label: 'No centrifugation', required: false },
          postCentrifugation: { code: 'C', label: '1 to 2 h; 2 to 10°C' },
          longTermStorage: { code: 'A', label: 'PP tube 0.5 to 2 mL; (-85) to (-60)°C' },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      score: 65,
      category: 'B',
      forcedQuarantine: false,
      matrixType: 'fluid',
      ruleTableVersion: 'quality-rule-table-article-v1',
    });
    expect(response.body.data.breakdown.P_store).toMatchObject({
      code: 'cryogenic_or_ultralow_workflow_appropriate',
      penalty: 0,
    });
  });

  it('aceita payload SPREC solid estruturado com tipo de coleta e storage bruto', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        matrixType: 'solid',
        sprec: {
          matrixType: 'solid',
          sampleType: { code: 'TIS', label: 'Solid tissue' },
          collectionType: { code: 'SRG', label: 'Surgical excision' },
          warmIschemia: { code: 'B', label: '2-10 min' },
          coldIschemia: { code: 'B', label: '2-10 min' },
          fixationType: { code: 'OCT', label: 'Optimum cutting temperature medium' },
          fixationTime: { code: 'C', label: '1-4 h' },
          longTermStorage: { code: 'A', label: 'PP tube 0.5 to 2 mL; (-85) to (-60) °C' },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      score: 65,
      category: 'B',
      forcedQuarantine: false,
      matrixType: 'solid',
    });
  });

  it('preserva storage X como governance failure vindo do backend', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        matrixType: 'fluid',
        sprec: {
          matrixType: 'fluid',
          sampleType: { code: 'SER', label: 'Serum' },
          primaryContainer: { code: 'SST', label: 'Serum separator tube with clot activator' },
          preCentrifugation: { code: 'A', label: 'RT; <2 h' },
          centrifugation1: { code: 'A', label: 'RT; 10 to 15 min; <3000 g; no braking', applicable: true },
          centrifugation2: { code: 'N', label: 'No centrifugation', required: false },
          postCentrifugation: { code: 'A', label: '<1 h; 2 to 10°C' },
          longTermStorage: { code: 'X', label: 'Unknown' },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      score: null,
      category: 'C',
      forcedQuarantine: true,
      decisionStatus: 'quarantine',
    });
    expect(response.body.data.governance.Ggov).toBe(0);
    expect(response.body.data.governanceFailures.length).toBeGreaterThan(0);
  });
});
