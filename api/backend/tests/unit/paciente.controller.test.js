import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const controller = require('../../src/controllers/paciente.controller');
const patientService = require('../../src/services/patient.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const auditLogger = require('../../src/utils/auditLogger');
const sampleComplianceSync = require('../../src/services/sampleComplianceSync.service');

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
    ...overrides
  };
}

describe('paciente.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      const result = controller.sanitizePatientPayload({ name: 'Foo' });
      expect(result).toEqual({ name: 'Foo' });
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
          representativeCpf: '123.456.789-00',
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
      const req = createReq({ body: { name: 'Foo', isDeceased: true } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining('representante legal') })
      );
    });

    it('creates a patient and returns only the patientID', async () => {
      vi.spyOn(patientService, 'createPatient').mockResolvedValue({ patientID: '12345678', name: 'Foo' });
      const req = createReq({ body: { name: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(patientService.createPatient).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { patientID: '12345678' } })
      );
    });

    it('logs audit entry when req.user is set', async () => {
      vi.spyOn(patientService, 'createPatient').mockResolvedValue({ patientID: '12345678' });
      const logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue();
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const req = createReq({ body: { name: 'Foo' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'Patient' }));
    });

    it('maps duplicate-patient error message to 409', async () => {
      const error = new Error('Paciente já cadastrado');
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(error);
      const req = createReq({ body: { name: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('maps required-field error message to 400', async () => {
      const error = new Error('Campo obrigatório ausente');
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(error);
      const req = createReq({ body: { name: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('defaults to 500 for unrecognized errors', async () => {
      vi.spyOn(patientService, 'createPatient').mockRejectedValue(new Error('boom'));
      const req = createReq({ body: { name: 'Foo' } });
      const res = createRes();

      await controller.cadastrar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
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
          toArray: vi.fn().mockResolvedValue([{ patientID: '1', status: 'ACTIVE' }])
        }),
        countDocuments: vi.fn().mockResolvedValue(1)
      };
      const db = { collection: vi.fn().mockReturnValue(patientsCollection) };
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ app: { locals: { db } }, user: { accessType: 1 } });
      const res = createRes();

      await controller.listar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ total: 1 })
        })
      );
    });

    it('returns full patient data for cadastro role (has createPatient permission)', async () => {
      vi.spyOn(patientService, 'listPatients').mockResolvedValue({ patients: [{ patientID: '1' }], total: 1 });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ user: { accessType: 4 }, query: { patientName: 'Foo' } });
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
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ patientID: '12345678', name: 'Foo' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' }, user: { accessType: 1 } });
      const res = createRes();

      await controller.buscar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ patientID: '12345678' }) })
      );
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.data.name).toBeUndefined();
    });

    it('returns full patient data for cadastro role', async () => {
      vi.spyOn(patientService, 'getPatient').mockResolvedValue({ patientID: '12345678', name: 'Foo' });
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' }, user: { accessType: 4 } });
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
      const { freshController, spy } = reloadControllerWithFreshCompliancySpy();
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await freshController.resendConsentNotification(req, res);

      expect(spy).toHaveBeenCalledWith(req.app.locals.db, '12345678');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 on service error', async () => {
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
      const req = createReq({ params: { id: '1' }, body: { patientID: '2' } });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('updates patient and revalidates samples', async () => {
      vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ patientID: '12345678' });
      const { freshController, spy } = reloadControllerWithFreshCompliancySpy();
      const req = createReq({ params: { id: '12345678' }, body: { name: 'Foo' } });
      const res = createRes();

      await freshController.atualizar(req, res);

      expect(spy).toHaveBeenCalledWith(req.app.locals.db, '12345678');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('logs audit error and returns error statusCode when update fails', async () => {
      const error = new Error('boom');
      error.statusCode = 422;
      vi.spyOn(patientService, 'updatePatient').mockRejectedValue(error);
      const logErrorSpy = vi.spyOn(auditLogger, 'logError').mockResolvedValue();
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      const req = createReq({ params: { id: '12345678' }, body: {}, user: { id: 'u1' } });
      const res = createRes();

      await controller.atualizar(req, res);

      expect(logErrorSpy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(422);
    });
  });

  describe('deletar', () => {
    it('returns 503 when db is missing', async () => {
      const req = createReq({ app: { locals: {} }, params: { id: '1' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('returns 404 when patient not found', async () => {
      vi.spyOn(patientService, 'deletePatient').mockResolvedValue(null);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('deletes patient successfully', async () => {
      vi.spyOn(patientService, 'deletePatient').mockResolvedValue(true);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ params: { id: '12345678' }, user: { id: 'u1' } });
      const res = createRes();

      await controller.deletar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 500 on service error', async () => {
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
      const req = createReq({ body: { patientID: 'abc' } });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns valid:true when patientID exists', async () => {
      const patientAnonymization = require('../../src/utils/patientAnonymization');
      vi.spyOn(patientAnonymization, 'validatePatientID').mockResolvedValue(true);
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ body: { patientID: '12345678' } });
      const res = createRes();

      await controller.validateID(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: { valid: true, patientID: '12345678' } })
      );
    });

    it('returns 500 on unexpected error', async () => {
      const patientAnonymization = require('../../src/utils/patientAnonymization');
      vi.spyOn(patientAnonymization, 'validatePatientID').mockRejectedValue(new Error('boom'));
      const req = createReq({ body: { patientID: '12345678' } });
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
      const req = createReq({ app: { locals: { db } }, body: { patientID: '12345678' } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns patient data when found', async () => {
      const patientsCollection = { findOne: vi.fn().mockResolvedValue({ patientID: '12345678', name: 'Foo' }) };
      const db = { collection: vi.fn().mockReturnValue(patientsCollection) };
      vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
      vi.spyOn(auditLogger, 'log').mockResolvedValue();
      const req = createReq({ app: { locals: { db } }, body: { patientID: '12345678' } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ patientID: '12345678' }) })
      );
    });

    it('returns 500 on unexpected error', async () => {
      const db = { collection: vi.fn().mockImplementation(() => { throw new Error('boom'); }) };
      const req = createReq({ app: { locals: { db } }, body: { patientID: '12345678' } });
      const res = createRes();

      await controller.findForEdit(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
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

      expect(patientService.searchPatients).toHaveBeenCalledWith(req.app.locals.db, 'Foo');
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
        observations: [{ _id: '1', patientID: '12345678', biomarkerType: 'X', collectedAt: 'd', status: 's', unit: 'u', extra: 'secret' }],
        total: 1,
        limit: 50,
        skip: 0
      });
      const req = createReq({ params: { id: '12345678' }, user: { accessType: 1 } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.data.observations[0].extra).toBeUndefined();
    });

    it('returns full observations for cadastro role', async () => {
      vi.spyOn(biomarkerObservationService, 'listPatientObservations').mockResolvedValue({
        observations: [{ _id: '1', patientID: '12345678', extra: 'secret' }],
        total: 1,
        limit: 50,
        skip: 0
      });
      const req = createReq({ params: { id: '12345678' }, user: { accessType: 4 } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg.data.observations[0].extra).toBe('secret');
    });

    it('returns 500 on service error', async () => {
      vi.spyOn(biomarkerObservationService, 'listPatientObservations').mockRejectedValue(new Error('boom'));
      const req = createReq({ params: { id: '12345678' } });
      const res = createRes();

      await controller.listBiomarkerObservations(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
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

    it('creates observation with defaulted fields', async () => {
      vi.spyOn(biomarkerObservationService, 'createObservation').mockResolvedValue({ _id: 'obs1' });
      const req = createReq({ params: { id: '12345678' }, body: { biomarkerType: 'X', value: 1 } });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(biomarkerObservationService.createObservation).toHaveBeenCalledWith(
        req.app.locals.db,
        expect.objectContaining({ patientID: '12345678', source: 'manual', eventType: 'manual', resourceType: 'Observation' })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns error statusCode from service failure', async () => {
      const error = new Error('boom');
      error.statusCode = 409;
      vi.spyOn(biomarkerObservationService, 'createObservation').mockRejectedValue(error);
      const req = createReq({ params: { id: '12345678' }, body: {} });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('defaults to 400 when error has no statusCode', async () => {
      vi.spyOn(biomarkerObservationService, 'createObservation').mockRejectedValue(new Error('boom'));
      const req = createReq({ params: { id: '12345678' }, body: {} });
      const res = createRes();

      await controller.createBiomarkerObservation(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
