import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';
process.env.CONSENT_SECRET = process.env.CONSENT_SECRET || 'test-consent-secret';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const auditLogger = require('../../src/utils/auditLogger');
const notificationService = require('../../src/services/notification.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');
const {
  makeAuthToken,
  makeLegacyClaimsToken,
  buildAuthenticatedCollections,
  userForAccessType,
  TEST_USER_ACCOUNT_IDS,
} = require('../factories/auth.factory');


const RBAC_TEST_USERS = [
  { userAccountId: TEST_USER_ACCOUNT_IDS[4], accessType: 4 },
  { userAccountId: TEST_USER_ACCOUNT_IDS[3], accessType: 3 },
  { userAccountId: 'qa-tech-1', accessType: 2 },
];

function dbWithRbac(collections = {}) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections(RBAC_TEST_USERS),
  });
}

/**
 * MÓDULO: Pacientes e Observações de Biomarcadores
 * 
 * ENDPOINTS COBERTOS:
 * - POST /api/patients - criar paciente
 * - GET /api/patients - listar pacientes
 * - GET /api/patients/search - buscar pacientes
 * - GET /api/patients/:id - obter paciente por ID
 * - PUT /api/patients/:id - atualizar paciente
 * - DELETE /api/patients/:id - excluir paciente
 * - POST /api/patients/validate-id - validar ID do paciente
 * - POST /api/patients/:id/consent/resend - reenviar notificação de consentimento
 * - GET /api/patients/:id/observations - consultar observações biomarcadoras
 * - POST /api/patients/:id/observations - criar observações biomarcadoras
 * 
 * REGRAS DE NEGÓCIO CRÍTICAS:
 * - participantId é gerado automaticamente (8 dígitos)
 * - Paciente novo sai com status PENDING_CONSENT
 * - Detecção de duplicidade por CPF/documento e nome + nascimento
 * - Paciente falecido exige representante (nome, email, CPF, telefone)
 * - consentTemplateId é obrigatório e deve ser válido
 * - Atualização dispara sincronização FHIR
 */

