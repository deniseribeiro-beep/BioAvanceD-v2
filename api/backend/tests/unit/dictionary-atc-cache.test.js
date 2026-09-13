import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');

function createToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function createTechnicianToken() {
  return createToken({
    userID: 'qa-dict-tech-1',
    accessType: 2,
    roleName: 'Tecnico',
    mfaVerified: true,
  });
}

function cursor(rows) {
  return {
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function createMockDb({ localRows = [], count = 1 } = {}) {
  const medicationDictionary = {
    estimatedDocumentCount: vi.fn().mockResolvedValue(count),
    createIndex: vi.fn().mockResolvedValue('ok'),
    bulkWrite: vi.fn().mockResolvedValue({ upsertedCount: 0 }),
    find: vi.fn().mockReturnValue(cursor(localRows)),
    findOne: vi.fn().mockResolvedValue(localRows[0] || null),
  };

  const auditLogs = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'audit-1' }),
  };

  const genericCollection = {
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'x' }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    createIndex: vi.fn().mockResolvedValue('ok'),
    estimatedDocumentCount: vi.fn().mockResolvedValue(0),
    bulkWrite: vi.fn().mockResolvedValue({ upsertedCount: 0 }),
    find: vi.fn().mockReturnValue(cursor([])),
  };

  const db = {
    collection: vi.fn((name) => {
      if (name === 'medication_dictionary') return medicationDictionary;
      if (name === 'logs' || name === 'audit_logs') return auditLogs;
      return genericCollection;
    }),
  };

  return { db, medicationDictionary, auditLogs };
}

describe('Dictionary Service - ATC/ChEMBL Fallback and Caching', () => {
  beforeEach(() => {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
      valid: true,
      session: { sessionID: 'session-dict-test-1' },
    });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({
      sessionID: 'session-dict-test-1',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        molecules: [
          {
            pref_name: 'Migalastat',
            atc_classifications: ['A16AX14'],
          },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('usa cache local quando medicamento ja existe', async () => {
    const technicianToken = createTechnicianToken();
    const { db, medicationDictionary } = createMockDb({
      localRows: [
        {
          generic_name: 'Aspirin',
          name: 'Aspirin',
          atc_code: 'B01AC06',
          atc_level_1: 'B',
          code: 'ATC:B01AC06',
          source: 'LOCAL',
          active: true,
        },
      ],
    });

    app.locals.db = db;

    const response = await request(app)
      .get('/api/dictionary/atc/search')
      .query({ q: 'Aspirin' })
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(response.status).toBe(200);
    expect(medicationDictionary.find).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(Array.isArray(response.body.medications)).toBe(true);
    expect(response.body.medications.length).toBeGreaterThan(0);
  });

  it('em modo offline padrao, nao aciona fallback remoto quando cache local esta vazio', async () => {
    const technicianToken = createTechnicianToken();
    const { db, medicationDictionary } = createMockDb({ localRows: [] });

    app.locals.db = db;

    const response = await request(app)
      .get('/api/dictionary/atc/search')
      .query({ q: 'Migalastat' })
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(response.status).toBe(200);
    expect(medicationDictionary.find).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(medicationDictionary.bulkWrite).not.toHaveBeenCalled();
    expect(Array.isArray(response.body.medications)).toBe(true);
  });

  it('retorna 400 quando query esta ausente', async () => {
    const technicianToken = createTechnicianToken();
    const { db } = createMockDb();

    app.locals.db = db;

    const response = await request(app)
      .get('/api/dictionary/atc/search')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(response.status).toBe(400);
  });

  it('retorna 503 quando database nao foi inicializado', async () => {
    const technicianToken = createTechnicianToken();
    app.locals.db = null;

    const response = await request(app)
      .get('/api/dictionary/atc/search')
      .query({ q: 'Aspirin' })
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(response.status).toBe(503);
  });
});
