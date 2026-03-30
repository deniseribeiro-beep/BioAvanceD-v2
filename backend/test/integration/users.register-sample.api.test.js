
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

function buildPayload(overrides = {}) {
  return {
    patientID: '12345678',
    sampleType: 'Sangue',
    sampleOrigin: 'Coleta',
    extractionProtocol: 'Protocolo A',
    quantity: 1,
    quality: 1,
    registerDate: new Date().toISOString(),
    locationID: 101,
    linkedProject: 'Projeto QA Rota Usuário',
    ...overrides,
  };
}

describe('POST /api/users/register-sample - paridade de contrato com /api/samples', () => {
  let previousLineageMode;

  beforeEach(() => {
    previousLineageMode = env.LINEAGE_MODE;
    env.LINEAGE_MODE = 'fail-open';

    app.locals.db = {
      collection: (name) => {
        if (name === 'samples' || name === 'amostras') {
          return {
            deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }

        if (name === 'users') {
          return {
            findOne: vi.fn().mockResolvedValue({ anonId: 'anon-user-qa' }),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'user-1' }),
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
          };
        }

        if (name === 'logs') {
          return {
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-qa' }),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
            deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
          };
        }

        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'generic' }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        };
      },
    };

    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;
    app.locals.topologicalQuarantine = null;

    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439013',
      patientID: '12345678',
      sampleType: 'Sangue',
      barcode: 'BR-TEST-0003',
    });

    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'test-session-3' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'test-session-3' });
  });

  afterEach(() => {
    env.LINEAGE_MODE = previousLineageMode;
    vi.restoreAllMocks();
    app.locals.topologicalQuarantine = null;
    app.locals.neo4jQuarantineService = null;
  });

  it('deve retornar contrato observável em PERMISSIVE com fallback (202)', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/users/register-sample')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskScore: 1 }));

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(true);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(true);
    expect(typeof response.body.data.sampleID).toBe('string');
  });

  it('deve bloquear em STRICT_MODE_BLOCKED na rota alternativa (403)', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/users/register-sample')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: true }));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('STRICT_MODE_BLOCKED');
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });
});