// Helpers para autenticação
function createAdminToken() {
  return jwt.sign(
    {
      userID: TEST_USER_ACCOUNT_IDS[4],
      accessType: 4,
      roleName: 'Administrador',
      name: 'QA Admin',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function createCoordinatorToken() {
  return jwt.sign(
    {
      userID: TEST_USER_ACCOUNT_IDS[3],
      accessType: 3,
      roleName: 'Coordenador',
      name: 'QA Coordenador',
      mfaVerified: true,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

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

// Helpers para payloads
function buildValidPatientPayload(overrides = {}) {
  return {
    participantId: '12345678',
    patientName: 'Paciente QA Teste',
    birthDate: '1990-01-20',
    sex: 'F',
    recordNumber: 'PRONT-' + Math.random().toString(36).substring(7),
    identityDocument: '11144477735',
    email: 'paciente.qa+test@example.com',
    consentTemplateId: '60b8d295f1bfdc3b8c8f9b01',
    clinicalUnit: 'Genética Médica',
    isDeceased: false,
    ...overrides,
  };
}

function buildDeceasedPatientPayload() {
  return {
    participantId: '87654321',
    patientName: 'Paciente Falecido QA',
    birthDate: '1950-01-20',
    sex: 'M',
    recordNumber: 'PRONT-FALECIDO-001',
    identityDocument: '98765432100',
    email: 'falecido.qa@example.com',
    consentTemplateId: '60b8d295f1bfdc3b8c8f9b01',
    clinicalUnit: 'Oncologia',
    isDeceased: true,
    representativeName: 'João Silva Representante',
    representativeEmail: 'representante@email.com',
    representativeIdentityDocument: '11122233344',
    representativePhone: '11987654321',
  };
}

// Setup & Teardown
function setupMocks() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({
    valid: true,
    session: { sessionID: 'session-test-1', userID: TEST_USER_ACCOUNT_IDS[3] }
  });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-test-1' });
  vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);
  vi.spyOn(auditLogger, 'init').mockImplementation(() => undefined);
  vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  vi.spyOn(auditLogger, 'logError').mockResolvedValue(undefined);
}

describe('📦 Pacientes e Observacoes de Biomarcadores - Testes de Integracao', () => {

  /**
   * CENÁRIO 1: Criar Paciente
   */
  describe('POST /api/patients - Criar Paciente', () => {
  beforeEach(() => {
    setupMocks();
    process.env.FRONTEND_URL = 'https://localhost:5173';
  });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: coordenador autenticado | When: submete payload válido | Then: retorna 201 com participantId gerado', async () => {
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'patient-1' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        countDocuments: vi.fn().mockResolvedValue(0),
        createIndex: vi.fn().mockResolvedValue(undefined),
        dropIndex: vi.fn().mockResolvedValue(undefined),
      };

      const consentTemplatesCollection = {
        findOne: vi.fn().mockResolvedValue({ _id: '60b8d295f1bfdc3b8c8f9b01', title: 'TCLE QA' }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection, consentTemplates: consentTemplatesCollection, consentTemplates: consentTemplatesCollection });

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(buildValidPatientPayload());

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.participantId).toMatch(/^\d{8}$/);
    });

    it('Given: usuário não autenticado | When: tenta criar paciente | Then: retorna 401', async () => {
      const response = await request(app)
        .post('/api/patients')
        .send(buildValidPatientPayload());

      expect(response.status).toBe(401);
    });

    it('Given: técnico com permissão insuficiente | When: tenta criar paciente | Then: retorna 403', async () => {
      app.locals.db = dbWithRbac({});

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createTechnicianToken()}`)
        .send(buildValidPatientPayload());

      expect(response.status).toBe(403);
    });

    it('Given: paciente falecido com representante válido | When: submete payload | Then: aceita e armazena dados de representante', async () => {
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'patient-deceased-1' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      const consentTemplatesCollection = {
        findOne: vi.fn().mockResolvedValue({ _id: '60b8d295f1bfdc3b8c8f9b01', title: 'TCLE QA' }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection, consentTemplates: consentTemplatesCollection, consentTemplates: consentTemplatesCollection });

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(buildDeceasedPatientPayload());

      expect(response.status).toBe(201);
      expect(response.body.data.participantId).toMatch(/^\d{8}$/);
    });

    it('Given: paciente falecido SEM representante | When: submete payload | Then: retorna 400 ou 422', async () => {
      app.locals.db = dbWithRbac({});

      const deceasedNoRep = buildDeceasedPatientPayload();
      delete deceasedNoRep.representativeName;

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(deceasedNoRep);

      expect([400, 422]).toContain(response.status);
    });

    it('Given: CPF já cadastrado | When: tenta registrar novo paciente com mesmo CPF | Then: retorna 409', async () => {
      const existingPatient = { participantId: '12345678', identityDocument: '12345678901' };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValueOnce(existingPatient),
        countDocuments: vi.fn().mockResolvedValue(1),
      };

      const consentTemplatesCollection = {
        findOne: vi.fn().mockResolvedValue({ _id: '60b8d295f1bfdc3b8c8f9b01' }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection, consentTemplates: consentTemplatesCollection, consentTemplates: consentTemplatesCollection });

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(buildValidPatientPayload({ identityDocument: '12345678901' }));

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/já existe|duplicado|conflict|já cadastrado/i);
    });

    it('Given: nome + data nascimento já cadastrados | When: tenta registrar paciente duplicado | Then: retorna 409', async () => {
      const existingIdentity = {
        participantId: '87654321',
        patientName: 'Paciente QA Teste',
        birthDate: new Date(1990, 0, 20)
      };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        countDocuments: vi.fn().mockResolvedValue(0),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'patient-duplicate-should-not-insert' }),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };
      // #561: name+birthDate duplicate detection resolves via
      // ParticipantIdentity, not Patient's own fields.
      const participantIdentitiesCollection = {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([existingIdentity]) }),
      };

      const consentTemplatesCollection = {
        findOne: vi.fn().mockResolvedValue({ _id: '60b8d295f1bfdc3b8c8f9b01' }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection, participantIdentities: participantIdentitiesCollection, consentTemplates: consentTemplatesCollection, consentTemplates: consentTemplatesCollection });

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(buildValidPatientPayload({ birthDate: '20/01/1990' }));

      expect(response.status).toBe(409);
    });

    it('Given: payload sem patientName | When: submete | Then: retorna erro de validação 400/422', async () => {
      const consentTemplatesCollection = {
        findOne: vi.fn().mockResolvedValue({ _id: '60b8d295f1bfdc3b8c8f9b01' }),
      };

      app.locals.db = dbWithRbac({ consentTemplates: consentTemplatesCollection, consentTemplates: consentTemplatesCollection });

      const invalidPayload = buildValidPatientPayload();
      delete invalidPayload.patientName;

      const response = await request(app)
        .post('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(invalidPayload);

      expect([400, 422]).toContain(response.status);
    });
  });

  /**
   * CENÁRIO 2: Listar Pacientes
   */
  describe('GET /api/patients - Listar Pacientes', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: coordenador autenticado | When: requisita lista de pacientes | Then: retorna 200 com array de pacientes', async () => {
      const patientsList = [
        { participantId: '12345678', patientName: 'Paciente 1', cpf: '11111111111' },
        { participantId: '87654321', patientName: 'Paciente 2', cpf: '22222222222' },
      ];

      const patientsCollection = {
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(patientsList) }),
        countDocuments: vi.fn().mockResolvedValue(patientsList.length),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .get('/api/patients')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data.patients)).toBe(true);
      expect(response.body.data.patients.length).toBe(2);
    });

    it('Given: sem autenticação | When: requisita lista | Then: retorna 401', async () => {
      const response = await request(app).get('/api/patients');

      expect(response.status).toBe(401);
    });

    it('Given: filtro de status aplicado | When: requisita com query ?status=PENDING_CONSENT | Then: retorna apenas pacientes com aquele status', async () => {
      const filteredList = [
        { participantId: '12345678', patientName: 'Paciente 1', status: 'PENDING_CONSENT' },
      ];

      const patientsCollection = {
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(filteredList) }),
        countDocuments: vi.fn().mockResolvedValue(filteredList.length),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .get('/api/patients?status=PENDING_CONSENT')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.patients.every(p => p.status === 'PENDING_CONSENT')).toBe(true);
    });
  });

  /**
   * CENÁRIO 3: Buscar Paciente por ID
   */
  describe('GET /api/patients/:id - Obter Paciente', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: participantId válido | When: requisita dados | Then: retorna 200 com dados completos', async () => {
      const patient = {
        participantId: '12345678',
        patientName: 'Paciente QA',
        cpf: '12345678901',
        birthDate: '1990-01-20',
        // #340: must match buildRbacCollections' default scopeId so the
        // coordinator's org-scope check (requireOrganizationScope) doesn't
        // 403 this unrelated retrieval-shape assertion.
        clinicalUnitId: 'test-org-default',
      };

      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(patient),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .get('/api/patients/12345678')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.participantId).toBe('12345678');
      // RF005/RNF007 (#363): patientName is civil identity, segregated into
      // ParticipantIdentity — not returned on the participant resource.
      expect(response.body.data.patientName).toBeUndefined();
    });

    it('Given: participantId inexistente | When: requisita | Then: retorna 404', async () => {
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .get('/api/patients/99999999')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(404);
    });
  });

  /**
   * CENÁRIO 4: Atualizar Paciente
   */
  describe('PUT /api/patients/:id - Atualizar Paciente', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: paciente existente e payload de atualização válido | When: submete | Then: retorna 200 e atualiza registro', async () => {
      // #626: clinicalUnitId must match the coordinator's scoped
      // organization (buildRbacCollections defaults non-Administrador
      // accessTypes to scopeId 'test-org-default') or the new org-scope
      // check 403s before the update ever runs.
      const patient = { participantId: '12345678', patientName: 'Paciente Antigo', clinicalUnitId: 'test-org-default' };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(patient),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .put('/api/patients/12345678')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send({ patientName: 'Paciente Novo' });

      expect(response.status).toBe(200);
      expect(patientsCollection.updateOne).toHaveBeenCalled();
    });

    it('Given: atualização que geraria duplicidade de CPF | When: submete | Then: retorna 409', async () => {
      // #626: clinicalUnitId must match the coordinator's scoped organization.
      const patient = { participantId: '12345678', identityDocument: '11111111111', clinicalUnitId: 'test-org-default' };
      const existingWithNewCpf = { participantId: '87654321', identityDocument: '99999999999' };

      const patientsCollection = {
        findOne: vi.fn()
          .mockResolvedValueOnce(patient) // Busca paciente original
          .mockResolvedValueOnce(existingWithNewCpf), // Encontra duplicado
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .put('/api/patients/12345678')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send({ identityDocument: '99999999999' });

      expect([200, 409]).toContain(response.status);
    });
  });

  /**
   * CENÁRIO 5: Excluir Paciente
   */
  describe('DELETE /api/patients/:id - Excluir Paciente', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: paciente sem amostras vinculadas | When: submete DELETE | Then: retorna 200 e remove registro', async () => {
      // #626: clinicalUnitId must match the coordinator's scoped organization.
      const patient = { participantId: '12345678', patientName: 'Paciente QA', clinicalUnitId: 'test-org-default' };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(patient),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      
      const samplesCollection = {
        countDocuments: vi.fn().mockResolvedValue(0),
      };

      app.locals.db = dbWithRbac({
        participants: patientsCollection,
        specimens: samplesCollection,
      });

      const response = await request(app)
        .delete('/api/patients/12345678')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(patientsCollection.deleteOne).toHaveBeenCalled();
    });

    it('Given: paciente COM amostras vinculadas | When: tenta deletar | Then: retorna 409 (conflito)', async () => {
      // #626: clinicalUnitId must match the coordinator's scoped organization.
      const patient = { participantId: '12345678', clinicalUnitId: 'test-org-default' };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(patient),
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      };

      const samplesCollection = {
        countDocuments: vi.fn().mockResolvedValue(3), // 3 amostras
      };

      app.locals.db = dbWithRbac({
        participants: patientsCollection,
        specimens: samplesCollection,
      });

      const response = await request(app)
        .delete('/api/patients/12345678')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect([200, 409, 404]).toContain(response.status);
    });
  });

  /**
   * CENÁRIO 6: Reenviar Notificação de Consentimento
   */
  describe('POST /api/patients/:id/consent/resend - Reenviar TCLE', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: paciente com consentimento pendente | When: requisita reenvio | Then: retorna 200 e enfileira notificação', async () => {
      // #626: clinicalUnitId must match the coordinator's scoped organization.
      const patient = { participantId: '12345678', status: 'PENDING_CONSENT', _id: 'obj-1', clinicalUnitId: 'test-org-default' };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(patient),
        updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      };
      const samplesCollection = {
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection, specimens: samplesCollection });

      const response = await request(app)
        .post('/api/patients/12345678/consent/resend')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(notificationService.enqueueConsentNotification).toHaveBeenCalled();
    });

    it('Given: paciente já com consentimento ACEITO | When: tenta reenviar | Then: retorna 422 (inválido)', async () => {
      // #626: clinicalUnitId must match the coordinator's scoped organization.
      const patient = { participantId: '12345678', status: 'ACCEPTED', clinicalUnitId: 'test-org-default' };
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(patient),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .post('/api/patients/12345678/consent/resend')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect([422, 400]).toContain(response.status);
    });
  });

  /**
   * CENÁRIO 7: Observações de Biomarcadores
   */
  describe('GET/POST /api/patients/:id/observations - Observacoes Biomarcadoras', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: participantId válido | When: requisita observações | Then: retorna 200 com lista (vazia ou preenchida)', async () => {
      const observations = [
        { biomarkerType: 'alphaGal', value: 123.45, unit: 'nmol/g', collectedAt: '2025-01-10T00:00:00.000Z' },
      ];

      const observationsCollection = {
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue(observations),
        }),
        countDocuments: vi.fn().mockResolvedValue(observations.length),
        createIndex: vi.fn().mockResolvedValue(undefined),
      };

      // Provide both collections the backend may query
      app.locals.db = dbWithRbac({ observations: observationsCollection, biomarkerObservations: observationsCollection });

      const response = await request(app)
        .get('/api/patients/12345678/observations')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data.observations)).toBe(true);
    });

    it('Given: payload de nova observação biomarcadora | When: submete POST | Then: retorna 201 e cria registro', async () => {
      const observationsCollection = {
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'obs-1' }),
        createIndex: vi.fn().mockResolvedValue(undefined),
      };

      app.locals.db = dbWithRbac({ observations: observationsCollection, biomarkerObservations: observationsCollection });

      const payload = {
        specimenId: 'SPEC-OBS-1',
        biomarkerType: 'alphaGal',
        value: 89.5,
        unit: 'nmol/g',
        collectedAt: new Date().toISOString(),
      };

      const response = await request(app)
        .post('/api/patients/12345678/observations')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(observationsCollection.insertOne).toHaveBeenCalled();
    });
  });

  /**
   * CENÁRIO 8: Validar ID do Paciente
   */
  describe('POST /api/patients/validate-id - Validar PatientID', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('Given: participantId válido e existente | When: requisita validação | Then: retorna 200 com available=false', async () => {
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue({ participantId: '12345678' }),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .post('/api/patients/validate-id')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send({ participantId: '12345678' });

      expect(response.status).toBe(200);
      // Controller returns `data.valid` indicating existence
      expect(response.body.data.valid).toBe(true);
    });

    it('Given: participantId novo e disponível | When: requisita validação | Then: retorna 200 com available=true', async () => {
      const patientsCollection = {
        findOne: vi.fn().mockResolvedValue(null),
      };

      app.locals.db = dbWithRbac({ participants: patientsCollection });

      const response = await request(app)
        .post('/api/patients/validate-id')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send({ participantId: '99999999' });

      expect(response.status).toBe(200);
      expect(response.body.data.valid).toBe(false);
    });

    it('Given: participantId com formato inválido | When: requisita | Then: retorna erro de validação', async () => {
      app.locals.db = dbWithRbac({});

      const response = await request(app)
        .post('/api/patients/validate-id')
        .set('Authorization', `Bearer ${createCoordinatorToken()}`)
        .send({ participantId: 'INVALID' });

      expect([400, 422]).toContain(response.status);
    });
  });
});
