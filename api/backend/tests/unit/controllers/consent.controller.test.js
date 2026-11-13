import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOTE on mocking strategy: this repo's Vitest setup does not let vi.mock()
// intercept CommonJS require().
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
const { hashConsentToken } = require('../../../src/utils/consentTokenHash');
const participantIdentityService = require('../../../src/services/participantIdentity.service');
const auditLogger = require('../../../src/utils/auditLogger');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
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

// #1127: the controller now splits its catch on WHO is at fault, and the
// service marks the refusals it raises against the caller's own request so the
// controller can tell. A bare Error is an infrastructure failure under that
// contract, so a test that wants the 400 arm must reject with a MARKED error.
//
// This builds one by calling the real service with no arguments, rather than
// re-declaring the marker literal here: a fixture that hand-stamps the code
// would keep passing if the service stopped stamping it, which is exactly the
// drift that would put a token refusal back on the 503 arm unnoticed. If the
// argument guard ever stops being the first thing validateConsentToken does,
// this returns an unmarked error and the tests below go red rather than
// quietly asserting nothing.
async function realConsentTokenRefusal() {
  return patientService.validateConsentToken(null, '', '').catch((error) => error);
}

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

  // #1166 slice 2: email is identity data too. The Patient row carries none
  // here, as it will after slice 4, so the value must come from the
  // decrypted identity record.
  it('#1166: resolves email from a ciphertext-only ParticipantIdentity record', async () => {
    const encrypted = participantIdentityService.encryptIdentityFields({
      participantId: 'p1',
      patientName: 'Paciente Cifrado',
      email: 'cifrado@example.com'
    });
    const ciphertextOnlyIdentity = { ...encrypted, patientName: null, email: null };

    const patientsToArray = vi.fn().mockResolvedValue([{ participantId: 'p1' }]);
    const patientsProject = vi.fn().mockReturnValue({ toArray: patientsToArray });
    const patientsFind = vi.fn().mockReturnValue({ project: patientsProject });

    // Honours the projection it is handed, so a projection that leaves out
    // the ciphertext sibling fails here the way it would against Mongo.
    const identitiesProject = vi.fn((projection) => ({
      toArray: vi.fn().mockResolvedValue([
        Object.fromEntries(Object.entries(ciphertextOnlyIdentity).filter(([key]) => projection[key]))
      ])
    }));
    const identitiesFind = vi.fn().mockReturnValue({ project: identitiesProject });

    const collection = vi.fn((name) =>
      name === 'participantIdentities' ? { find: identitiesFind } : { find: patientsFind }
    );
    const req = createReq({ params: { id: 'policy1' }, app: { locals: { db: { collection } } } });
    const res = createRes();

    await consentController.getPendingPatientsForPolicy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ participantId: 'p1', patientName: 'Paciente Cifrado', email: 'cifrado@example.com' }]
    });
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

  it('returns 422 with details when the service refuses the payload (RNF018)', async () => {
    const refusal = Object.assign(new Error("template must have required property 'content'"), {
      statusCode: 422,
      details: ["template must have required property 'content'"],
    });
    vi.spyOn(consentService, 'updateTemplate').mockRejectedValue(refusal);
    const req = createReq({ params: { id: '1' }, body: {} });
    const res = createRes();

    await consentController.updateTemplate(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ details: refusal.details }));
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
    }), { channel: 'staff_portal', signerRole: 'participant', authenticationLevel: 'session' });
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

    expect(createSpy).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({ ipAddress: '1.2.3.4' }), expect.any(Object));
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

    expect(createSpy).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({ ipAddress: '5.6.7.8' }), expect.any(Object));
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
  // #1188: a Consent has no organization field, so the check runs on its
  // patient -- the #626 shape every other patient read uses.
  it('returns 403 and reads no consent when the patient belongs to another organization', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
    const consentSpy = vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ _id: '1' });
    const req = createReq({ params: { participantId: '12345678' }, organizationScope: { scope: 'organization', organizationIds: ['org-1'] } });
    const res = createRes();

    await consentController.getPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(consentSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: reads the consent of a patient in the caller organization, by that patient id', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-1' });
    const consentSpy = vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ _id: '1' });
    const req = createReq({ params: { participantId: '12345678' }, organizationScope: { scope: 'organization', organizationIds: ['org-1'] } });
    const res = createRes();

    await consentController.getPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(consentSpy).toHaveBeenCalledWith(expect.anything(), '12345678');
  });

  it('returns 503 when db is unavailable', async () => {
    const req = NO_DB_REQ();
    const res = createRes();
    await consentController.getPatientConsent(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 404 when consent is not found', async () => {
    // #1188: params.participantId -- patientId was the route's stale name.
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: 'p1' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const req = createReq({ params: { participantId: 'p1' }, organizationScope: { scope: 'global', organizationIds: [] } });
    const res = createRes();

    await consentController.getPatientConsent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 200 with the consent', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: 'p1' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ _id: '1' });
    const req = createReq({ params: { participantId: 'p1' }, organizationScope: { scope: 'global', organizationIds: [] } });
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
  beforeEach(() => {
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
  });

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

  it('opens the management panel when a consent is already in force', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1', patientStatus: 'PENDING_CONSENT' });
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(ACTIVE_TEMPLATE);
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({
      participantId: 'p1',
      status: 'ACTIVE',
      currentStateDerived: 'active',
      signedAt: '2026-11-05T18:45:07.000Z',
      signedTcleDocumentUri: 'objstore://consents/c-uuid-1/tcle.pdf',
      signedTcleEncryption: { keyId: 'k', iv: 'iv', tag: 'tag' },
      effectivePermissions: { research: true },
    });
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0].data;
    expect(payload.panel).toBe('manage');
    expect(payload.consent.hasSignedTcle).toBe(true);
    expect(payload.consent.signedTcleDocumentUri).toBeUndefined();
    expect(payload.consent.signedTcleEncryption).toBeUndefined();
  });

  it('returns 200 with validation result on success, using body values', async () => {
    const validateSpy = vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(ACTIVE_TEMPLATE);
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
    const templateSpy = vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(ACTIVE_TEMPLATE);
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(templateSpy).toHaveBeenCalledWith(req.app.locals.db, 'p1');
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
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(null);
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
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(ACTIVE_TEMPLATE);
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
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockResolvedValue(ACTIVE_TEMPLATE);
    const req = createReq({ body: {}, query: { patientID: 'p2', token: 'tok2' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(validateSpy).toHaveBeenCalledWith(req.app.locals.db, 'p2', 'tok2');
  });

  // #823: was 'returns 400 with "Token inválido"', asserting `message:
  // 'expired'` -- i.e. it pinned the raw service message being echoed to an
  // unauthenticated caller, which is the enumeration oracle itself. The
  // response must now carry no service detail at all.
  it('returns 400 with an opaque error when the service REFUSES the token', async () => {
    // #1127: was a bare Error. That now means an outage, not a bad token.
    const refusal = await realConsentTokenRefusal();
    expect(patientService.isConsentTokenRejection(refusal)).toBe(true);

    vi.spyOn(patientService, 'validateConsentToken').mockRejectedValue(refusal);
    const req = createReq({ body: { patientId: 'p1', token: 'bad' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Link inválido ou expirado',
    });
  });

  // #1127: the other half of that split. An unmarked error is our failure, not
  // the participant's -- their link is fine, so answering 400 sends them to
  // request a new invitation that cannot help. Same decision the template arm
  // below already makes, now applied to the token check itself.
  it('returns 503, not 400, when the token check fails for an infrastructure reason', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockRejectedValue(new Error('connection <monitor> closed'));
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain('Link inválido ou expirado');
    expect(body).not.toContain('connection <monitor> closed');
  });

  // A template-lookup failure must not be reported as an invalid token: the
  // participant would be told their link is bad and asked to request a new
  // one, which would not help.
  it('returns 503, not 400, when the template lookup fails on a valid token', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplateForParticipant').mockRejectedValue(new Error('mongo down'));
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Termo de consentimento indisponível' })
    );
  });

  // #1138: the assertion above is objectContaining, so it passed either way.
  // This route is unauthenticated, and the body used to carry
  // templateError.message verbatim -- the last raw internal string reaching an
  // unauthenticated caller anywhere in this controller.
  it('does not echo the template error message to the unauthenticated caller', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1' });
    vi.spyOn(consentService, 'getActiveTemplateForParticipant')
      .mockRejectedValue(new Error('connection <monitor> to 10.0.0.5:27017 closed'));
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.validateConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('connection <monitor> to 10.0.0.5:27017 closed');
    expect(body).not.toHaveProperty('message');
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
    const req = createReq({
      body: { patientId: 'p1', token: 'tok', consentTemplateId: 'tpl-1', responses: { storage: true } },
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    // #821: the manifestation and its origin reach the service.
    expect(acceptSpy).toHaveBeenCalledWith(req.app.locals.db, 'p1', 'tok', {
      consentTemplateId: 'tpl-1',
      responses: { storage: true },
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Consentimento confirmado com sucesso',
      data: { accepted: true },
    });
  });

  // #823: same change as the validate case above -- this asserted the raw
  // service message echoed back, and this route is unauthenticated too. It also
  // now answers with the SAME body as validate, so the two routes cannot be
  // played off each other.
  it('returns 400 with an opaque error when the service REFUSES the token', async () => {
    // #1127: was a bare Error. That now means an outage, not a bad token.
    const refusal = await realConsentTokenRefusal();
    expect(patientService.isConsentTokenRejection(refusal)).toBe(true);

    vi.spyOn(patientService, 'acceptConsentToken').mockRejectedValue(refusal);
    const req = createReq({ body: { patientId: 'p1', token: 'bad' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Link inválido ou expirado',
    });
  });

  // #1127: worse here than on validate. acceptConsentToken checks the token
  // and THEN writes, so an unmarked error can mean the participant consented
  // and the write recording it failed. A 400 tells them their link was invalid
  // -- i.e. that they failed to consent, when the system failed to record it.
  it('returns 503, not 400, when the acceptance write fails', async () => {
    vi.spyOn(patientService, 'acceptConsentToken')
      .mockRejectedValue(new Error('connection <monitor> closed'));
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain('Link inválido ou expirado');
    expect(body).not.toContain('connection <monitor> closed');
  });

  // #821: a good link carrying answers that cannot be recorded as sent is
  // neither a bad link (400) nor an outage (503).
  it('returns 422 with a fixed body when the service refuses the MANIFESTATION', async () => {
    const refusal = await patientService
      .acceptConsentToken({ collection: () => ({ findOne: async () => ({ participantId: 'p1', status: 'PENDING_CONSENT', consentTokenHash: hashConsentToken('tok') }) }) }, 'p1', 'tok', {})
      .catch(e => e);
    expect(patientService.isConsentManifestationRejection(refusal)).toBe(true);

    vi.spyOn(patientService, 'acceptConsentToken').mockRejectedValue(refusal);
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Respostas do termo inválidas ou termo atualizado',
      // #1299: the same fixed string as a list; nothing from the service leaks.
      details: ['Respostas do termo inválidas ou termo atualizado'],
    });
  });

  it('falls back to query values when body is empty', async () => {
    const acceptSpy = vi.spyOn(patientService, 'acceptConsentToken').mockResolvedValue({ accepted: true });
    const req = createReq({ body: {}, query: { patientID: 'p2', token: 'tok2' } });
    const res = createRes();

    await consentController.acceptConsentToken(req, res);

    expect(acceptSpy).toHaveBeenCalledWith(req.app.locals.db, 'p2', 'tok2', expect.any(Object));
  });
});

