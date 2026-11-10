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
      roleName: 'Tecnico',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('POST /api/quality/preview RCS-GOV 1.0', () => {
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

  it('mantem a rota existente e retorna decisao exclusivamente RCS-GOV A-E', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
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

  // RNF018 AC5 (#1524): presented evidence references are resolved
  // against the stored records before certification.
  describe('governanceEvidence (RNF018 AC5, #1524)', () => {
    const { COLLECTION_NAME } = require('../../src/services/neo4jOutbox.service');
    const hex = (digit) => digit.repeat(64);
    const SPRECS = {
      matrixType: 'fluid',
      sampleType: 'BLD',
      primaryContainer: 'SST',
      preCentrifugation: 'C',
      centrifugation: 'A',
      secondCentrifugation: 'A',
      postCentrifugationDelay: 'A',
      longTermStorage: 'C',
    };
    const STORES = {
      samples: [{ _id: 'mongo-sample-1', specimenId: 'SPC-PREVIEW-1' }],
      [COLLECTION_NAME]: [{ eventId: 'evt-1', eventType: 'CUSTODY_EVENT_RECORDED', aggregateType: 'Sample', aggregateId: 'mongo-sample-1', payloadHash: hex('1') }],
      telemetryExposureSummaries: [{ telemetryExposureSummaryId: 'tes-1', specimenId: 'SPC-PREVIEW-1', sourceReadingSetHash: `sha256:${hex('2')}` }],
      collectionGovernanceApprovals: [{ approvalId: 'apr-1', documentChecksum: `sha256:${hex('3')}` }],
    };
    const evidence = () => ({
      traceability: [{ uri: 'urn:bioavanced:custody-event:evt-1', hash: `sha256:${hex('1')}` }],
      monitoring: [{ uri: 'urn:bioavanced:telemetry-exposure-summary:tes-1', hash: `sha256:${hex('2')}` }],
      documentation: [{ uri: 'urn:bioavanced:collection-governance-approval:apr-1', hash: `sha256:${hex('3')}` }],
    });

    beforeEach(() => {
      app.locals.db = {
        collection: (name) => ({
          findOne: vi.fn(async (filter) => (STORES[name] || [])
            .find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) || null),
          createIndex: vi.fn().mockResolvedValue('ok'),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit-1' }),
        }),
      };
    });

    const preview = (governanceEvidence) => request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({ sprec: SPRECS, specimenId: 'SPC-PREVIEW-1', governanceEvidence });

    it('reads the three evidence criteria true when every reference resolves', async () => {
      const response = await preview(evidence());
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ governance_status: 1, final_grade: 'A', grade_route: 'Score-based certification' });
      expect(response.body.data.governance_evidence).toMatchObject({
        traceabilityOk: true, monitoringOk: true, documentationOk: true, semanticCompatible: null, gateResult: null,
      });
      // RNF018 AC5 (#1524), V2E-0532: the URIs of the resolved references.
      expect(response.body.data.governance_evidence.evidenceRefs).toEqual([
        'urn:bioavanced:custody-event:evt-1',
        'urn:bioavanced:telemetry-exposure-summary:tes-1',
        'urn:bioavanced:collection-governance-approval:apr-1',
      ]);
    });

    it('refuses certification when a reference is missing its hash', async () => {
      const governanceEvidence = evidence();
      delete governanceEvidence.documentation[0].hash;
      const response = await preview(governanceEvidence);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        governance_status: 0,
        final_grade: 'E',
        grade_route: 'Governance failure',
        governance_failure_reasons: ['Insufficient documentation'],
        governance_rule_codes: ['INSUFFICIENT_DOCUMENTATION'],
      });
      expect(response.body.data.governance_evidence).toMatchObject({
        traceabilityOk: true, monitoringOk: true, documentationOk: false, gateResult: 'fail',
      });
      // RNF018 AC5 (#1524), V2E-0532: the reference missing its hash is left out.
      expect(response.body.data.governance_evidence.evidenceRefs).toEqual([
        'urn:bioavanced:custody-event:evt-1',
        'urn:bioavanced:telemetry-exposure-summary:tes-1',
      ]);
    });
  });

  it('retorna Grade E por falha de governanca sem calcular score', async () => {
    const response = await request(app)
      .post('/api/quality/preview')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        matrixType: 'solid',
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
