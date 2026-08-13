import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

const RBAC_TEST_USERS = [
  { userAccountId: 'qa-admin-1', accessType: 4 },
  { userAccountId: 'qa-coord-1', accessType: 3 },
];

function dbWithRbac(collections = {}) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections(RBAC_TEST_USERS),
  });
}

/**
 * MÓDULO: Reidentificação de participante (RF005/RNF007 AC#4/AC#5, #560)
 *
 * ENDPOINTS COBERTOS:
 * - POST /api/patients/:id/reidentify - resolve identidade civil a partir
 *   de ParticipantIdentity, via fluxo autorizado e auditado.
 */

function createAdminToken() {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType: 4, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function createCoordinatorToken() {
  return jwt.sign(
    { userID: 'qa-coord-1', accessType: 3, roleName: 'Coordenador', name: 'QA Coordenador', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function setupMocks() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
    valid: true,
    session: { sessionID: 'session-test-1', userID: 'qa-admin-1' },
  });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-test-1' });
  vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
}

describe('🔐 Reidentificação de participante - Testes de Integracao', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/patients/:id/reidentify', () => {
    it('Given: administrador autenticado com motivo | When: reidentifica | Then: retorna 200 com identidade civil e audita o acesso', async () => {
      const patient = { participantId: '12345678', status: 'ACTIVE' };
      const identity = {
        participantId: '12345678',
        patientName: 'Paciente QA Teste',
        birthDate: new Date('1990-01-20'),
        identityDocument: '11144477735',
      };

      const patientsCollection = { findOne: vi.fn().mockResolvedValue(patient) };
      const participantIdentitiesCollection = { findOne: vi.fn().mockResolvedValue(identity) };

      app.locals.db = dbWithRbac({
        patients: patientsCollection,
        participantIdentities: participantIdentitiesCollection,
      });

      const response = await request(app)
        .post('/api/patients/12345678/reidentify')
        .set('Authorization', `Bearer ${createAdminToken()}`)
        .send({ reason: 'Notificação de resultado crítico ao participante' });

      expect(response.status).toBe(200);
      expect(response.body.data.patientName).toBe('Paciente QA Teste');
      expect(response.body.data.identityDocument).toBe('11144477735');

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REIDENTIFY',
          resourceType: 'ParticipantIdentity',
          resourceId: '12345678',
          status: 'success',
          payload: expect.objectContaining({ reason: 'Notificação de resultado crítico ao participante' }),
        })
      );
    });

    it('Given: administrador sem motivo informado | When: reidentifica | Then: retorna 400 e não acessa a identidade', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }) };
      const participantIdentitiesCollection = { findOne: vi.fn().mockResolvedValue(null) };

      app.locals.db = dbWithRbac({
        patients: patientsCollection,
        participantIdentities: participantIdentitiesCollection,
      });

      const response = await request(app)
        .post('/api/patients/12345678/reidentify')
        .set('Authorization', `Bearer ${createAdminToken()}`)
        .send({});

      expect(response.status).toBe(400);
      expect(participantIdentitiesCollection.findOne).not.toHaveBeenCalled();
    });

    it('Given: coordenador sem permissão de reidentificação | When: reidentifica | Then: retorna 403', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }) };
      const participantIdentitiesCollection = { findOne: vi.fn().mockResolvedValue(null) };

      app.locals.db = dbWithRbac({
        patients: patientsCollection,
        participantIdentities: participantIdentitiesCollection,
      });

      const response = await request(app)
        .post('/api/patients/12345678/reidentify')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send({ reason: 'Tentativa não autorizada' });

      expect(response.status).toBe(403);
      expect(participantIdentitiesCollection.findOne).not.toHaveBeenCalled();
    });

    it('Given: participantId inexistente | When: reidentifica | Then: retorna 404', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue(null) };

      app.locals.db = dbWithRbac({ patients: patientsCollection });

      const response = await request(app)
        .post('/api/patients/00000000/reidentify')
        .set('Authorization', `Bearer ${createAdminToken()}`)
        .send({ reason: 'Investigação de incidente' });

      expect(response.status).toBe(404);
    });

    it('Given: paciente sem registro em ParticipantIdentity | When: reidentifica | Then: retorna 404', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ participantId: '99999999' }) };
      const participantIdentitiesCollection = { findOne: vi.fn().mockResolvedValue(null) };

      app.locals.db = dbWithRbac({
        patients: patientsCollection,
        participantIdentities: participantIdentitiesCollection,
      });

      const response = await request(app)
        .post('/api/patients/99999999/reidentify')
        .set('Authorization', `Bearer ${createAdminToken()}`)
        .send({ reason: 'Investigação de incidente' });

      expect(response.status).toBe(404);
    });
  });
});
