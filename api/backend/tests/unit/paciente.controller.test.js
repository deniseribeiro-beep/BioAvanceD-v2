import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/paciente.controller');
const patientService = require('../../src/services/patient.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const auditLogger = require('../../src/utils/auditLogger');
const securityService = require('../../src/services/security.service');
const sampleComplianceSync = require('../../src/services/sampleComplianceSync.service');
const { createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

const controllerPath = require.resolve('../../src/controllers/paciente.controller');

// paciente.controller.js destructures revalidateSamplesByPatientID at module load,
// so spying on the sampleComplianceSync module object after the fact won't be seen
// by the controller's already-bound local reference — clear the controller from
// require.cache and re-require it after the spy is set up (see testing-conventions'
// CJS mocking reference, point 4/5).
function reloadControllerWithFreshCompliancySpy() {
  const spy = vi.spyOn(sampleComplianceSync, 'revalidateSamplesByPatientID').mockResolvedValue();
  delete require.cache[controllerPath];
  const freshController = require(controllerPath);
  return { freshController, spy };
}

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
    // #340: in production this is attached by rbac.js's
    // requireOrganizationScope middleware before the controller runs.
    // These tests call the controller directly, bypassing middleware, so
    // default to an unrestricted (Administrador-equivalent) scope — tests
    // exercising org-scope enforcement itself override this explicitly.
    organizationScope: { scope: 'global', organizationIds: [] },
    ...overrides
  };
}

