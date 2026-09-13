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
    const req = createReq({ body: { patientName: 'Foo', clinicalUnitId: ' org-1 ' } });
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
