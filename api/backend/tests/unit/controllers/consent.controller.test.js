import { afterEach, describe, expect, it, vi } from 'vitest';

// NOTE on mocking strategy: this repo's Vitest setup does not let vi.mock()
// intercept CommonJS require() (see .claude/skills/testing-conventions/SKILL.md).
// consent.controller.js does plain, non-destructured
// `const consentService = require('../services/consent.service')` and
// `const patientService = require('../services/patient.service')` at the top,
// and lazily `require('../utils/auditLogger')` inside handler bodies when
// req.user is set. Node's CJS module cache guarantees the controller and this
// test share the same object instances, so we require the real singletons and
// vi.spyOn() their methods, restoring with vi.restoreAllMocks() in afterEach.
const consentController = require('../../../src/controllers/consent.controller');
const consentService = require('../../../src/services/consent.service');
const patientService = require('../../../src/services/patient.service');
const participantIdentityService = require('../../../src/services/participantIdentity.service');
const auditLogger = require('../../../src/utils/auditLogger');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function createReq(overrides = {}) {
  return {
    app: { locals: { db: { fake: true } } },
    params: {},
    query: {},
    body: {},
    user: undefined,
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  };
}

const NO_DB_REQ = () => createReq({ app: { locals: {} } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConsentController.getPendingPatientsForPolicy', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('returns 400 when policyId is missing', async () => {
    const req = createReq({ params: {}, query: {} });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'policyId é obrigatório' });
  });

  it('returns 200 with pending patients, resolving patientName via ParticipantIdentity (#562)', async () => {
    const patientsToArray = vi.fn().mockResolvedValue([{ participantId: 'p1' }]);
    const patientsProject = vi.fn().mockReturnValue({ toArray: patientsToArray });
    const patientsFind = vi.fn().mockReturnValue({ project: patientsProject });

    const identitiesToArray = vi.fn().mockResolvedValue([{ participantId: 'p1', patientName: 'Paciente QA' }]);
    const identitiesProject = vi.fn().mockReturnValue({ toArray: identitiesToArray });
    const identitiesFind = vi.fn().mockReturnValue({ project: identitiesProject });

    const collection = vi.fn((name) =>
      name === 'participantIdentities' ? { find: identitiesFind } : { find: patientsFind }
    );
    const req = createReq({ params: { id: 'policy1' }, app: { locals: { db: { collection } } } });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(collection).toHaveBeenCalledWith('patients');
    expect(patientsFind).toHaveBeenCalledWith({ status: 'PENDING_CONSENT', consentTemplateId: 'policy1' });
    expect(identitiesFind).toHaveBeenCalledWith({ participantId: { $in: ['p1'] } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ participantId: 'p1', patientName: 'Paciente QA' }] });
  });

  it('resolves patientName from ciphertext-only ParticipantIdentity records, no plaintext present (RF005/RNF007 #574)', async () => {
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: 'p1',
      patientName: 'Paciente Cifrado'
    });
    const ciphertextOnlyIdentity = { ...encrypted, patientName: null };

    const patientsToArray = vi.fn().mockResolvedValue([{ participantId: 'p1' }]);
    const patientsProject = vi.fn().mockReturnValue({ toArray: patientsToArray });
    const patientsFind = vi.fn().mockReturnValue({ project: patientsProject });

    const identitiesToArray = vi.fn().mockResolvedValue([ciphertextOnlyIdentity]);
    const identitiesProject = vi.fn().mockReturnValue({ toArray: identitiesToArray });
    const identitiesFind = vi.fn().mockReturnValue({ project: identitiesProject });

    const collection = vi.fn((name) =>
      name === 'participantIdentities' ? { find: identitiesFind } : { find: patientsFind }
    );
    const req = createReq({ params: { id: 'policy1' }, app: { locals: { db: { collection } } } });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ participantId: 'p1', patientName: 'Paciente Cifrado' }] });
  });

  it('skips the ParticipantIdentity lookup when no pending patients are found', async () => {
    const patientsToArray = vi.fn().mockResolvedValue([]);
    const patientsProject = vi.fn().mockReturnValue({ toArray: patientsToArray });
    const patientsFind = vi.fn().mockReturnValue({ project: patientsProject });
    const identitiesFind = vi.fn();
    const collection = vi.fn((name) =>
      name === 'participantIdentities' ? { find: identitiesFind } : { find: patientsFind }
    );
    const req = createReq({ params: { id: 'policy1' }, app: { locals: { db: { collection } } } });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(identitiesFind).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('returns 500 when the collection lookup throws', async () => {
    const collection = vi.fn(() => { throw new Error('boom'); });
    const req = createReq({ params: { id: 'policy1' }, app: { locals: { db: { collection } } } });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao listar pacientes aguardando aprovação do TCLE',
      message: 'boom',
    });
  });

  it('falls back to req.query.policyId when params.id is absent', async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const project = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ project });
    const collection = vi.fn().mockReturnValue({ find });
    const req = createReq({ params: {}, query: { policyId: 'policyFromQuery' }, app: { locals: { db: { collection } } } });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(find).toHaveBeenCalledWith({ status: 'PENDING_CONSENT', consentTemplateId: 'policyFromQuery' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('ConsentController.createPolicy', () => {
  it('returns 503 when db is unavailable', async () => {
    const spy = vi.spyOn(consentService, 'createPolicy');
    const req = NO_DB_REQ();
    const res = createRes();

    await consentController.createPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(consentService, 'createPolicy').mockRejectedValue(new Error('invalid payload'));
    const req = createReq({ body: { title: 'x' } });
    const res = createRes();

    await consentController.createPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao criar política de consentimento',
      message: 'invalid payload',
    });
  });

  it('returns 201 with created policy and skips audit log when req.user is absent', async () => {
    const policy = { _id: { toString: () => 'pid1' }, title: 't', version: 'v1', active: true };
    vi.spyOn(consentService, 'createPolicy').mockResolvedValue(policy);
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ body: { title: 't' }, user: undefined });
    const res = createRes();

    await consentController.createPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Política de consentimento criada com sucesso',
      data: policy,
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('calls auditLogger when req.user is present', async () => {
    const policy = { _id: { toString: () => 'pid1' }, title: 't', version: 'v1', active: true, granularPermissions: [{ key: 'k1' }] };
    vi.spyOn(consentService, 'createPolicy').mockResolvedValue(policy);
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ body: { title: 't' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.createPolicy(req, res);

    expect(initSpy).toHaveBeenCalledWith(req.app.locals.db);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      resourceType: 'ConsentPolicy',
      resourceId: 'pid1',
      payload: expect.objectContaining({ permissions: ['k1'] }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('logs empty permissions array when policy has no granularPermissions', async () => {
    const policy = { _id: { toString: () => 'pid2' }, title: 't', version: 'v1', active: true };
    vi.spyOn(consentService, 'createPolicy').mockResolvedValue(policy);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ body: { title: 't' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.createPolicy(req, res);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ permissions: [] }),
    }));
  });
});

