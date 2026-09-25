import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const controller = require('../../src/controllers/paciente.controller');
const patientService = require('../../src/services/patient.service');
const participantIdentityService = require('../../src/services/participantIdentity.service');
const biomarkerObservationService = require('../../src/services/biomarker-observation.service');
const rbacAssignmentService = require('../../src/services/rbac-assignment.service');
const auditLogger = require('../../src/utils/auditLogger');

function responseMock() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function baseReq(db = {}) {
  return {
    app: { locals: { db } },
    params: {},
    body: {},
    query: {},
    user: { userID: 'user-1' },
    organizationScope: { scope: 'organization', organizationIds: ['org-1'] },
  };
}

describe('paciente.controller item 8 residual canonical branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    vi.spyOn(auditLogger, 'log').mockResolvedValue();
    vi.spyOn(auditLogger, 'logError').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reidentify returns 503 without a database', async () => {
    const req = baseReq(null);
    req.params.id = '12345678';
    req.body = { reason: 'validated research purpose' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Banco de dados não disponível',
    }));
  });

  it('reidentify rejects a blank purpose before any patient lookup', async () => {
    const getPatient = vi.spyOn(patientService, 'getPatient');
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = { reason: '   ' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getPatient).not.toHaveBeenCalled();
  });

  it('reidentify returns 404 when the participant does not exist', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = { reason: 'validated research purpose' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Paciente não encontrado',
    }));
  });

  it('reidentify fails closed before resolving civil identity when participant is outside organization scope', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({
      participantId: '12345678',
      clinicalUnitId: 'org-2',
    });
    vi.spyOn(rbacAssignmentService, 'isRecordInOrganizationScope').mockReturnValue(false);
    const identityLookup = vi.spyOn(participantIdentityService, 'getIdentityByParticipantId');
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = { reason: 'validated research purpose' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(identityLookup).not.toHaveBeenCalled();
  });

  it('reidentify audits and returns 404 when the segregated identity record is absent', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({
      participantId: '12345678',
      clinicalUnitId: 'org-1',
    });
    vi.spyOn(rbacAssignmentService, 'isRecordInOrganizationScope').mockReturnValue(true);
    vi.spyOn(participantIdentityService, 'getIdentityByParticipantId').mockResolvedValue(null);
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = { reason: 'validated research purpose' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REIDENTIFY',
      status: 'error',
      resourceId: '12345678',
      payload: { reason: 'validated research purpose' },
    }));
  });

  it('reidentify returns only the authorized segregated civil-identity fields on success', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({
      participantId: '12345678',
      clinicalUnitId: 'org-1',
    });
    vi.spyOn(rbacAssignmentService, 'isRecordInOrganizationScope').mockReturnValue(true);
    vi.spyOn(participantIdentityService, 'getIdentityByParticipantId').mockResolvedValue({
      participantId: '12345678',
      patientName: 'Synthetic Person',
      birthDate: '1990-01-01',
      identityDocument: '00000000000',
      internalSecret: 'must-not-leak',
    });
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = { reason: 'validated research purpose' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        participantId: '12345678',
        patientName: 'Synthetic Person',
        birthDate: '1990-01-01',
        identityDocument: '00000000000',
      },
    });
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REIDENTIFY',
      status: 'success',
      severity: 'warning',
    }));
  });

  it('reidentify maps unexpected service failures to the controller 500 contract', async () => {
    vi.spyOn(patientService, 'getPatient').mockRejectedValue(new Error('lookup failed'));
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = { reason: 'validated research purpose' };
    const res = responseMock();

    await controller.reidentify(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Erro interno do servidor',
      message: 'lookup failed',
    }));
  });

  it('listBiomarkerObservations rejects a noncanonical participantId before service access', async () => {
    const serviceCall = vi.spyOn(biomarkerObservationService, 'listPatientObservations');
    const req = baseReq({});
    req.params.id = 'ABC';
    const res = responseMock();

    await controller.listBiomarkerObservations(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(serviceCall).not.toHaveBeenCalled();
  });

  it('createBiomarkerObservation preserves a domain statusCode from the service error', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue(null);
    vi.spyOn(biomarkerObservationService, 'createObservation').mockRejectedValue(
      Object.assign(new Error('invalid observation'), { statusCode: 422 })
    );
    const req = baseReq({});
    req.params.id = '12345678';
    req.body = {
      biomarkerType: 'synthetic-marker',
      value: 1,
      collectedAt: '2026-01-01T00:00:00.000Z',
    };
    const res = responseMock();

    await controller.createBiomarkerObservation(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Falha ao criar observação biomarcadora',
      message: 'invalid observation',
    }));
  });

  it('audits UPDATE with sanitizedID N/A when participant id is not eight digits', async () => {
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({
      participantId: 'legacy-id',
      clinicalUnitId: 'org-1',
    });
    vi.spyOn(rbacAssignmentService, 'isRecordInOrganizationScope').mockReturnValue(true);
    vi.spyOn(patientService, 'updatePatient').mockResolvedValue({ participantId: 'legacy-id' });

    const db = {
      collection: vi.fn(() => ({
        find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
        updateMany: vi.fn(async () => ({ modifiedCount: 0 })),
        findOne: vi.fn(async () => null),
      })),
    };
    const req = baseReq(db);
    req.params.id = 'legacy-id';
    req.body = { clinicalUnit: 'LAB' };
    req.user = { userID: 'user-1' };
    const res = responseMock();

    await controller.atualizar(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      resourceId: 'N/A',
    }));
  });

  it('audits DELETE not-found and success with sanitizedID N/A for noncanonical ids', async () => {
    vi.spyOn(rbacAssignmentService, 'isRecordInOrganizationScope').mockReturnValue(true);
    vi.spyOn(patientService, 'getPatient').mockResolvedValue({
      participantId: 'ABC',
      clinicalUnitId: 'org-1',
    });
    vi.spyOn(patientService, 'deletePatient')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(true);

    const reqMissing = baseReq({});
    reqMissing.params.id = 'ABC';
    reqMissing.user = { userID: 'user-1' };
    const resMissing = responseMock();
    await controller.deletar(reqMissing, resMissing);
    expect(resMissing.status).toHaveBeenCalledWith(404);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      resourceId: 'N/A',
      status: 'error',
    }));

    const reqOk = baseReq({});
    reqOk.params.id = 'ABC';
    reqOk.user = { userID: 'user-1' };
    const resOk = responseMock();
    await controller.deletar(reqOk, resOk);
    expect(resOk.status).toHaveBeenCalledWith(200);
    expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE',
      resourceId: 'N/A',
      status: 'success',
    }));
  });
});
