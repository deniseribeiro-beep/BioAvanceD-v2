
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
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


const consentTemplateId = new ObjectId().toString();

function createCoordinatorToken() {
  return makeAuthToken(3);
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

  function createDbMock(patientsCollection) {
    const rbacCollections = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[3], accessType: 3 }]);
    return {
      collection: (name) => {
        if (name === 'participants' || name === 'pacientes') {
          return patientsCollection;
        }
        if (rbacCollections[name]) {
          return rbacCollections[name];
        }
        if (name === 'consentTemplates' || name === 'consent_templates') {
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
      // RF005/RNF007 (#575): identityDocument conflicts are now resolved via
      // ParticipantIdentity (generic mock branch in createDbMock, always
      // null) — this collection only still owns the recordNumber check.
      findOne: vi.fn().mockImplementation(async (query) => {
        if (query && query.recordNumber) {
          return {
            _id: 'existing-patient-1',
            participantId: '12345678',
            recordNumber: 'PRONT-DUP-01',
          };
        }
        if (query && query.participantId) return null;
        return null;
      }),
      find: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      }),
      countDocuments: vi.fn().mockResolvedValue(0),
      insertOne,
      updateOne: vi.fn(),
    };

    app.locals.db = createDbMock(patientsCollection);

    const response = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${createCoordinatorToken()}`)
      .send(buildValidPatientPayload({ recordNumber: 'PRONT-DUP-01' }));

    expect([409, 400]).toContain(response.status);
    expect(response.body.success).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();
  });
});
