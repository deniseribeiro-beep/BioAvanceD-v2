
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const LineageRepository = require('../../src/infrastructure/database/neo4j/LineageRepository');
const sessionService = require('../../src/services/session.service');
const env = require('../../src/config/env');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildSamplePayload } = require('../factories/sample.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function createAuthToken() {
  return jwt.sign(
    {
      id: 'qa-user-3',
      userID: 'qa-user-3',
      accessType: 2,
      roleName: 'Técnico',
      name: 'QA User 3',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('POST /api/users/register-sample - paridade de contrato com /api/samples', () => {
  let previousLineageMode;

  let patientsCollectionMock;

  function givenAppDbCollections() {
    patientsCollectionMock = createCollectionMock();
    app.locals.db = createDbMock({
      samples: createCollectionMock({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
      }),
      amostras: createCollectionMock({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
      }),
      users: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ anonId: 'anon-user-qa' }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'user-1' }),
      }),
      logs: createCollectionMock({
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-qa' }),
      }),
      patients: patientsCollectionMock,
      ...buildRbacCollections([{ userAccountId: 'qa-user-3', accessType: 2 }]),
    });
  }

  function givenAuthenticatedSession() {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'test-session-3' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'test-session-3' });
  }

  function givenSampleServiceResult() {
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439013',
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

  it('deve retornar contrato observável em PERMISSIVE com fallback (202)', async () => {
    // Given
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    // When
    const response = await whenRegisterSample(
      buildSamplePayload({
        linkedProject: 'Projeto QA Rota Usuário',
        isRareDisease: false,
        riskScore: 1,
      })
    );

    // Then
    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(true);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(true);
    expect(typeof response.body.data.sampleID).toBe('string');
    expect(patientsCollectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('deve bloquear em STRICT_MODE_BLOCKED na rota alternativa (403)', async () => {
    // Given
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    // When
    const response = await whenRegisterSample(
      buildSamplePayload({
        linkedProject: 'Projeto QA Rota Usuário',
        isRareDisease: true,
      })
    );

    // Then
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('STRICT_MODE_BLOCKED');
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });
});