describe('ConsentController.getActivePolicy', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getActivePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when there is no active policy', async () => {
    vi.spyOn(consentService, 'getActivePolicy').mockResolvedValue(null);
    const req = createReq();
    const res = createRes();

    await consentController.getActivePolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Nenhuma política ativa encontrada' });
  });

  it('returns 200 with the active policy', async () => {
    vi.spyOn(consentService, 'getActivePolicy').mockResolvedValue({ _id: '1' });
    const req = createReq();
    const res = createRes();

    await consentController.getActivePolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: '1' } });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getActivePolicy').mockRejectedValue(new Error('db down'));
    const req = createReq();
    const res = createRes();

    await consentController.getActivePolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao buscar política ativa',
      message: 'db down',
    });
  });
});

describe('ConsentController.getAllPolicies', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getAllPolicies(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with all policies', async () => {
    vi.spyOn(consentService, 'getAllPolicies').mockResolvedValue([{ _id: '1' }]);
    const req = createReq();
    const res = createRes();

    await consentController.getAllPolicies(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ _id: '1' }] });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getAllPolicies').mockRejectedValue(new Error('fail'));
    const req = createReq();
    const res = createRes();

    await consentController.getAllPolicies(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.getPoliciesHistory', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getPoliciesHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with paginated results using query defaults', async () => {
    vi.spyOn(consentService, 'getPoliciesHistory').mockResolvedValue({
      items: [{ _id: '1' }],
      pagination: { page: 1, limit: 10, total: 1 },
    });
    const req = createReq({ query: {} });
    const res = createRes();

    await consentController.getPoliciesHistory(req, res);

    expect(consentService.getPoliciesHistory).toHaveBeenCalledWith(req.app.locals.db, {
      page: 1,
      limit: 10,
      search: '',
      groupId: '',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: '1' }],
      pagination: { page: 1, limit: 10, total: 1 },
    });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getPoliciesHistory').mockRejectedValue(new Error('fail'));
    const req = createReq({ query: { page: '2', limit: '5' } });
    const res = createRes();

    await consentController.getPoliciesHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.updatePolicy', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.updatePolicy(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(consentService, 'updatePolicy').mockRejectedValue(new Error('not found'));
    const req = createReq({ params: { id: '1' }, body: {} });
    const res = createRes();

    await consentController.updatePolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao atualizar política de consentimento',
      message: 'not found',
    });
  });

  it('returns 200 and logs audit entry when req.user is present', async () => {
    const policy = { _id: { toString: () => 'pid1' }, version: 'v2', active: true };
    vi.spyOn(consentService, 'updatePolicy').mockResolvedValue(policy);
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ params: { id: '1' }, body: { title: 't' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.updatePolicy(req, res);

    expect(initSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', resourceType: 'ConsentPolicy' }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'TCLE atualizado com nova versão automática',
      data: policy,
    });
  });

  it('logs previousPolicyId in audit payload when present on the updated policy', async () => {
    const policy = { _id: { toString: () => 'pid1' }, version: 'v2', active: true, previousPolicyId: 'prevId' };
    vi.spyOn(consentService, 'updatePolicy').mockResolvedValue(policy);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ params: { id: '1' }, body: { title: 't' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.updatePolicy(req, res);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ previousPolicyId: 'prevId' }),
    }));
  });
});

