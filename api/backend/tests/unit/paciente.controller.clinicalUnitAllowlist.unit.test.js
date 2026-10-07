import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ=';
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const controller = require('../../src/controllers/paciente.controller');
const patientService = require('../../src/services/patient.service');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  };
}

function createReq(overrides = {}) {
  return {
    app: { locals: { db: {} } },
    params: {},
    query: {},
    body: {},
    t: (key) => key,
    ...overrides
  };
}

function makeOrganizationsCollection(orgs) {
  return {
    findOne: vi.fn().mockImplementation((query = {}) =>
      Promise.resolve(
        orgs.find((org) =>
          (query.organizationId && org.organizationId === query.organizationId) ||
          (query.normalizedName && org.normalizedName === query.normalizedName)
        ) || null
      )
    )
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// #356: paciente.controller.js's clinicalUnitId/clinicalUnit/unitAcronym allowlist
// was decided (like #355) to stay as-is now that clinicalUnitId is resolved as an
// Organization reference by patient.service.js's resolveClinicalUnitSnapshot
// (fd6f5e84). These tests prove the controller's allowlist/normalization doesn't
// mangle an organizationId reference on its way into that resolution, end to end.
describe('paciente.controller clinicalUnit allowlist stays Organization-reference-safe (#356)', () => {
  it('rejectCanonicalAliases still allows clinicalUnitId/clinicalUnit/unitAcronym together', () => {
    expect(() =>
      controller.rejectCanonicalAliases({
        clinicalUnitId: 'org-1',
        clinicalUnit: 'Genética Médica',
        unitAcronym: 'GEN'
      })
    ).not.toThrow();
  });

  it('sanitizePatientPayload does not case-fold a clinicalUnitId organizationId reference', () => {
    // clinicalUnitId is opaque (an Organization.organizationId, e.g. a UUID) —
    // unlike clinicalUnit/unitAcronym it must never be uppercased, or a mixed-case
    // organizationId would fail resolveClinicalUnitSnapshot's exact findOne match.
    const result = controller.sanitizePatientPayload({ clinicalUnitId: '  Org-AbC123  ' });
    expect(result.clinicalUnitId).toBe('Org-AbC123');
  });

  it('a clinicalUnitId submitted through the HTTP payload survives sanitizePatientPayload and still resolves against the real Organization lookup', async () => {
    const organizations = makeOrganizationsCollection([
      { organizationId: 'org-1', officialName: 'Genética Médica', acronym: 'GEN', normalizedName: 'genetica medica' }
    ]);
    const db = { collection: vi.fn((name) => (name === 'organizations' ? organizations : null)) };

    const sanitized = controller.sanitizePatientPayload({ clinicalUnitId: ' org-1 ' });
    const snapshot = await patientService.resolveClinicalUnitSnapshot(db, sanitized);

    expect(snapshot).toEqual({
      clinicalUnitId: 'org-1',
      clinicalUnit: 'Genética Médica',
      unitAcronym: 'GEN'
    });
  });

  it('cadastrar() forwards the sanitized clinicalUnitId to patientService.createPatient unchanged', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: '12345678' });
    // #1185: global, like the atualizar() case below -- a scoped caller
    // would have its own organization stamped over the body's value.
    const req = createReq({ body: { patientName: 'Foo', clinicalUnitId: ' org-1 ' }, organizationScope: { scope: 'global', organizationIds: [] } });
    const res = createRes();

    await controller.cadastrar(req, res);

    expect(patientService.createPatient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clinicalUnitId: 'org-1' }),
      expect.anything()
    );
  });

  it('atualizar() forwards the sanitized clinicalUnitId to patientService.updatePatient unchanged', async () => {
    vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ participantId: '12345678' });
    // #626: atualizar() now pre-fetches the existing patient for its
    // org-scope check before updating.
    vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
    const samplesCollection = { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
    const req = createReq({
      app: { locals: { db: { collection: vi.fn().mockReturnValue(samplesCollection) } } },
      params: { id: '12345678' },
      body: { clinicalUnitId: ' org-1 ' },
      organizationScope: { scope: 'global', organizationIds: [] }
    });
    const res = createRes();

    await controller.atualizar(req, res);

    expect(patientService.updatePatient).toHaveBeenCalledWith(
      expect.anything(),
      '12345678',
      expect.objectContaining({ clinicalUnitId: 'org-1' }),
      expect.anything()
    );
  });
});

