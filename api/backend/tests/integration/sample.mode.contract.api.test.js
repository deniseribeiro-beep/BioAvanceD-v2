
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const auditLogger = require('../../src/utils/auditLogger');
const sessionService = require('../../src/services/session.service');
const env = require('../../src/config/env');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function createAuthToken() {
  return jwt.sign(
    {
      id: TEST_USER_ACCOUNT_IDS[2],
      userID: TEST_USER_ACCOUNT_IDS[2],
      accessType: 2,
      roleName: 'Técnico',
      name: 'QA User 2',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function buildPayload(overrides = {}) {
  return {
    participantId: '12345678',
    sampleType: 'PLASMA', // valid MIABIS ID
    sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
    extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
    quantity: 1,
    quality: 'GOOD', // valid MIABIS ID
    registeredAt: new Date().toISOString(),
    boxId: '507f1f77bcf86cd799439011',
    positionCode: 'A1',
    linkedProject: 'Projeto QA Modos',
    ...overrides,
  };
}

describe('POST /api/samples - matriz de risco e contrato de projeção assíncrona v2', () => {
  let previousLineageMode;

  beforeEach(() => {
    previousLineageMode = env.LINEAGE_MODE;
    env.LINEAGE_MODE = 'fail-open';

    const genericCollection = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-2' }),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    };
    const rbacCollections = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 }]);
    app.locals.db = {
      collection: (name) => rbacCollections[name] || genericCollection,
    };
    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;
    app.locals.topologicalQuarantine = null;

    // #795: this mock used to return `patientID`, which the real
    // createSample never emits -- SampleModel.create writes `participantId`
    // and Sample.js does not declare `patientID`. The invented field is what
    // kept the handler's three `sample.patientID` reads green while every one
    // of them was undefined in production. Same blindness class as #797.
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439012',
      specimenId: 'SPEC-MODE-1',
      participantId: '12345678',
      sampleType: 'Sangue',
      barcode: 'BR-TEST-0002',
    });

    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'test-session-2' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'test-session-2' });

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
  });

  afterEach(() => {
    env.LINEAGE_MODE = previousLineageMode;
    vi.restoreAllMocks();
    app.locals.topologicalQuarantine = null;
    app.locals.neo4jQuarantineService = null;
  });

  it('deve manter contrato de resposta no sucesso STRICT (201)', async () => {

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: true }));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.partialSuccess).toBe('boolean');
    expect(response.body.partialSuccess).toBe(false);
    expect(response.body.data).toBeDefined();
    expect(response.body.data.specimenId).toBe('SPEC-MODE-1');
    expect(response.body.data).not.toHaveProperty('sampleID');
    expect(response.body.data.participantId).toBe('12345678');
    expect(['STRICT', 'PERMISSIVE']).toContain(response.body.data.operationMode);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(typeof response.body.data.topology.synced).toBe('boolean');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
  });

  it('deve operar em PERMISSIVE com sucesso operacional e projeção via outbox (201)', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskLevel: 'low', riskScore: 2 }));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(false);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  it('deve manter sucesso operacional STRICT para riskScore alto (201)', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskScore: 9 }));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  it('deve resolver fail-closed como modo STRICT sem acoplar a escrita à projeção', async () => {
    env.LINEAGE_MODE = 'fail-closed';

    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskLevel: 'low', riskScore: 1 }));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  it('deve permanecer 201 sem partialSuccess independentemente de quarentena legada', async () => {
    app.locals.topologicalQuarantine = null;

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskLevel: 'low', riskScore: 1 }));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(false);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
  });
});