describe('ConsentController.getActivePoliciesWithCaae', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getActivePoliciesWithCaae(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with policies', async () => {
    vi.spyOn(consentService, 'getActivePoliciesWithCaae').mockResolvedValue([{ _id: '1' }]);
    const req = createReq();
    const res = createRes();

    await consentController.getActivePoliciesWithCaae(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ _id: '1' }] });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getActivePoliciesWithCaae').mockRejectedValue(new Error('fail'));
    const req = createReq();
    const res = createRes();

    await consentController.getActivePoliciesWithCaae(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.createTemplate', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.createTemplate(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(consentService, 'createTemplate').mockRejectedValue(new Error('bad'));
    const req = createReq({ body: {} });
    const res = createRes();

    await consentController.createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 201 with created template on success', async () => {
    const template = { _id: { toString: () => 't1' }, title: 'T', version: 'v1', active: true, permissions: [{ key: 'k' }] };
    vi.spyOn(consentService, 'createTemplate').mockResolvedValue(template);
    const req = createReq({ body: { title: 'T' } });
    const res = createRes();

    await consentController.createTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Template de consentimento criado com sucesso',
      data: template,
    });
  });

  it('logs audit entry with permissions when req.user is present', async () => {
    const template = { _id: { toString: () => 't2' }, title: 'T', version: 'v1', active: true, permissions: [{ key: 'k1' }] };
    vi.spyOn(consentService, 'createTemplate').mockResolvedValue(template);
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ body: { title: 'T' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.createTemplate(req, res);

    expect(initSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      resourceType: 'ConsentTemplate',
      resourceId: 't2',
      payload: expect.objectContaining({ permissions: ['k1'] }),
    }));
  });

  it('logs empty permissions array when template has no permissions', async () => {
    const template = { _id: { toString: () => 't3' }, title: 'T', version: 'v1', active: true };
    vi.spyOn(consentService, 'createTemplate').mockResolvedValue(template);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ body: { title: 'T' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.createTemplate(req, res);

    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ permissions: [] }),
    }));
  });
});

