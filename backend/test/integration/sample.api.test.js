
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

function createAuthToken() {
  return jwt.sign(
    {
      id: 'qa-user-1',
      userID: 'qa-user-1',
      accessType: 2,
      roleName: 'Técnico',
      name: 'QA User',
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('POST /api/samples - Smart Blocking e Topological Quarantine', () => {
  beforeEach(() => {
    app.locals.db = {
      collection: () => ({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    };
    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;

    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      patientID: '12345678',
      sampleType: 'Sangue',
      barcode: 'BR-TEST-0001',
    });

    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'test-session' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'test-session' });

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.topologicalQuarantine = null;
    app.locals.neo4jQuarantineService = null;
  });

  it('Teste 1 (Smart Blocking): retorna operationMode STRICT quando isRareDisease=true', async () => {
    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockResolvedValue({ eventId: 'evt-1' });

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        patientID: '12345678',
        sampleType: 'PLASMA', // valid MIABIS ID
        sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
        extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
        quantity: 1,
        quality: 'GOOD', // valid MIABIS ID
        registerDate: new Date().toISOString(),
        locationID: 101,
        linkedProject: 'Projeto QA',
        isRareDisease: true,
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(response.body.data.topology.synced).toBe(true);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
  });

  it('Teste 2 (Topological Quarantine): em falha Neo4j, enfileira no Redis e retorna sucesso parcial', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        patientID: '12345678',
        sampleType: 'PLASMA', // valid MIABIS ID
        sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
        extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
        quantity: 1,
        quality: 'GOOD', // valid MIABIS ID
        registerDate: new Date().toISOString(),
        locationID: 101,
        linkedProject: 'Projeto QA',
        isRareDisease: false,
      });

    expect([201, 202]).toContain(response.status);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(true);
    expect(enqueueTopologicalTransaction).toHaveBeenCalledTimes(1);
  });

  it('Teste 3 (STRICT_MODE_BLOCKED): em Doença Rara com Neo4j offline, deve bloquear com HTTP 403', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        patientID: '12345678',
        sampleType: 'PLASMA', // valid MIABIS ID
        sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
        extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
        quantity: 1,
        quality: 'GOOD', // valid MIABIS ID
        registerDate: new Date().toISOString(),
        locationID: 101,
        linkedProject: 'Projeto QA',
        isRareDisease: true,
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('STRICT_MODE_BLOCKED');
    expect(String(response.body.message || '')).toContain('STRICT_MODE_BLOCKED');
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });
});