// #1053: #626's check proves the patient is CURRENTLY the caller's -- the
// source. clinicalUnitId is the field this module scopes on, and atualizar()
// lets the payload rewrite it, either directly or through a clinicalUnit NAME
// that resolveClinicalUnitSnapshot turns into an organizationId. So without a
// destination check an in-scope caller could push their own patient into
// another organization.
describe('#1053: atualizar() cannot re-parent a patient to another clinical unit', () => {
  const ORGS = [
    { organizationId: 'org-1', officialName: 'Genética Médica', acronym: 'GEN', normalizedName: 'genetica medica' },
    { organizationId: 'org-9', officialName: 'Outra Unidade', acronym: 'OUT', normalizedName: 'outra unidade' }
  ];

  function buildReq(body, organizationScope = { scope: 'organization', organizationIds: ['org-1'] }) {
    const organizations = makeOrganizationsCollection(ORGS);
    const samples = { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
    return createReq({
      app: { locals: { db: { collection: vi.fn((name) => (name === 'organizations' ? organizations : samples)) } } },
      params: { id: '12345678' },
      body,
      organizationScope
    });
  }

  function stubExisting() {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-1' });
    return vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ participantId: '12345678' });
  }

  it('refuses a clinicalUnitId that moves an in-scope patient to another organization', async () => {
    const updateSpy = stubExisting();
    const res = createRes();

    await controller.atualizar(buildReq({ clinicalUnitId: 'org-9' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refuses a clinicalUnit NAME that resolves to another organization', async () => {
    const updateSpy = stubExisting();
    const res = createRes();

    await controller.atualizar(buildReq({ clinicalUnit: 'Outra Unidade' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: an update that names no clinical unit still succeeds', async () => {
    const updateSpy = stubExisting();
    const res = createRes();

    await controller.atualizar(buildReq({ recordNumber: 'PR-1' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateSpy).toHaveBeenCalled();
  });

  // The edit form sends the patient's own unit back, so this is what a
  // normal edit looks like.
  it('CONTROL: re-sending the patient own clinicalUnitId and name is allowed', async () => {
    const updateSpy = stubExisting();
    const res = createRes();

    await controller.atualizar(buildReq({ clinicalUnitId: 'org-1', clinicalUnit: 'Genética Médica' }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateSpy).toHaveBeenCalled();
  });

  it('CONTROL: a global scope may still move a patient between organizations', async () => {
    const updateSpy = stubExisting();
    const res = createRes();

    await controller.atualizar(buildReq({ clinicalUnitId: 'org-9' }, { scope: 'global', organizationIds: [] }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updateSpy).toHaveBeenCalled();
  });
});

// #1185: the create side of #1053. cadastrar() took clinicalUnitId (or a
// clinicalUnit name) from the body and resolveClinicalUnitSnapshot checked
// only that the Organization EXISTS, so an organization-scoped caller could
// register a patient straight into another organization. #1071's rule for
// every other scoped create: an organization scope stamps its own id and
// ignores the body; a global scope keeps the body's value.
describe('#1185: cadastrar() stamps the caller organization on a patient create', () => {
  const orgScope = { scope: 'organization', organizationIds: ['org-1'] };

  it('replaces a body clinicalUnitId naming another organization', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: '12345678' });
    const req = createReq({ body: { patientName: 'Foo', clinicalUnitId: 'org-9' }, organizationScope: orgScope });
    const res = createRes();

    await controller.cadastrar(req, res);

    expect(patientService.createPatient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clinicalUnitId: 'org-1' }),
      expect.anything()
    );
  });

  it('stamps the caller organization when the body names a unit only by name', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: '12345678' });
    const req = createReq({ body: { patientName: 'Foo', clinicalUnit: 'Outra Unidade' }, organizationScope: orgScope });
    const res = createRes();

    await controller.cadastrar(req, res);

    expect(patientService.createPatient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clinicalUnitId: 'org-1' }),
      expect.anything()
    );
  });

  it('CONTROL: a global scope keeps the body clinicalUnitId', async () => {
    vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: '12345678' });
    const req = createReq({ body: { patientName: 'Foo', clinicalUnitId: 'org-9' }, organizationScope: { scope: 'global', organizationIds: [] } });
    const res = createRes();

    await controller.cadastrar(req, res);

    expect(patientService.createPatient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clinicalUnitId: 'org-9' }),
      expect.anything()
    );
  });
});