describe('ConsentController.getSignedTcleByToken', () => {
  const consentEvidence = require('../../../src/services/consentEvidence.service');

  it('returns this participant pdf', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1', patientStatus: 'ACTIVE' });
    const consent = {
      participantId: 'p1',
      signedTcleDocumentUri: 'objstore://consents/c-uuid-1/tcle.pdf',
      signedTcleEncryption: { keyId: 'k', iv: 'iv', tag: 'tag' },
    };
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(consent);
    const read = vi.spyOn(consentEvidence, 'readSignedTcle').mockReturnValue(Buffer.from('%PDF-1.4'));
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.getSignedTcleByToken(req, res);

    expect(read).toHaveBeenCalledWith(consent);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="tcle.pdf"');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('refuses a token that does not match', async () => {
    const refusal = await realConsentTokenRefusal();
    vi.spyOn(patientService, 'validateConsentToken').mockRejectedValue(refusal);
    const req = createReq({ body: { patientId: 'p1', token: 'nope' } });
    const res = createRes();

    await consentController.getSignedTcleByToken(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Link inválido ou expirado' });
  });

  it('answers 404 when this consent has no signed file', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1', patientStatus: 'ACTIVE' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ participantId: 'p1' });
    vi.spyOn(consentEvidence, 'readSignedTcle').mockReturnValue(null);
    const req = createReq({ body: { patientId: 'p1', token: 'tok' } });
    const res = createRes();

    await consentController.getSignedTcleByToken(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Termo assinado não encontrado' });
  });

  it('returns 503 when the database is down', async () => {
    const res = createRes();
    await consentController.getSignedTcleByToken(NO_DB_REQ(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Banco de dados não disponível' });
  });

  it('downloads the pdf when the query asks for a file', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1', patientStatus: 'ACTIVE' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ participantId: 'p1' });
    vi.spyOn(consentEvidence, 'readSignedTcle').mockReturnValue(Buffer.from('%PDF-1.4'));
    const res = createRes();

    await consentController.getSignedTcleByToken(createReq({
      body: { participantId: 'p1', token: 'tok' },
      query: { download: '1' },
    }), res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="tcle.pdf"');
  });

  it('answers the same not-found error when the stored file no longer matches', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1', patientStatus: 'ACTIVE' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue({ participantId: 'p1' });
    const mismatch = new Error('hash');
    mismatch.statusCode = 409;
    vi.spyOn(consentEvidence, 'readSignedTcle').mockImplementation(() => { throw mismatch; });
    const res = createRes();

    await consentController.getSignedTcleByToken(createReq({ body: { patientId: 'p1', token: 'tok' } }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Termo assinado não encontrado' });
  });

  it('answers 503 when the signed file cannot be opened', async () => {
    vi.spyOn(patientService, 'validateConsentToken').mockRejectedValue(new Error('storage'));
    const res = createRes();

    await consentController.getSignedTcleByToken(createReq({ body: { patientId: 'p1', token: 'tok' } }), res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Não foi possível abrir o termo assinado' });
  });

  it('answers 404 when the participant has no consent in force', async () => {
    vi.spyOn(patientService, 'validateConsentToken')
      .mockResolvedValue({ valid: true, participantId: 'p1', patientStatus: 'ACTIVE' });
    vi.spyOn(consentService, 'getPatientConsent').mockResolvedValue(null);
    const res = createRes();

    await consentController.getSignedTcleByToken(createReq({ body: { patientId: 'p1', token: 'tok' } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