describe('ConsentController.getTemplateById', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getTemplateById(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when template is not found', async () => {
    vi.spyOn(consentService, 'getTemplateById').mockResolvedValue(null);
    const req = createReq({ params: { id: '1' } });
    const res = createRes();

    await consentController.getTemplateById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 with the template on success', async () => {
    vi.spyOn(consentService, 'getTemplateById').mockResolvedValue({ _id: '1' });
    const req = createReq({ params: { id: '1' } });
    const res = createRes();

    await consentController.getTemplateById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: '1' } });
  });

  it('returns 400 when the service throws (not 500)', async () => {
    vi.spyOn(consentService, 'getTemplateById').mockRejectedValue(new Error('bad id'));
    const req = createReq({ params: { id: 'bad' } });
    const res = createRes();

    await consentController.getTemplateById(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao buscar template de consentimento',
      message: 'bad id',
    });
  });
});

describe('ConsentController.updateTemplate', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.updateTemplate(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(consentService, 'updateTemplate').mockRejectedValue(new Error('bad'));
    const req = createReq({ params: { id: '1' }, body: {} });
    const res = createRes();

    await consentController.updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 200 on success', async () => {
    const template = { _id: { toString: () => 't1' }, version: 'v2', active: true };
    vi.spyOn(consentService, 'updateTemplate').mockResolvedValue(template);
    const req = createReq({ params: { id: '1' }, body: { title: 'X' } });
    const res = createRes();

    await consentController.updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Template de consentimento atualizado com sucesso',
      data: template,
    });
  });

  it('logs audit entry when req.user is present', async () => {
    const template = { _id: { toString: () => 't1' }, title: 'X', version: 'v2', active: true };
    vi.spyOn(consentService, 'updateTemplate').mockResolvedValue(template);
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ params: { id: '1' }, body: { title: 'X' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.updateTemplate(req, res);

    expect(initSpy).toHaveBeenCalledWith(req.app.locals.db);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceType: 'ConsentTemplate',
      resourceId: 't1',
      payload: expect.objectContaining({ title: 'X', version: 'v2', active: true }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('ConsentController.getActiveTemplate', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getActiveTemplate(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with null data and message when no active template exists', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
    const req = createReq();
    const res = createRes();

    await consentController.getActiveTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: null,
      message: 'Nenhum template ativo encontrado',
    });
  });

  it('returns 200 with the active template', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue({ _id: '1' });
    const req = createReq();
    const res = createRes();

    await consentController.getActiveTemplate(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: '1' } });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockRejectedValue(new Error('fail'));
    const req = createReq();
    const res = createRes();

    await consentController.getActiveTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.getAllTemplates', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getAllTemplates(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with templates on success', async () => {
    vi.spyOn(consentService, 'getAllTemplates').mockResolvedValue([{ _id: '1' }]);
    const req = createReq();
    const res = createRes();

    await consentController.getAllTemplates(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ _id: '1' }] });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getAllTemplates').mockRejectedValue(new Error('fail'));
    const req = createReq();
    const res = createRes();

    await consentController.getAllTemplates(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.getCurrentTemplate', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getCurrentTemplate(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns active template with source "active" when present', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue({ _id: '1' });
    const latestSpy = vi.spyOn(consentService, 'getLatestTemplate').mockResolvedValue(undefined);
    const req = createReq();
    const res = createRes();

    await consentController.getCurrentTemplate(req, res);

    expect(latestSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: '1' }, source: 'active' });
  });

  it('falls back to latest template with source "latest" when no active template', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
    vi.spyOn(consentService, 'getLatestTemplate').mockResolvedValue({ _id: '2' });
    const req = createReq();
    const res = createRes();

    await consentController.getCurrentTemplate(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { _id: '2' },
      source: 'latest',
      message: 'Nenhum template ativo encontrado, retornando o template mais recente.',
    });
  });

  it('returns source "empty" when neither active nor latest template exist', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
    vi.spyOn(consentService, 'getLatestTemplate').mockResolvedValue(null);
    const req = createReq();
    const res = createRes();

    await consentController.getCurrentTemplate(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: null,
      source: 'empty',
      message: 'Nenhum template de consentimento encontrado.',
    });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockRejectedValue(new Error('fail'));
    const req = createReq();
    const res = createRes();

    await consentController.getCurrentTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.createPatientConsent', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.createPatientConsent(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('builds payload with patientID fallback and ip/user-agent, returns 201', async () => {
    const consent = { _id: { toString: () => 'c1' }, patientId: 'p1', templateId: 't1', status: 'SIGNED' };
    const createSpy = vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue(consent);
    const req = createReq({
      body: { patientID: 'p1', templateId: 't1' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' },
    });
    const res = createRes();

    await consentController.createPatientConsent(req, res);

    expect(createSpy).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({
      patientId: 'p1',
      patientID: 'p1',
      templateId: 't1',
      ipAddress: '10.0.0.1',
      userAgent: 'test-agent',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Consentimento registrado com sucesso',
      data: consent,
    });
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(consentService, 'createPatientConsent').mockRejectedValue(new Error('invalid'));
    const req = createReq({ body: { patientId: 'p1' } });
    const res = createRes();

    await consentController.createPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('falls back to x-forwarded-for header when req.ip is absent', async () => {
    const consent = { _id: { toString: () => 'c2' }, patientId: 'p1', status: 'SIGNED' };
    const createSpy = vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue(consent);
    const req = createReq({
      body: { patientId: 'p1' },
      ip: undefined,
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    const res = createRes();

    await consentController.createPatientConsent(req, res);

    expect(createSpy).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({ ipAddress: '1.2.3.4' }));
  });

  it('falls back to req.connection.remoteAddress when req.ip and forwarded header are absent', async () => {
    const consent = { _id: { toString: () => 'c3' }, patientId: 'p1', status: 'SIGNED' };
    const createSpy = vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue(consent);
    const req = createReq({
      body: { patientId: 'p1' },
      ip: undefined,
      headers: {},
      connection: { remoteAddress: '5.6.7.8' },
    });
    const res = createRes();

    await consentController.createPatientConsent(req, res);

    expect(createSpy).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({ ipAddress: '5.6.7.8' }));
  });

  it('logs audit entry when req.user is present', async () => {
    const consent = { _id: { toString: () => 'c1' }, patientId: 'p1', templateId: 't1', status: 'SIGNED' };
    vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue(consent);
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ body: { patientId: 'p1' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.createPatientConsent(req, res);

    expect(initSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'SIGN', resourceType: 'PatientConsent' }));
  });
});

