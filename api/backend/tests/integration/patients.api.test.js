
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const notificationService = require('../../src/services/notification.service');
const { buildRbacCollections } = require('../factories/rbac.factory');

const consentTemplateId = new ObjectId().toString();

function createCoordinatorToken() {
  return jwt.sign(
    {
      userID: 'qa-coord-1',
      accessType: 3,
      roleName: 'Coordenador',
      name: 'QA Coordenador',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function buildValidPatientPayload(overrides = {}) {
  return {
    participantId: '12345678',
    patientName: 'Paciente QA Integração',
    birthDate: '1990-01-20',
    sex: 'F',
    email: 'paciente.qa@example.test',
    consentTemplateId,
    recordNumber: 'PRONT-0001',
    identityDocument: '52998224725',
    clinicalUnit: 'Genética',
    ...overrides,
  };
}

describe('RF005 - POST /api/v1/patients', () => {
  beforeEach(() => {
    app.locals.db = null;
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-rf005-1' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-rf005-1' });
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);

    vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
    vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    app.locals.db = null;
  });

  function createDbMock(patientsCollection, collections = {}) {
    const rbacCollections = buildRbacCollections([{ userAccountId: 'qa-coord-1', accessType: 3 }]);
    return {
      collection: (name) => {
        if (name === 'patients' || name === 'pacientes') {
          return patientsCollection;
        }
        if (collections[name]) {
          return collections[name];
        }
        if (rbacCollections[name]) {
          return rbacCollections[name];
        }
        if (name === 'consent_templates') {
          return {
            findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(consentTemplateId), name: 'TCLE QA' }),
            insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
            updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
            find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockResolvedValue({ insertedId: 'ignored' }),
          updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
          createIndex: vi.fn().mockResolvedValue('idx'),
          dropIndex: vi.fn().mockResolvedValue(undefined),
          find: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([]),
          }),
          countDocuments: vi.fn().mockResolvedValue(0),
        };
      },
    };
  }

  it('deve criar paciente com sucesso para payload válido', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const patientsCollection = {
      createIndex: vi.fn().mockResolvedValue('idx'),
      dropIndex: vi.fn().mockResolvedValue(undefined),
      findOne: vi.fn().mockImplementation(async (query) => {
        if (query && query.participantId) return null;
        if (query && query.$or) return null;
        return null;
      }),
      find: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
      insertOne,
      updateOne,
    };

    app.locals.db = createDbMock(patientsCollection);

    const response = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`)
      .send(buildValidPatientPayload());

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.participantId).toMatch(/^\d{8}$/);
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it('deve retornar 409 (ou 400) ao tentar cadastrar CPF ou prontuário já existente', async () => {
    const insertOne = vi.fn();

    const patientsCollection = {
      createIndex: vi.fn().mockResolvedValue('idx'),
      dropIndex: vi.fn().mockResolvedValue(undefined),
      // RF005/RNF007 (#575): identityDocument conflicts are resolved via
      // ParticipantIdentity. #1386: so is the recordNumber check (P1X-0355,
      // recordNumberHash), so this collection holds no number.
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
      insertOne,
      updateOne: vi.fn(),
    };

    const participantIdentities = {
      findOne: vi.fn().mockImplementation(async (query) => (
        query && query.recordNumberHash ? { participantId: '12345678' } : null
      )),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      createIndex: vi.fn().mockResolvedValue('idx'),
    };

    app.locals.db = createDbMock(patientsCollection, { participantIdentities });

    const response = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`)
      .send(buildValidPatientPayload({ recordNumber: 'PRONT-DUP-01' }));

    expect([409, 400]).toContain(response.status);
    expect(response.body.success).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();
  });
});
