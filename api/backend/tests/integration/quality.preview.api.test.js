import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const request = require('supertest');
const {
  makeAuthToken,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');
const { createDbMock, createCollectionMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const referenceData = require('../../src/services/rcs-reference-data');

function admissibleGovernanceEvidence() {
  return Object.fromEntries(
    referenceData.governanceEvidenceCategories.map(({ key }) => [key, 'satisfied'])
  );
}

function createAuthToken() {
  return makeAuthToken(2);
}

describe('POST /api/quality/preview RCS-GOV 1.0', () => {
  beforeEach(() => {
    const generic = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit-1' }),
    });
    app.locals.db = createDbMock({
      ...buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 }]),
      auditLogs: generic,
    });
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'quality-preview-session' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'quality-preview-session' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  it('mantem a rota existente e retorna decisao exclusivamente RCS-GOV A-E', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        governanceEvidence: admissibleGovernanceEvidence(),
        sprec: {
          matrixType: 'fluid',
          sampleType: 'BLD',
          primaryContainer: 'SST',
          preCentrifugation: 'C',
          centrifugation: 'A',
          secondCentrifugation: 'A',
          postCentrifugationDelay: 'A',
          longTermStorage: 'C',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      model_version: 'RCS-GOV-1.0',
      matrix_type: 'fluid',
      governance_status: 1,
      p_bio: 6,
      rcs_score: 94,
      score_based_grade: 'A',
      final_grade: 'A',
      grade_route: 'Score-based certification',
    });
    expect(response.body.data).not.toHaveProperty('ruleTableVersion');
    expect(response.body.data).not.toHaveProperty('quality_score');
    expect(response.body.data).not.toHaveProperty('quality_category');
    expect(response.body.data).not.toHaveProperty('penalty_log');
    expect(response.body.data.axis_penalties.length).toBe(5);
    expect(response.body.data.axis_penalties[0]).toEqual(expect.objectContaining({
      axis_code: expect.any(String),
      sprec_code: expect.any(String),
      weight: expect.any(Number),
      severity: expect.any(Number),
      penalty: expect.any(Number),
    }));
  });

  it('retorna 422 quando a evidência de governança explícita está ausente', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        matrixType: 'fluid',
        sprec: {
          matrixType: 'fluid',
          sampleType: 'BLD',
          primaryContainer: 'SST',
          preCentrifugation: 'A',
          centrifugation: 'A',
          secondCentrifugation: 'A',
          postCentrifugationDelay: 'A',
          longTermStorage: 'C',
        },
      });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.data).toMatchObject({
      input_status: 'invalid',
      governance_status: null,
      final_grade: null,
      grade_route: 'Invalid input',
    });
    expect(response.body.data.input_errors).toContain('Explicit governance evidence is required');
  });

  it('retorna Grade E por falha de governanca sem calcular score', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        matrixType: 'solid',
        governanceEvidence: admissibleGovernanceEvidence(),
        sprec: {
          matrixType: 'solid',
          sampleType: 'TIS',
          collectionType: 'SRG',
          warmIschemia: 'X',
          coldIschemia: 'A',
          fixationType: 'SNP',
          fixationTime: 'B',
          longTermStorage: 'C',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      model_version: 'RCS-GOV-1.0',
      matrix_type: 'solid',
      governance_status: 0,
      p_bio: null,
      rcs_score: null,
      score_based_grade: null,
      final_grade: 'E',
      grade_route: 'Governance failure',
      axis_penalties: [],
    });
    expect(response.body.data.governance_failure_reasons.length).toBeGreaterThan(0);
    expect(response.body.data.axis_penalties).toEqual([]);
    expect(response.body.data).not.toHaveProperty('quality_category');
  });
});
