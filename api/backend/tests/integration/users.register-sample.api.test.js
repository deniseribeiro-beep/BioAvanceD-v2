
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
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildSamplePayload } = require('../factories/sample.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

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

describe('POST /api/users/register-sample - paridade de contrato com /api/samples', () => {
  let previousLineageMode;

  let patientsCollectionMock;

  function givenAppDbCollections({ rbacUsers = [{ userAccountId: 'qa-user-3', accessType: 2 }], extraRoles = [] } = {}) {
    patientsCollectionMock = createCollectionMock();
    app.locals.db = createDbMock({
      samples: createCollectionMock({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
      }),
      amostras: createCollectionMock({
        deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'sample-inserted' }),
      }),
      users: createCollectionMock({
        findOne: vi.fn().mockResolvedValue({ anonId: 'anon-user-qa' }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'user-1' }),
      }),
      logs: createCollectionMock({
        insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-qa' }),
      }),
      patients: patientsCollectionMock,
      ...buildRbacCollections(rbacUsers, extraRoles),
    });
  }

  function givenAuthenticatedSession() {
    vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'test-session-3' } });
    vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'test-session-3' });
  }

  function givenSampleServiceResult() {
    vi.spyOn(sampleService, 'createSample').mockResolvedValue({
      _id: '507f1f77bcf86cd799439013',
      participantId: '12345678',
      sampleType: 'Sangue',
      barcode: 'BR-TEST-0003',
    });
  }

  async function whenRegisterSample(payload) {
    return request(app)
      .post('/api/users/register-sample')
      .set('Authorization', `Bearer ${createAuthToken()}`)
      .send(payload);
  }

  beforeEach(() => {
    previousLineageMode = env.LINEAGE_MODE;
    env.LINEAGE_MODE = 'fail-open';
    givenAppDbCollections();

    app.locals.neo4jDriver = null;
    app.locals.neo4jQuarantineService = null;
    app.locals.topologicalQuarantine = null;
    givenSampleServiceResult();
    givenAuthenticatedSession();
  });

  afterEach(() => {
    env.LINEAGE_MODE = previousLineageMode;
    vi.restoreAllMocks();
    app.locals.topologicalQuarantine = null;
    app.locals.neo4jQuarantineService = null;
  });

  it('deve retornar contrato observável em PERMISSIVE com fallback (202)', async () => {
    // Given
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    // When
    const response = await whenRegisterSample(
      buildSamplePayload({
        linkedProject: 'Projeto QA Rota Usuário',
        isRareDisease: false,
        riskScore: 1,
      })
    );

    // Then
    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.partialSuccess).toBe(true);
    expect(response.body.data.operationMode).toBe('PERMISSIVE');
    expect(response.body.data.topology.synced).toBe(false);
    expect(response.body.data.topology.fallbackQueued).toBe(true);
    expect(typeof response.body.data.sampleID).toBe('string');
    expect(patientsCollectionMock.updateOne).not.toHaveBeenCalled();
  });

  it('#1367: forwards the use case options to createSample, as POST /api/samples does', async () => {
    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1 })
    );

    expect([201, 202]).toContain(response.status);
    expect(sampleService.createSample).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Object),
      expect.objectContaining({ onCreatedInTransaction: expect.any(Function) })
    );
  });

  it('#1376: stamps the caller\'s organization, and names it as collectionSite when the body named none', async () => {
    const payload = buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1 });
    expect(payload.collectionSite).toBeUndefined();

    const response = await whenRegisterSample(payload);

    expect([201, 202]).toContain(response.status);
    expect(sampleService.createSample).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ collectionSite: 'test-org-default' }),
      expect.objectContaining({ organizationId: 'test-org-default' })
    );
  });

  it('#1376: keeps a named collectionSite and still stamps the caller\'s organization', async () => {
    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, collectionSite: 'Hospital QA Norte' })
    );

    expect([201, 202]).toContain(response.status);
    expect(sampleService.createSample).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ collectionSite: 'Hospital QA Norte' }),
      expect.objectContaining({ organizationId: 'test-org-default' })
    );
  });

  // #1376: the body names the organization in its own organizationId field;
  // collectionSite (ELM-0128) is data and no longer picks.
  function givenMultiOrganizationCaller() {
    givenAppDbCollections({
      rbacUsers: [
        { userAccountId: 'qa-user-3', accessType: 2, organizationId: 'org-a' },
        { userAccountId: 'qa-user-3', accessType: 2, organizationId: 'org-b' },
      ],
    });
  }

  it('#1376: takes the body\'s organizationId as the pick, keeps the named collectionSite and passes no organizationId on', async () => {
    givenMultiOrganizationCaller();

    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, organizationId: 'org-b', collectionSite: 'Hospital QA Norte' })
    );

    expect([201, 202]).toContain(response.status);
    expect(sampleService.createSample).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ collectionSite: 'Hospital QA Norte' }),
      expect.objectContaining({ organizationId: 'org-b' })
    );
    expect(sampleService.createSample.mock.calls[0][1]).not.toHaveProperty('organizationId');
  });

  it('#1376: no longer picks by a collectionSite alone, refusing a multi-organization caller with a 400', async () => {
    givenMultiOrganizationCaller();

    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, collectionSite: 'org-b' })
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Informe organizationId/);
    expect(sampleService.createSample).not.toHaveBeenCalled();
  });

  it('#1376: refuses a caller with no organization with a 403 and creates nothing', async () => {
    // A scope-less additive role is the caller's only assignment, so it
    // resolves as org-less (rbac.factory's #1073 note).
    givenAppDbCollections({
      rbacUsers: [{ userAccountId: 'qa-user-3', roleCodes: ['sample-only'] }],
      extraRoles: [{ roleCode: 'sample-only', hierarchyLevel: null, permissions: ['createSample'] }],
    });

    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1 })
    );

    // #1384: the route now runs requireOrganizationScope, so the refusal is
    // the gate's, before the handler's own resolve.
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      error: 'Sem organização atribuída',
      message: 'Seu usuário não possui organização atribuída para acessar este recurso'
    });
    expect(sampleService.createSample).not.toHaveBeenCalled();
  });

  // RF018 AC2 (#1320): this route creates a sample without
  // validateCreateSamplePayload, so it applies the same use-context rule.
  it('RF018 AC2: refuses a partial qualificationContext with 422, one message per missing field, and creates nothing', async () => {
    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, qualificationContext: { targetAnalyte: 'DNA' } })
    );

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.details).toEqual(
      ['intendedUseCode', 'assayFamily', 'workflowProtocolId', 'workflowProtocolVersion'].map(
        (field) => `qualificationContext.${field} é obrigatório quando o contexto de uso é informado (RF018 AC2)`
      )
    );
    expect(sampleService.createSample).not.toHaveBeenCalled();
  });

  it('RF018 AC2: passes a complete qualificationContext on to createSample', async () => {
    const qualificationContext = {
      intendedUseCode: 'research-sequencing', targetAnalyte: 'cfDNA', assayFamily: 'sequencing',
      workflowProtocolId: 'p1', workflowProtocolVersion: '1.0',
    };

    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, qualificationContext })
    );

    expect([201, 202]).toContain(response.status);
    expect(sampleService.createSample).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ qualificationContext }),
      expect.anything()
    );
  });

  // RNF018 AC4 (#1489): this route skips validateCreateSamplePayload, so it
  // refuses a caller's RCS result as that validator does.
  it('RNF018 AC4: refuses an RCS-derived field with no sprec with 422 RCS_DERIVED_WRITE_REFUSED and creates nothing', async () => {
    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, rcsScore: 99, finalGrade: 'A' })
    );

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      success: false,
      error: 'RCS_DERIVED_WRITE_REFUSED',
      fields: ['rcsScore', 'finalGrade'],
      details: [
        'rcsScore: derivado da certificação RCS e não pode ser informado',
        'finalGrade: derivado da certificação RCS e não pode ser informado'
      ]
    });
    expect(sampleService.createSample).not.toHaveBeenCalled();
  });

  it('RNF018 AC4: passes a sprec with no RCS-derived field on to createSample', async () => {
    const sprec = { matrixType: 'fluid', sampleType: 'BLD', primaryContainer: 'SST', preCentrifugation: 'A' };

    const response = await whenRegisterSample(
      buildSamplePayload({ linkedProject: 'Projeto QA Rota Usuário', isRareDisease: false, riskScore: 1, sprec })
    );

    expect([201, 202]).toContain(response.status);
    expect(sampleService.createSample).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sprec }),
      expect.anything()
    );
  });

  it('deve bloquear em STRICT_MODE_BLOCKED na rota alternativa (403)', async () => {
    // Given
    const enqueueTopologicalTransaction = vi.fn().mockResolvedValue(undefined);
    app.locals.topologicalQuarantine = { enqueueTopologicalTransaction };

    vi.spyOn(LineageRepository.prototype, 'recordCustodyEvent').mockRejectedValue(new Error('Neo4j offline'));

    // When
    const response = await whenRegisterSample(
      buildSamplePayload({
        linkedProject: 'Projeto QA Rota Usuário',
        isRareDisease: true,
      })
    );

    // Then
    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('STRICT_MODE_BLOCKED');
    expect(enqueueTopologicalTransaction).not.toHaveBeenCalled();
  });
});