describe('paciente.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rejectCanonicalAliases', () => {
    it('throws 422 when payload contains a non-canonical field', () => {
      expect(() => controller.rejectCanonicalAliases({ patientName: 'Foo', legacyAlias: 'x' })).toThrowError(
        expect.objectContaining({ statusCode: 422, code: 'NON_CANONICAL_FIELD', fields: ['legacyAlias'] })
      );
    });

    // RF021 AC#4 (#594): studyId must be allowed here in lockstep with
    // PatientModel's own allow-list (see patient.model.unit.test.js's
    // equivalent case).
    it('allows studyId', () => {
      expect(() => controller.rejectCanonicalAliases({ patientName: 'Foo', studyId: 'study-1' })).not.toThrow();
    });

    // #345: rejectCanonicalAliases now builds its allow-list off
    // PatientModel.CANONICAL_FIELDS directly instead of a hand-duplicated
    // copy — every Patient-document canonical field must be accepted here
    // with no separate edit required. Proves the two can't drift again.
    it('accepts every field in PatientModel.CANONICAL_FIELDS', () => {
      const PatientModel = require('../../src/models/Patient');
      const payload = Object.fromEntries(PatientModel.CANONICAL_FIELDS.map((field) => [field, 'x']));
      expect(() => controller.rejectCanonicalAliases(payload)).not.toThrow();
    });
  });

  describe('sanitizePatientPayload', () => {
    it('trims/uppercases clinicalUnit, unitAcronym and trims clinicalUnitId', () => {
      const result = controller.sanitizePatientPayload({
        clinicalUnit: ' onco ',
        clinicalUnitId: '  ',
        unitAcronym: ' onc '
      });

      expect(result.clinicalUnit).toBe('ONCO');
      expect(result.clinicalUnitId).toBeNull();
      expect(result.unitAcronym).toBe('ONC');
    });

    it('leaves undefined/null fields untouched', () => {
      const result = controller.sanitizePatientPayload({ patientName: 'Foo' });
      expect(result).toEqual({ patientName: 'Foo' });
    });
  });

  describe('validateDeceasedRepresentative', () => {
    it('does nothing when isDeceased is not true', () => {
      expect(() => controller.validateDeceasedRepresentative({ isDeceased: false })).not.toThrow();
      expect(() => controller.validateDeceasedRepresentative({})).not.toThrow();
    });

    it('throws 400 error when deceased and representative fields are missing', () => {
      expect(() => controller.validateDeceasedRepresentative({ isDeceased: true })).toThrowError(
        expect.objectContaining({ statusCode: 400 })
      );
    });

    it('passes when deceased and all representative fields provided', () => {
      expect(() =>
        controller.validateDeceasedRepresentative({
          isDeceased: true,
          representativeName: 'Jane',
          representativeEmail: 'jane@example.com',
          representativeIdentityDocument: '123.456.789-00',
          representativePhone: '(11) 91234-5678'
        })
      ).not.toThrow();
    });
  });

  describe('cadastrar', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when payload is empty', async () => {
      const req = createReq({ body: {} });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when deceased representative data is missing', async () => {
      const req = createReq({ body: { patientName: 'Foo', isDeceased: true } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining('representante legal') })
      );
    });

    it('creates a patient and returns only the patientID', async () => {
      vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: '12345678', patientName: 'Foo' });
      const req = createReq({ body: { patientName: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(patientService.createPatient).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { participantId: '12345678' } })
      );
    });

    it('logs audit entry when req.user is set', async () => {
      vi.spyOn(patientService, 'createPatient').mockResolvedValue({ participantId: '12345678' });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const req = createReq({ body: { patientName: 'Foo' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', resourceType: 'Patient' }));
    });

    it('maps duplicate-patient error message to 409', async () => {
      const error = new Error('Paciente já cadastrado');
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(error);
      const req = createReq({ body: { patientName: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('maps required-field error message to 400', async () => {
      const error = new Error('Campo obrigatório ausente');
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(error);
      const req = createReq({ body: { patientName: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('defaults to 500 for unrecognized errors', async () => {
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(new Error('boom'));
      const req = createReq({ body: { patientName: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('logs audit error when req.user is set and db is available', async () => {
      const error = new Error('boom');
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(error);
      const logErrorSpy = vi.spyOn(auditLogger, 'logError').mockResolvedValue();
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const req = createReq({ body: { patientName: 'Foo' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(logErrorSpy).toHaveBeenCalledWith(req, 'Patient', error, expect.objectContaining({ action: 'CREATE' }));
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('falls back to a generic i18n message when the error has no message', async () => {
      const error = new Error();
      error.message = '';
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(error);
      const req = createReq({ body: { patientName: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'errors.generic' })
      );
    });
  });

  describe('listar', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await controller.listar(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns only IDs+status for operational role (no createPatient permission)', async () => {
      const patientsCollection = {
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([{ participantId: '12345678', status: 'ACTIVE' }])
        }),
        countDocuments: vi.fn().mockResolvedValue(1)
      };
      const db = createDbMock({ patients: patientsCollection });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ app: { locals: { db } }, user: { accessType: 1, userID: 'operational-user' } });
      const res = createRes();

      await controller.listar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            total: 1,
            patients: [{ participantId: '12345678', status: 'ACTIVE', consentNotifiedAt: null, consentTokenExpiresAt: null }]
          })
        })
      );
    });

    it('defaults status/consentNotifiedAt/consentTokenExpiresAt when missing (operational role)', async () => {
      const patientsCollection = {
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([{ participantId: '12345678' }])
        }),
        countDocuments: vi.fn().mockResolvedValue(1)
      };
      const db = createDbMock({ patients: patientsCollection });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ app: { locals: { db } }, user: { accessType: 1, userID: 'operational-user' } });
      const res = createRes();

      await controller.listar(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patients: [{ participantId: '12345678', status: 'PENDING_CONSENT', consentNotifiedAt: null, consentTokenExpiresAt: null }]
          })
        })
      );
    });

    it('returns full patient data for cadastro role (has createPatient permission)', async () => {
      vi.spyOn(patientService, 'listPatients').mockResolvedValue({ patients: [{ participantId: '12345678' }], total: 1 });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'cadastro-user', accessType: 4 }]) });
      const req = createReq({ app: { locals: { db } }, user: { accessType: 4, userID: 'cadastro-user' }, query: { patientName: 'Foo' } });
      const res = createRes();

      await controller.listar(req, res);

      expect(patientService.listPatients).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 500 on service error', async () => {
      vi.spyOn(patientService, 'listPatients').mockRejectedValue(new Error('boom'));
      const req = createReq({ user: { accessType: 4 } });
      const res = createRes();

      await controller.listar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // #340: the operational branch builds its own raw query directly
    // against patientsCollection (doesn't go through patientService), so
    // the org-scope filter has to be applied here rather than inside
    // listPatients.
    it('restricts the operational-module raw query to clinicalUnitId $in organizationIds for an organization scope', async () => {
      const patientsCollection = {
        find: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([])
        }),
        countDocuments: vi.fn().mockResolvedValue(0)
      };
      const db = createDbMock({ patients: patientsCollection });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({
        app: { locals: { db } },
        user: { accessType: 1, userID: 'operational-user' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.listar(req, res);

      expect(patientsCollection.find).toHaveBeenCalledWith({ clinicalUnitId: { $in: ['org-1'] } }, expect.anything());
      expect(patientsCollection.countDocuments).toHaveBeenCalledWith({ clinicalUnitId: { $in: ['org-1'] } });
    });

    it('passes organizationScope through to patientService.listPatients for the cadastro branch', async () => {
      vi.spyOn(patientService, 'listPatients').mockResolvedValue({ patients: [], total: 0 });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'cadastro-user', accessType: 4 }]) });
      const organizationScope = { scope: 'organization', organizationIds: ['org-1'] };
      const req = createReq({ app: { locals: { db } }, user: { accessType: 4, userID: 'cadastro-user' }, organizationScope });
      const res = createRes();

      await controller.listar(req, res);

      expect(patientService.listPatients).toHaveBeenCalledWith(db, expect.objectContaining({ organizationScope }));
    });
  });

  describe('buscar', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} }, params: { id: '1' } });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when patient not found', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns only ID+status for operational role', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', patientName: 'Foo' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      // #919: seeded as a real level-1 (UsuarioExterno) assignment rather
      // than an empty db. The controller decides via
      // userHasPermission(db, userID, 'createPatient') and never reads
      // req.user.accessType -- so with createDbMock({}) the reduced-field
      // branch fired because there was no RBAC at all, and the test's stated
      // subject ("operational role") was pinned by nothing. UsuarioExterno
      // genuinely lacks createPatient (it holds only viewReports), so the
      // assertion is unchanged; what changes is that it now tests the role.
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'operational-user', accessType: 1 }]) });
      const req = createReq({ app: { locals: { db } }, params: { id: '12345678' }, user: { accessType: 1, userID: 'operational-user' } });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ participantId: '12345678' }) })
      );
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.data.patientName).toBeUndefined();
    });

    it('returns full patient data for cadastro role', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', name: 'Foo' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'cadastro-user', accessType: 4 }]) });
      const req = createReq({ app: { locals: { db } }, params: { id: '12345678' }, user: { accessType: 4, userID: 'cadastro-user' } });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Foo' }) })
      );
    });

    it('returns 500 on service error', async () => {
      vi.spyOn(patientService, 'getPatient').mockRejectedValue(new Error('boom'));
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // #340: an existing patient outside the caller's organization scope
    // 403s rather than 404s (out-of-scope direct access is distinguishable
    // from a nonexistent record only by the response code the frontend
    // never relies on for that distinction), matching
    // sample.routes.js's GET /:id sibling check.
    it('returns 403 when the patient belongs to a different organization', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const req = createReq({
        params: { id: '12345678' },
        user: { accessType: 4, userID: 'cadastro-user' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 200 when the patient belongs to one of the scoped organizations', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-1' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'cadastro-user', accessType: 4 }]) });
      const req = createReq({
        app: { locals: { db } },
        params: { id: '12345678' },
        user: { accessType: 4, userID: 'cadastro-user' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('resendConsentNotification', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await controller.resendConsentNotification(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when patientID is missing', async () => {
      const req = createReq({ params: {}, body: {} });
      const res = createRes();

      await controller.resendConsentNotification(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('resends notification and revalidates samples', async () => {
      vi.spyOn(patientService, 'resendConsentNotification').mockResolvedValue({ sent: true });
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      const { freshController, spy } = reloadControllerWithFreshCompliancySpy();
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await freshController.resendConsentNotification(req, res);

      expect(spy).toHaveBeenCalledWith(req.app.locals.db, '12345678');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // #626: an existing patient outside the caller's organization scope
    // 403s before the notification is resent.
    it('returns 403 when the patient belongs to a different organization', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const resendSpy = vi.spyOn(patientService, 'resendConsentNotification').mockResolvedValue({ sent: true });
      const req = createReq({
        params: { id: '12345678' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.resendConsentNotification(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(resendSpy).not.toHaveBeenCalled();
    });

    it('returns 400 on service error', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(patientService, 'resendConsentNotification').mockRejectedValue(new Error('boom'));
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.resendConsentNotification(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('atualizar', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} }, params: { id: '1' } });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when trying to change patientID', async () => {
      const req = createReq({ params: { id: '1' }, body: { participantId: '2' } });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('updates patient and revalidates samples', async () => {
      vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ participantId: '12345678' });
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      const { freshController, spy } = reloadControllerWithFreshCompliancySpy();
      const req = createReq({ params: { id: '12345678' }, body: { patientName: 'Foo' } });
      const res = createRes();

      await freshController.atualizar(req, res);

      expect(spy).toHaveBeenCalledWith(req.app.locals.db, '12345678');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('logs audit error and returns error statusCode when update fails', async () => {
      const error = new Error('boom');
      error.statusCode = 422;
      vi.spyOn(patientService, 'updatePatient').mockRejectedValue(error);
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      const logErrorSpy = vi.spyOn(auditLogger, 'logError').mockResolvedValue();
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const req = createReq({ params: { id: '12345678' }, body: {}, user: { id: 'u1' } });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(logErrorSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('logs audit entry when req.user is set on success', async () => {
      vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ participantId: '12345678' });
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      const { freshController, spy: complianceSpy } = reloadControllerWithFreshCompliancySpy();
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const req = createReq({ params: { id: '12345678' }, body: { patientName: 'Foo' }, user: { id: 'u1' } });
      const res = createRes();

      await freshController.atualizar(req, res);

      expect(complianceSpy).toHaveBeenCalledWith(req.app.locals.db, '12345678');
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', resourceId: '12345678' }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('falls back to error.status when statusCode is not set', async () => {
      const error = new Error('boom');
      error.status = 418;
      vi.spyOn(patientService, 'updatePatient').mockRejectedValue(error);
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      const req = createReq({ params: { id: '12345678' }, body: {} });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(res.status).toHaveBeenCalledWith(418);
    });

    // #626: an existing patient outside the caller's organization scope
    // 403s before the mutation runs.
    it('returns 403 when the patient belongs to a different organization', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const updateSpy = vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ participantId: '12345678' });
      const req = createReq({
        params: { id: '12345678' },
        body: {},
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('deletar', () => {
    // #1262: the delete reads lgpd.allowDataDeletion, and this file's db is a
    // bare object that cannot answer it, so each case says it is allowed
    // unless it tests the gate.
    beforeEach(() => {
      vi.spyOn(securityService, 'isDataDeletionAllowed').mockResolvedValue(true);
    });

    it('#1262: returns 403 and deletes nothing while lgpd.allowDataDeletion is false', async () => {
      securityService.isDataDeletionAllowed.mockResolvedValue(false);
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678' });
      const deleteSpy = vi.spyOn(patientService, 'deletePatient').mockResolvedValue(true);
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Eliminação desabilitada' }));
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('#1262: the organization scope answers before the setting does', async () => {
      securityService.isDataDeletionAllowed.mockResolvedValue(false);
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const req = createReq({
        params: { id: '12345678' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Este paciente pertence a outra organização' }));
      expect(securityService.isDataDeletionAllowed).not.toHaveBeenCalled();
    });

    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} }, params: { id: '1' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when patient not found', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(patientService, 'deletePatient').mockResolvedValue(null);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('deletes patient successfully', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(patientService, 'deletePatient').mockResolvedValue(true);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    // #626: an existing patient outside the caller's organization scope
    // 403s before the mutation runs.
    it('returns 403 when the patient belongs to a different organization', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const deleteSpy = vi.spyOn(patientService, 'deletePatient').mockResolvedValue(true);
      const req = createReq({
        params: { id: '12345678' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('returns 500 on service error', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(patientService, 'deletePatient').mockRejectedValue(new Error('boom'));
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'logError').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('validateID', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when patientID is missing', async () => {
      const req = createReq({ body: {} });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when patientID format is invalid', async () => {
      const req = createReq({ body: { participantId: 'abc' } });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns valid:true when patientID exists', async () => {
      const patientAnonymization = require('../../src/utils/patientAnonymization');
      vi.spyOn(patientAnonymization, 'validateParticipantId').mockResolvedValue(true);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ body: { participantId: '12345678' } });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { valid: true, participantId: '12345678' } })
      );
    });

    it('returns 500 on unexpected error', async () => {
      const patientAnonymization = require('../../src/utils/patientAnonymization');
      vi.spyOn(patientAnonymization, 'validateParticipantId').mockRejectedValue(new Error('boom'));
      const req = createReq({ body: { participantId: '12345678' } });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('findForEdit', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when patientID is missing from body', async () => {
      const req = createReq({ body: {} });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when patient not found', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue(null) };
      const db = { collection: vi.fn().mockReturnValue(patientsCollection) };
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ app: { locals: { db } }, body: { participantId: '12345678' } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns patient data when found', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ participantId: '12345678', patientName: 'Foo' }) };
      const db = { collection: vi.fn().mockReturnValue(patientsCollection) };
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ app: { locals: { db } }, body: { participantId: '12345678' } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ participantId: '12345678' }) })
      );
    });

    it('returns 500 on unexpected error', async () => {
      const db = { collection: vi.fn().mockImplementation(() => { throw new Error('boom'); }) };
      const req = createReq({ app: { locals: { db } }, body: { participantId: '12345678' } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // #1185: buscar/atualizar/deletar all 403 a patient outside the caller's
    // organization scope (#340/#626); findForEdit returned it for editing.
    it('returns 403 when the patient belongs to a different organization', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' }) };
      const db = { collection: vi.fn().mockReturnValue(patientsCollection) };
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({
        app: { locals: { db } },
        body: { participantId: '12345678' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('CONTROL: returns a patient in the caller organization', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-1' }) };
      const db = { collection: vi.fn().mockReturnValue(patientsCollection) };
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({
        app: { locals: { db } },
        body: { participantId: '12345678' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('search', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} } });
      const res = createRes();

      await controller.search(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 when search term is missing', async () => {
      const req = createReq({ query: {} });
      const res = createRes();

      await controller.search(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when search term is blank', async () => {
      const req = createReq({ query: { q: '   ' } });
      const res = createRes();

      await controller.search(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns search results', async () => {
      vi.spyOn(patientService, 'searchPatients').mockResolvedValue({ patients: [], total: 0 });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ query: { q: 'Foo' } });
      const res = createRes();

      await controller.search(req, res);

      expect(patientService.searchPatients).toHaveBeenCalledWith(req.app.locals.db, 'Foo', req.organizationScope);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 500 and logs error when user is set and service fails', async () => {
      vi.spyOn(patientService, 'searchPatients').mockRejectedValue(new Error('boom'));
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'logError').mockResolvedValue();
      const req = createReq({ query: { q: 'Foo' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.search(req, res);

      expect(auditLogger.init).toHaveBeenCalledWith(req.app.locals.db);
      expect(auditLogger.logError).toHaveBeenCalledWith(req, 'Patient', expect.any(Error), {
        action: 'SEARCH',
        searchTerm: 'Foo'
      });
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('listBiomarkerObservations', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} }, params: { id: '12345678' } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 for invalid patientID', async () => {
      const req = createReq({ params: { id: 'bad' } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('strips extra fields for operational role', async () => {
      vi.spyOn(biomarkerObservationService, 'listPatientObservations').mockResolvedValue({
        observations: [{ _id: '1', participantId: '12345678', biomarkerType: 'X', collectedAt: 'd', status: 's', unit: 'u', extra: 'secret' }],
        total: 1,
        limit: 50,
        skip: 0
      });
      // #919: seeded as a real level-1 (UsuarioExterno) assignment rather
      // than an empty db. The controller decides via
      // userHasPermission(db, userID, 'createPatient') and never reads
      // req.user.accessType -- so with createDbMock({}) the reduced-field
      // branch fired because there was no RBAC at all, and the test's stated
      // subject ("operational role") was pinned by nothing. UsuarioExterno
      // genuinely lacks createPatient (it holds only viewReports), so the
      // assertion is unchanged; what changes is that it now tests the role.
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'operational-user', accessType: 1 }]) });
      const req = createReq({ app: { locals: { db } }, params: { id: '12345678' }, user: { accessType: 1, userID: 'operational-user' } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.data.observations[0].extra).toBeUndefined();
      expect(jsonArg.data.observations[0].participantId).toBe('12345678');
    });

    it('returns full observations for cadastro role', async () => {
      vi.spyOn(biomarkerObservationService, 'listPatientObservations').mockResolvedValue({
        observations: [{ _id: '1', participantId: '12345678', extra: 'secret' }],
        total: 1,
        limit: 50,
        skip: 0
      });
      const db = createDbMock({ ...buildRbacCollections([{ userAccountId: 'cadastro-user', accessType: 4 }]) });
      const req = createReq({ app: { locals: { db } }, params: { id: '12345678' }, user: { accessType: 4, userID: 'cadastro-user' } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.data.observations[0].extra).toBe('secret');
    });

    it('returns 500 on service error', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(biomarkerObservationService, 'listPatientObservations').mockRejectedValue(new Error('boom'));
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    // #626: an existing patient outside the caller's organization scope
    // 403s before observations are read.
    it('returns 403 when the patient belongs to a different organization', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const listSpy = vi.spyOn(biomarkerObservationService, 'listPatientObservations').mockResolvedValue({ observations: [], total: 0, limit: 50, skip: 0 });
      const req = createReq({
        params: { id: '12345678' },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(listSpy).not.toHaveBeenCalled();
    });
  });

  describe('createBiomarkerObservation', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} }, params: { id: '12345678' } });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 400 for invalid patientID', async () => {
      const req = createReq({ params: { id: 'bad' } });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // #626: an existing patient outside the caller's organization scope
    // 403s before the observation is created.
    it('returns 403 when the patient belongs to a different organization', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ participantId: '12345678', clinicalUnitId: 'org-9' });
      const createSpy = vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({ _id: 'obs1' });
      const req = createReq({
        params: { id: '12345678' },
        body: { biomarkerType: 'X', value: 1 },
        organizationScope: { scope: 'organization', organizationIds: ['org-1'] }
      });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('creates observation with defaulted fields', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({ _id: 'obs1' });
      const req = createReq({ params: { id: '12345678' }, body: { biomarkerType: 'X', value: 1 } });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(biomarkerObservationService.createObservation).toHaveBeenCalledWith(
        req.app.locals.db,
        expect.objectContaining({ participantId: '12345678', source: 'manual', eventType: 'manual', resourceType: 'Observation' })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns error statusCode from service failure', async () => {
      const error = new Error('boom');
      error.statusCode = 409;
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(biomarkerObservationService, 'createObservation').mockRejectedValue(error);
      const req = createReq({ params: { id: '12345678' }, body: {} });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('defaults to 400 when error has no statusCode', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(biomarkerObservationService, 'createObservation').mockRejectedValue(new Error('boom'));
      const req = createReq({ params: { id: '12345678' }, body: {} });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('builds a specimen reference from specimenId when specimen is not provided', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
      vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({ _id: 'obs1' });
      const req = createReq({ params: { id: '12345678' }, body: { biomarkerType: 'X', value: 1, specimenId: ' spec-1 ' } });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(biomarkerObservationService.createObservation).toHaveBeenCalledWith(
        req.app.locals.db,
        expect.objectContaining({ specimen: { reference: 'Specimen/spec-1' } })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });
});
