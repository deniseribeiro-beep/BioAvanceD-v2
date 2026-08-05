
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const LineageRepository = require('../../src/infrastructure/database/neo4j/LineageRepository');
const auditLogger = require('../../src/utils/auditLogger');
const sessionService = require('../../src/services/session.service');
const env = require('../../src/config/env');
const { buildRbacCollections } = require('../factories/rbac.factory');

function createAuthToken() {
  return jwt.sign(
    {
      id: 'qa-user-2',
      userID: 'qa-user-2',
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
    locationID: 101,
    linkedProject: 'Projeto QA Modos',
    ...overrides,
  };
}

describe('POST /api/samples - matriz STRICT/PERMISSIVE e contrato de resposta', () => {
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
    const rbacCollections = buildRbacCollections([{ userAccountId: 'qa-user-2', accessType: 2 }]);
    app.locals.db = {
      collection: (name) => rbacCollections[name] || genericCollection,
    };
    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;
    app.locals.topologicalQuarantine = null;

    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439012',
      patientID: '12345678',
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
    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockResolvedValue({ eventId: 'evt-contract-1' });

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: true }));

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.partialSuccess).toBe('boolean');
    expect(response.body.partialSuccess).toBe(false);
    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data.sampleID).toBe('string');
    expect(response.body.data.patientID).toBe('12345678');
    expect(['STRICT', 'PERMISSIVE']).toContain(response.body.data.operationMode);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(typeof response.body.data.topology.synced).toBe('boolean');
    expect(typeof response.body.data.topology.fallbackQueued).toBe('boolean');
  });

  it('deve operar em PERMISSIVE com fallback e sucesso parcial (202)', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskLevel: 'low', riskScore: 2 }));

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(true);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(true);
    expect(enqueueTopologicalTransaction).toHaveBeenCalledTimes(1);
  });

  it('deve bloquear em STRICT por riskScore alto quando Neo4j falha (403)', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskScore: 9 }));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('STRICT_MODE_BLOCKED');
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  it('deve bloquear em fail-closed mesmo sem marcadores de risco (403)', async () => {
    env.LINEAGE_MODE = 'fail-closed';

    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(buildPayload({ isRareDisease: false, riskLevel: 'low', riskScore: 1 }));

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('STRICT_MODE_BLOCKED');
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  it('deve permanecer 201 sem partialSuccess quando quarentena não está disponível', async () => {
    app.locals.topologicalQuarantine = null;
    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

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
