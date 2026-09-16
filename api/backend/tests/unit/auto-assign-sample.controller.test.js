import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { createAutoAssignSampleController } = require('../../src/interface/controllers/auto-assign-sample.controller');
const StorageService = require('../../src/services/storageService');
const logger = require('../../src/utils/logger');

function createReq({ db = { collection: vi.fn() }, neo4jDriver = null, body = { specimenId: 's1', boxId: 'b1' } } = {}) {
  return {
    app: {
      locals: {
        db,
        neo4jDriver
      }
    },
    body
  };
}

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  };
}

describe('auto-assign-sample.controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 DATABASE_UNAVAILABLE when db is falsy', async () => {
    const controller = createAutoAssignSampleController();
    const req = createReq({ db: null });
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados não disponível'
    });
  });

  it('returns 400 INVALID_INPUT when specimenId is missing', async () => {
    const controller = createAutoAssignSampleController();
    const req = createReq({ body: { boxId: 'b1' } });
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_INPUT',
      message: 'specimenId e boxId são obrigatórios'
    });
  });

  it('rejects the legacy sampleId alias at the canonical v2 boundary', async () => {
    const serviceSpy = vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox');
    const controller = createAutoAssignSampleController();
    const req = createReq({ body: { sampleId: 'legacy-s1', boxId: 'b1' } });
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_INPUT',
      message: 'specimenId e boxId são obrigatórios'
    });
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_INPUT when boxId is missing', async () => {
    const controller = createAutoAssignSampleController();
    const req = createReq({ body: { specimenId: 's1' } });
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_INPUT',
      message: 'specimenId e boxId são obrigatórios'
    });
  });

  it('returns 201 with the canonical placement and queued projection evidence', async () => {
    const currentStoragePlacement = { positionCode: 'A1', specimenId: 's1', boxId: 'b1' };
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      currentStoragePlacement,
      projectionQueued: true,
      projectionEventId: 'evt-1'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(StorageService.prototype.autoAssignSampleToBox).toHaveBeenCalledWith('s1', 'b1');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: currentStoragePlacement,
      currentStoragePlacement,
      message: 'Amostra alocada automaticamente na Posição A1',
      projectionQueued: true,
      projectionEventId: 'evt-1'
    });
  });

  it('coerces a truthy-but-not-strictly-true projectionQueued value to false', async () => {
    const currentStoragePlacement = { positionCode: 'B2' };
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      currentStoragePlacement,
      projectionQueued: 1
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        projectionQueued: false
      })
    );
  });

  it('maps BOX_NOT_FOUND error to 404', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false,
      error: 'BOX_NOT_FOUND',
      message: 'Box not found'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'BOX_NOT_FOUND',
      message: 'Box not found'
    });
  });

  it('maps SAMPLE_NOT_FOUND error to 404', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false,
      error: 'SAMPLE_NOT_FOUND',
      message: 'Sample not found'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'SAMPLE_NOT_FOUND',
      message: 'Sample not found'
    });
  });

  it('maps ALREADY_ALLOCATED error to 409', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false,
      error: 'ALREADY_ALLOCATED',
      message: 'Already allocated'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'ALREADY_ALLOCATED',
      message: 'Already allocated'
    });
  });

  it('maps BOX_FULL error to 409', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false,
      error: 'BOX_FULL',
      message: 'Box is full'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'BOX_FULL',
      message: 'Box is full'
    });
  });

  // #987 applied to this fourth endpoint: an unrecognised error code is by
  // definition not something the caller can fix by changing their input, so
  // it is a 500. This test asserted 400 -- it pinned the defect.
  it('falls back to 500 for an unrecognized error code', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false,
      error: 'SOME_OTHER_ERROR',
      message: 'Something else went wrong'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'SOME_OTHER_ERROR',
      message: 'Something else went wrong'
    });
  });

  it('defaults error/message when result.success is false but error/message are missing', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    // #987: 500, for the reason on the previous test.
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'AUTO_ALLOCATION_ERROR',
      message: 'Erro ao alocar amostra automaticamente'
    });
  });

  it('returns 500 AUTO_ALLOCATION_ERROR with error.message when the service throws', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockRejectedValue(
      new Error('boom')
    );
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'AUTO_ALLOCATION_ERROR',
      message: 'boom'
    });
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
