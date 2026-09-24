
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sampleService = require('../../src/services/sample.service');
const auditLogger = require('../../src/utils/auditLogger');
const sessionService = require('../../src/services/session.service');
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
      id: TEST_USER_ACCOUNT_IDS[4],
      userID: TEST_USER_ACCOUNT_IDS[4],
      accessType: 2,
      roleName: 'Técnico',
      name: 'QA User',
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('POST /api/samples - modo de risco e projeção assíncrona v2', () => {
  beforeEach(() => {
    const genericCollection = {
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-1' }),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    };
    const rbacCollections = buildRbacCollections([{ userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 2 }]);
    app.locals.db = {
      collection: (name) => rbacCollections[name] || genericCollection,
    };
    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;

    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      participantId: '12345678',
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

  it('retorna operationMode STRICT sem transformar a projeção derivada em write gate', async () => {

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        participantId: '12345678',
        sampleType: 'PLASMA', // valid MIABIS ID
        sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
        extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
        quantity: 1,
        quality: 'GOOD', // valid MIABIS ID
        registeredAt: new Date().toISOString(),
        boxId: '507f1f77bcf86cd799439011',
        positionCode: 'A1',
        linkedProject: 'Projeto QA',
        isRareDisease: true,
        pharmacology_data: {
          treatment_status: 'ON_TREATMENT',
          drug_name: 'Migalastat',
          atc_code: 'A16AX27',
          atc_level_1: 'A',
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
  });

  it('mantém sucesso PERMISSIVE enquanto a projeção derivada segue pelo outbox', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        participantId: '12345678',
        sampleType: 'PLASMA', // valid MIABIS ID
        sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
        extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
        quantity: 1,
        quality: 'GOOD', // valid MIABIS ID
        registeredAt: new Date().toISOString(),
        boxId: '507f1f77bcf86cd799439011',
        positionCode: 'A1',
        linkedProject: 'Projeto QA',
        isRareDisease: false,
        pharmacology_data: {
          treatment_status: 'NAIVE',
          drug_name: 'Amiodarone',
          atc_code: 'C01BD01',
          atc_level_1: 'C',
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  it('mantém sucesso STRICT sem rollback operacional por indisponibilidade da projeção', async () => {
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    const response = await request(app)
      .post('/api/samples')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send({
        participantId: '12345678',
        sampleType: 'PLASMA', // valid MIABIS ID
        sampleOrigin: 'VENOUS_BLOOD', // valid MIABIS ID
        extractionProtocol: 'TUBE_EDTA', // valid MIABIS ID
        quantity: 1,
        quality: 'GOOD', // valid MIABIS ID
        registeredAt: new Date().toISOString(),
        boxId: '507f1f77bcf86cd799439011',
        positionCode: 'A1',
        linkedProject: 'Projeto QA',
        isRareDisease: true,
        pharmacology_data: {
          treatment_status: 'TREATED',
          drug_name: 'Ataluren',
          atc_code: 'A16AX27',
          atc_level_1: 'A',
        },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.operationMode).toBe('STRICT');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(false);
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });

  // #795: the handler read `sample.patientID` at three sites. Nothing writes
  // that field -- SampleModel.create emits `participantId` and Sample.js does
  // not declare `patientID` -- so all three were `undefined`. The audit sites
  // are the ones that matter: RF004's whole point is an audit trail, and an
  // audit row reading "Paciente ID: undefined" is not recoverable after the
  // fact (unlike #788's list badge, there is no live recomputation to fall
  // back on).
  //
  // `patientID` is on canonical-data-contract-v1.md's "Legacy Fields
  // Prohibited" list, and validateCreateSamplePayload already 422s a *request*
  // carrying it -- so the canonical name is used on the way out too, not just
  // the canonical value.
  describe('#795: RF004 audit trail and 201 body carry the participant identifier', () => {
    async function createSample() {

      return request(app)
        .post('/api/samples')
        .set('Authorization', `Bearer ${createAuthToken()}`)
        .send({
          participantId: '12345678',
          sampleType: 'PLASMA',
          sampleOrigin: 'VENOUS_BLOOD',
          extractionProtocol: 'TUBE_EDTA',
          quantity: 1,
          quality: 'GOOD',
          registeredAt: new Date().toISOString(),
          boxId: '507f1f77bcf86cd799439011',
          positionCode: 'A1',
          linkedProject: 'Projeto QA',
        });
    }

    it('writes the participant id into the audit message, not the string "undefined"', async () => {
      const response = await createSample();
      expect(response.status).toBe(201);

      const entry = auditLogger.log.mock.calls.find(([arg]) => arg?.action === 'sample_create')?.[0];
      expect(entry).toBeTruthy();
      expect(entry.message).toContain('12345678');
      expect(entry.message).not.toContain('undefined');
    });

    it('carries the participant id in the audit payload under its canonical name', async () => {
      const response = await createSample();
      expect(response.status).toBe(201);

      const entry = auditLogger.log.mock.calls.find(([arg]) => arg?.action === 'sample_create')?.[0];
      expect(entry.payload.participantId).toBe('12345678');
      // The prohibited alias must not come back in through the audit payload.
      expect(entry.payload).not.toHaveProperty('patientID');
    });

    it('returns the participant id in the 201 body', async () => {
      const response = await createSample();

      expect(response.status).toBe(201);
      expect(response.body.data.participantId).toBe('12345678');
      expect(response.body.data).not.toHaveProperty('patientID');
    });
  });
});