describe('ConsentController.revokeConsent', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.revokeConsent(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when consent is not found', async () => {
    vi.spyOn(consentService, 'revokeConsent').mockResolvedValue(null);
    const req = createReq({ params: { id: '1' } });
    const res = createRes();

    await consentController.revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Consentimento não encontrado' });
  });

  it('returns 200 on success and skips audit log without req.user', async () => {
    const consent = { patientId: 'p1', templateId: 't1' };
    vi.spyOn(consentService, 'revokeConsent').mockResolvedValue(consent);
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ params: { id: '1' } });
    const res = createRes();

    await consentController.revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Consentimento revogado com sucesso',
      data: consent,
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs audit entry with REVOKE action when req.user is present', async () => {
    const consent = { patientId: 'p1', templateId: 't1' };
    vi.spyOn(consentService, 'revokeConsent').mockResolvedValue(consent);
    const initSpy = vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const req = createReq({ params: { id: '1' }, user: { id: 'u1' } });
    const res = createRes();

    await consentController.revokeConsent(req, res);

    expect(initSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'REVOKE', severity: 'warning' }));
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(consentService, 'revokeConsent').mockRejectedValue(new Error('fail'));
    const req = createReq({ params: { id: '1' } });
    const res = createRes();

    await consentController.revokeConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('ConsentController.getPatientConsent', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getPatientConsent(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when consent is not found', async () => {
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const req = createReq({ params: { patientId: 'p1' } });
    const res = createRes();

    await consentController.getPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 with the consent', async () => {
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ _id: '1' });
    const req = createReq({ params: { patientId: 'p1' } });
    const res = createRes();

    await consentController.getPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: '1' } });
  });

  it('returns 500 when the service throws', async () => {
    vi.spyOn(consentService, 'getPatientConsent').mockRejectedValue(new Error('fail'));
    const req = createReq({ params: { patientId: 'p1' } });
    const res = createRes();

    await consentController.getPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('ConsentController.validateConsentToken', () => {
  const ACTIVE_TEMPLATE = {
    _id: 'tpl-1',
    title: 'TCLE Biobanco v2',
    content: 'Termo completo de consentimento livre e esclarecido.',
    version: '2.0',
    active: true,
    permissions: [
      { key: 'research', label: 'Uso em pesquisa', required: true },
      { key: 'contact', label: 'Novo contato', required: false },
    ],
  };

  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.validateConsentToken(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with validation result on success, using body values', async () => {
    const validateSpy = vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(ACTIVE_TEMPLATE);
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(validateSpy).toHaveBeenCalledWith(req.app.locals.db, 'p1', 'tok');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ valid: true, participantId: 'p1' }),
      })
    );
  });

  // #809: the page behind /patients/:id/consent?token= is unauthenticated, so
  // this response is its only source for the term it asks the participant to
  // accept -- GET /consent-policies/active and the ConsentTemplate CRUD routes
  // all sit behind `authenticate`. Without the template here the page can
  // render an accept button and no terms.
  it('returns the active consent template alongside the validation result', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    const templateSpy = vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(ACTIVE_TEMPLATE);
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(templateSpy).toHaveBeenCalledWith(req.app.locals.db);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.template).toEqual({
      id: 'tpl-1',
      title: 'TCLE Biobanco v2',
      content: 'Termo completo de consentimento livre e esclarecido.',
      version: '2.0',
      permissions: [
        { key: 'research', label: 'Uso em pesquisa', required: true },
        { key: 'contact', label: 'Novo contato', required: false },
      ],
    });
  });

  it('returns template: null when no consent template is active', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.valid).toBe(true);
    expect(payload.data.template).toBeNull();
  });

  // This endpoint is public. Whatever it returns is readable by anyone holding
  // the link, so it must not widen the civil-identity surface (#807, RNF007):
  // unlike system 1's /validate/:token, it resolves no ParticipantIdentity.
  it('does not return civil identity fields', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(ACTIVE_TEMPLATE);
    const identitySpy = vi.spyOn(participantIdentityService, 'decryptIdentity');
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(identitySpy).not.toHaveBeenCalled();
    const serialized = JSON.stringify(res.json.mock.calls[0][0]);
    expect(serialized).not.toMatch(/patientName|birthDate|identityDocument|cpf/i);
  });

  it('falls back to query values when body is empty', async () => {
    const validateSpy = vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p2' });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(ACTIVE_TEMPLATE);
    const req = createReq({ body: {}, query: { patientID: 'p2', token: 'tok2' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(validateSpy).toHaveBeenCalledWith(req.app.locals.db, 'p2', 'tok2');
  });

  it('returns 400 with "Token inválido" when the service throws', async () => {
    vi.spyOn(patientService, 'validateConsentToken').mockRejectedValue(new Error('expired'));
    const req = createReq({ body: { patientId: 'p1', token: 'bad' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Token inválido',
      message: 'expired',
    });
  });

  // A template-lookup failure must not be reported as an invalid token: the
  // participant would be told their link is bad and asked to request a new
  // one, which would not help.
  it('returns 503, not 400, when the template lookup fails on a valid token', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplate').mockRejectedValue(new Error('mongo down'));
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Termo de consentimento indisponível' })
    );
  });
});

describe('ConsentController.acceptConsentToken', () => {
  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.acceptConsentToken(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 200 with confirmation on success', async () => {
    const acceptSpy = vi.spyOn(patientService, 'acceptConsentToken').mockResolvedValue({ accepted: true });
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(acceptSpy).toHaveBeenCalledWith(req.app.locals.db, 'p1', 'tok');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Consentimento confirmado com sucesso',
      data: { accepted: true },
    });
  });

  it('returns 400 when the service throws', async () => {
    vi.spyOn(patientService, 'acceptConsentToken').mockRejectedValue(new Error('invalid token'));
    const req = createReq({ body: { patientId: 'p1', token: 'bad' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao aceitar consentimento',
      message: 'invalid token',
    });
  });

  it('falls back to query values when body is empty', async () => {
    const acceptSpy = vi.spyOn(patientService, 'acceptConsentToken').mockResolvedValue({ accepted: true });
    const req = createReq({ body: {}, query: { patientID: 'p2', token: 'tok2' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(acceptSpy).toHaveBeenCalledWith(req.app.locals.db, 'p2', 'tok2');
  });
});
