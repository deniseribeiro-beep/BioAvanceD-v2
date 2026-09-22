import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../../src/controllers/consent.controller');
const consentService = require('../../../src/services/consent.service');
const patientService = require('../../../src/services/patient.service');
const participantIdentityService = require('../../../src/services/participantIdentity.service');
const auditLogger = require('../../../src/utils/auditLogger');

function responseMock() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function requestMock(overrides = {}) {
  return {
    app: { locals: { db: {} } },
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };
}

describe('consent.controller item 8 residual branches', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters empty participantIds before identity lookup and returns null when no identity exists', async () => {
    const pendingPatients = [
      { participantId: 'p1', email: 'one@example.invalid' },
      { participantId: null, email: 'none@example.invalid' },
      { participantId: 'p-missing', email: 'missing@example.invalid' },
    ];
    const patientsToArray = vi.fn().mockResolvedValue(pendingPatients);
    const patientsProject = vi.fn().mockReturnValue({ toArray: patientsToArray });
    const patientsFind = vi.fn().mockReturnValue({ project: patientsProject });

    const identitiesToArray = vi.fn().mockResolvedValue([
      { participantId: 'p1', patientName: 'Synthetic Person' },
    ]);
    const identitiesProject = vi.fn().mockReturnValue({ toArray: identitiesToArray });
    const identitiesFind = vi.fn().mockReturnValue({ project: identitiesProject });

    const db = {
      collection: vi.fn((name) => {
        if (name === 'patients') return { find: patientsFind };
        if (name === 'participantIdentities') return { find: identitiesFind };
        throw new Error(`unexpected collection: ${name}`);
      }),
    };
    vi.spyOn(participantIdentityService, 'decryptIdentity').mockImplementation((identity) => identity);
    const res = responseMock();

    await controller.getPendingPatientsForPolicy(
      requestMock({ app: { locals: { db } }, params: { id: ' policy-1 ' } }),
      res
    );

    expect(patientsFind).toHaveBeenCalledWith({
      status: 'PENDING_CONSENT',
      consentTemplateId: 'policy-1',
    });
    expect(identitiesFind).toHaveBeenCalledWith({
      participantId: { $in: ['p1', 'p-missing'] },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({ participantId: 'p1', patientName: 'Synthetic Person' }),
        expect.objectContaining({ participantId: null, patientName: null }),
        expect.objectContaining({ participantId: 'p-missing', patientName: null }),
      ],
    });
  });

  it('passes explicit history pagination/search and versionGroupId fallback to the service', async () => {
    const service = vi.spyOn(consentService, 'getPoliciesHistory').mockResolvedValue({
      items: [],
      pagination: { page: 3, limit: 7, total: 0 },
    });
    const req = requestMock({
      query: {
        page: '3',
        limit: '7',
        search: 'synthetic',
        versionGroupId: 'group-v2',
      },
    });
    const res = responseMock();

    await controller.getPoliciesHistory(req, res);

    expect(service).toHaveBeenCalledWith(req.app.locals.db, {
      page: 3,
      limit: 7,
      search: 'synthetic',
      groupId: 'group-v2',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('prefers groupId over versionGroupId in policy history queries', async () => {
    const service = vi.spyOn(consentService, 'getPoliciesHistory').mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 10, total: 0 },
    });
    const req = requestMock({
      query: {
        groupId: 'canonical-group',
        versionGroupId: 'legacy-group',
      },
    });

    await controller.getPoliciesHistory(req, responseMock());

    expect(service).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({
      groupId: 'canonical-group',
    }));
  });

  it('updatePolicy normalizes a missing body to an empty object and skips audit without a user', async () => {
    const policy = {
      _id: { toString: () => 'policy-2' },
      title: 'Synthetic TCLE',
      version: '2.0',
      active: true,
    };
    const update = vi.spyOn(consentService, 'updatePolicy').mockResolvedValue(policy);
    const audit = vi.spyOn(auditLogger, 'log').mockResolvedValue();
    const req = requestMock({ params: { id: 'policy-1' }, body: undefined, user: undefined });
    const res = responseMock();

    await controller.updatePolicy(req, res);

    expect(update).toHaveBeenCalledWith(req.app.locals.db, 'policy-1', {});
    expect(audit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('createPatientConsent prefers canonical participantId and allows network metadata to be absent', async () => {
    const consent = {
      _id: { toString: () => 'consent-1' },
      participantId: 'canonical-patient',
      consentTemplateId: 'template-1',
      status: 'SIGNED',
    };
    const create = vi.spyOn(consentService, 'createPatientConsent').mockResolvedValue(consent);
    const req = requestMock({
      body: {
        participantId: 'canonical-patient',
        consentTemplateId: 'template-1',
      },
      headers: {},
      connection: undefined,
      ip: undefined,
    });
    const res = responseMock();

    await controller.createPatientConsent(req, res);

    expect(create).toHaveBeenCalledWith(req.app.locals.db, expect.objectContaining({
      participantId: 'canonical-patient',
      ipAddress: undefined,
      userAgent: undefined,
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('createPatientConsent preserves an explicit domain statusCode', async () => {
    vi.spyOn(consentService, 'createPatientConsent').mockRejectedValue(
      Object.assign(new Error('consent payload rejected'), { statusCode: 422 })
    );
    const res = responseMock();

    await controller.createPatientConsent(
      requestMock({ body: { participantId: 'p1' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Erro ao registrar consentimento',
      message: 'consent payload rejected',
    }));
  });

  it('validateConsentToken accepts the body participantId and normalizes optional public-template fields', async () => {
    const validate = vi.spyOn(patientService, 'validateConsentToken').mockResolvedValue({
      valid: true,
      participantId: 'body-alias',
    });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue({
      _id: 'template-1',
      title: 'Synthetic TCLE',
      content: 'Synthetic consent content',
      version: '',
      permissions: { unexpected: true },
    });
    const res = responseMock();

    await controller.validateConsentToken(
      requestMock({
        body: { participantId: 'body-alias', token: 'token-body' },
        query: { participantId: 'query-value', token: 'token-query' },
      }),
      res
    );

    expect(validate).toHaveBeenCalledWith(
      expect.anything(),
      'body-alias',
      'token-body'
    );
    const payload = res.json.mock.calls.at(-1)[0];
    expect(payload.data.template).toEqual({
      id: 'template-1',
      title: 'Synthetic TCLE',
      content: 'Synthetic consent content',
      version: null,
      permissions: [],
    });
  });

  it('validateConsentToken accepts query.participantId when body value is absent', async () => {
    const validate = vi.spyOn(patientService, 'validateConsentToken').mockResolvedValue({
      valid: true,
      participantId: 'query-canonical',
    });
    vi.spyOn(consentService, 'getActiveTemplate').mockResolvedValue(null);

    await controller.validateConsentToken(
      requestMock({
        body: {},
        query: { participantId: 'query-canonical', token: 'query-token' },
      }),
      responseMock()
    );

    expect(validate).toHaveBeenCalledWith(
      expect.anything(),
      'query-canonical',
      'query-token'
    );
  });

  it('acceptConsentToken covers body.participantId and query.participantId aliases without exposing token failures', async () => {
    const accept = vi.spyOn(patientService, 'acceptConsentToken').mockResolvedValue({ accepted: true });

    await controller.acceptConsentToken(
      requestMock({
        body: { participantId: 'body-legacy', token: 'body-token' },
        query: { participantId: 'query-canonical', token: 'query-token' },
      }),
      responseMock()
    );

    expect(accept).toHaveBeenLastCalledWith(
      expect.anything(),
      'body-legacy',
      'body-token'
    );

    await controller.acceptConsentToken(
      requestMock({
        body: {},
        query: { participantId: 'query-canonical', token: 'query-token' },
      }),
      responseMock()
    );

    expect(accept).toHaveBeenLastCalledWith(
      expect.anything(),
      'query-canonical',
      'query-token'
    );
  });
});
