import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const sampleService = require('../../src/services/sample.service');
const LineageRepository = require('../../src/infrastructure/database/neo4j/LineageRepository');

function createTechnicianToken() {
  return jwt.sign(
    {
      userID: 'qa-tech-1',
      accessType: 2,
      roleName: 'Técnico',
      name: 'QA Técnico',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function buildValidSamplePayload(overrides = {}) {
  return {
    patientID: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 1,
    quality: 'GOOD',
    linkedProject: 'Projeto QA RNF011',
    registerDate: new Date().toISOString(),
    locationID: 101,
    ...overrides,
  };
}

describe('RF004/RNF011 - POST /api/samples validações de integridade', () => {
  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-sample-validation-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-sample-validation-1' });
    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockResolvedValue({ eventId: 'evt-validation-1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve barrar vínculo obrigatório quando patientID não existe (404 ou 400)', async () => {
    app.locals.db = {
      collection: (name) => {
        if (name === 'patients' || name === 'pacientes') {
          return {
            findOne: vi.fn().mockResolvedValue(null),
          };
        }

        if (name === 'locations') {
          return {
            findOne: vi.fn().mockResolvedValue({ locationID: 101 }),
          };
        }

        if (name === 'samples' || name === 'amostras') {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
          };
        }

        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
        };
      },
    };

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createTechnicianToken()}`)
      .send(buildValidSamplePayload({ patientID: '99999999' }));

    expect([404, 400]).toContain(response.status);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message || '').length).toBeGreaterThan(0);
  });

  it('deve rejeitar tipagem inválida antes de tocar no banco (422 ou 400)', async () => {
    const touchedCollections = [];
    const dbCollection = vi.fn((name) => {
      touchedCollections.push(name);
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([]),
        }),
        countDocuments: vi.fn().mockResolvedValue(0),
      };
    });

    app.locals.db = {
      collection: dbCollection,
    };

    const createSampleSpy = vi.spyOn(sampleService, 'createSample');

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createTechnicianToken()}`)
      .send(buildValidSamplePayload({
        sampleType: undefined,
        isRareDisease: 'sim',
      }));

    expect([422, 400]).toContain(response.status);
    expect(response.body.success).toBe(false);
    expect(createSampleSpy).not.toHaveBeenCalled();
    expect(touchedCollections).not.toContain('samples');
    expect(touchedCollections).not.toContain('amostras');
  });
});
