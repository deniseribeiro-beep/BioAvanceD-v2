import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const controller = require('../../src/controllers/consent.controller');
const consentService = require('../../src/services/consent.service');
const patientService = require('../../src/services/patient.service');

function responseMock() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function requestWithDb(db, overrides = {}) {
  return {
    app: { locals: { db } },
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };
}

describe('consent.controller.js item 8 residual branches', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves pending-patient policyId from the query and skips identity lookup when no participantId exists', async () => {
    const patientsCursor = {
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    const identitiesFind = vi.fn();
    const db = {
      collection: vi.fn((name) => {
        if (name === 'patients') {
          return { find: vi.fn(() => patientsCursor) };
        }
        if (name === 'participantIdentities') {
          return { find: identitiesFind };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    };
    const req = requestWithDb(db, {
      params: { id: '' },
      query: { policyId: 'policy-from-query' },
    });
    const res = responseMock();

    await controller.getPendingPatientsForPolicy(req, res);

    const patients = db.collection.mock.results[0].value;
    expect(patients.find).toHaveBeenCalledWith({
      status: 'PENDING_CONSENT',
      consentTemplateId: 'policy-from-query',
    });
    expect(identitiesFind).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({ success: true, data: [] });
  });

  it('uses policy-history defaults and versionGroupId as the groupId compatibility alias', async () => {
    const historySpy = vi.spyOn(consentService, 'getPoliciesHistory').mockResolvedValue({
      items: [],
      pagination: { total: 0 },
    });
    const db = {};
    const req = requestWithDb(db, {
      query: {
        page: '0',
        limit: '0',
        versionGroupId: 'version-group-2',
      },
    });
    const res = responseMock();

    await controller.getPoliciesHistory(req, res);

    expect(historySpy).toHaveBeenCalledWith(db, {
      page: 1,
      limit: 10,
      search: '',
      groupId: 'version-group-2',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns the empty current-template envelope when neither active nor historical templates exist', async () => {
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
    vi.spyOn(consentService, 'getLatestTemplate').mockResolvedValue(null);
    const res = responseMock();

    await controller.getCurrentTemplate(requestWithDb({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({
      success: true,
      data: null,
      source: 'empty',
      message: 'Nenhum template de consentimento encontrado.',
    });
  });

  it('returns the latest template when no template is active', async () => {
    const latest = { _id: 'template-latest', version: 'v3' };
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);
    vi.spyOn(consentService, 'getLatestTemplate').mockResolvedValue(latest);
    const res = responseMock();

    await controller.getCurrentTemplate(requestWithDb({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toEqual({
      success: true,
      data: latest,
      source: 'latest',
      message: 'Nenhum template ativo encontrado, retornando o template mais recente.',
    });
  });

  it('builds patient-consent payload from participantId and the connection address when primary aliases are absent', async () => {
    const createSpy = vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue({
      _id: 'consent-1',
      participantId: 'P-200',
      status: 'ACTIVE',
    });
    const db = {};
    const req = requestWithDb(db, {
      body: { participantId: 'P-200', consentTemplateId: 'template-1' },
      ip: '',
      headers: { 'user-agent': 'vitest-agent' },
      connection: { remoteAddress: '198.51.100.24' },
      user: undefined,
    });
    const res = responseMock();

    await controller.createPatientConsent(req, res);

    expect(createSpy).toHaveBeenCalledWith(db, expect.objectContaining({
      participantId: 'P-200',
      ipAddress: '198.51.100.24',
      userAgent: 'vitest-agent',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('resolves validate-token inputs from canonical query fields and normalizes optional template fields', async () => {
    const validateSpy = vi.spyOn(patientService, 'validateConsentToken').mockResolvedValue({
      valid: true,
      participantId: 'P-300',
    });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue({
      _id: 'template-300',
      title: 'TCLE',
      content: '<p>Termo</p>',
      version: '',
      permissions: 'legacy-non-array',
    });
    const req = requestWithDb({}, {
      body: {},
      query: { participantId: 'P-300', token: 'query-token' },
    });
    const res = responseMock();

    await controller.validateConsentToken(req, res);

    expect(validateSpy).toHaveBeenCalledWith({}, 'P-300', 'query-token');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.template).toEqual({
      id: 'template-300',
      title: 'TCLE',
      content: '<p>Termo</p>',
      version: null,
      permissions: [],
    });
  });

  it.each([
    {
      label: 'createPolicy',
      controllerMethod: 'createPolicy',
      serviceMethod: 'createPolicy',
      req: { body: { title: 'Policy' } },
      result: { _id: 'policy-1', title: 'Policy', version: 'v1', active: true },
      status: 201,
    },
    {
      label: 'updatePolicy',
      controllerMethod: 'updatePolicy',
      serviceMethod: 'updatePolicy',
      req: { params: { id: 'policy-1' }, body: undefined },
      result: { _id: 'policy-2', title: 'Policy v2', version: 'v2', active: true },
      status: 200,
    },
    {
      label: 'createTemplate',
      controllerMethod: 'createTemplate',
      serviceMethod: 'createTemplate',
      req: { body: { title: 'Template' } },
      result: { _id: 'template-1', title: 'Template', version: 'v1', active: true },
      status: 201,
    },
    {
      label: 'updateTemplate',
      controllerMethod: 'updateTemplate',
      serviceMethod: 'updateTemplate',
      req: { params: { id: 'template-1' }, body: undefined },
      result: { _id: 'template-2', title: 'Template v2', version: 'v2', active: true },
      status: 200,
    },
    {
      label: 'revokeConsent',
      controllerMethod: 'revokeConsent',
      serviceMethod: 'revokeConsent',
      req: { params: { id: 'consent-1' } },
      result: { _id: 'consent-1', participantId: 'P-1', consentTemplateId: 'template-1', status: 'REVOKED' },
      status: 200,
    },
  ])('$label succeeds without entering the authenticated audit branch', async ({ controllerMethod, serviceMethod, req: requestOverrides, result, status }) => {
    const serviceSpy = vi.spyOn(consentService, serviceMethod).mockResolvedValue(result);
    const db = {};
    const req = requestWithDb(db, {
      ...requestOverrides,
      params: requestOverrides.params || {},
      body: requestOverrides.body,
      user: undefined,
    });
    const res = responseMock();

    await controller[controllerMethod](req, res);

    expect(serviceSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(status);
  });
});
