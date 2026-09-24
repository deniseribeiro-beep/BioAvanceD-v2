
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const sessionService = require('../../src/services/session.service');
const env = require('../../src/config/env');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildSamplePayload } = require('../factories/sample.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


function createAuthToken() {
  return makeAuthToken(2);
}

describe('POST /api/users/register-sample - paridade de contrato com /api/samples', () => {
  let previousLineageMode;

  let patientsCollectionMock;

  function givenAppDbCollections() {
    patientsCollectionMock = createCollectionMock();
    app.locals.db = createDbMock({
      specimens: createCollectionMock({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
      }),
      amostras: createCollectionMock({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
      }),
      userAccounts: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ anonId: 'anon-user-qa' }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'user-1' }),
      }),
      logs: createCollectionMock({
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-qa' }),
      }),
      participants: patientsCollectionMock,
      ...buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[2], accessType: 2 }]),
    });
  }

  function givenAuthenticatedSession() {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'test-session-3' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'test-session-3' });
  }

  function givenSampleServiceResult() {
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439013',
      specimenId: 'SPEC-USER-0003',
      participantId: '12345678',
      sampleType: 'Sangue',
      barcode: 'BR-TEST-0003',
    });
  }

  async function whenRegisterSample(payload) {
    return request(app)
      .post('/api/users/register-sample')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(payload);
  }

  beforeEach(() => {
    previousLineageMode = env.LINEAGE_MODE;
    env.LINEAGE_MODE = 'fail-open';
    givenAppDbCollections();

    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;
    app.locals.topologicalQuarantine = null;
    givenSampleServiceResult();
    givenAuthenticatedSession();
  });

  afterEach(() => {
    env.LINEAGE_MODE = previousLineageMode;
    vi.restoreAllMocks();
    app.locals.topologicalQuarantine = null;
    app.locals.neo4jQuarantineService = null;
  });

  it('deve retornar contrato PERMISSIVE com projeção assíncrona (201)', async () => {
    // Given
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    // When
    const response = await whenRegisterSample(
      buildSamplePayload({
        linkedProject: 'Projeto QA Rota Usuário',
        isRareDisease: false,
        riskScore: 1,
      })
    );

    // Then
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(false);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
    expect(typeof response.body.data.specimenId).toBe('string');
    expect(patientsCollectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('deve manter sucesso STRICT na rota alternativa sem write gate de projeção', async () => {
    // Given
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    // When
    const response = await whenRegisterSample(
      buildSamplePayload({
        linkedProject: 'Projeto QA Rota Usuário',
        isRareDisease: true,
      })
    );

    // Then
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });
});
