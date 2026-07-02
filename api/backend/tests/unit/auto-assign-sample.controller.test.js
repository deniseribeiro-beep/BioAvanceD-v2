import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { createAutoAssignSampleController } = require('../../src/interface/controllers/auto-assign-sample.controller');
const StorageService = require('../../src/services/storageService');
const logger = require('../../src/utils/logger');

function createReq({ db = {}, neo4jDriver = null, body = { sampleId: 's1', boxId: 'b1' } } = {}) {
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

  it('returns 400 INVALID_INPUT when sampleId is missing', async () => {
    const controller = createAutoAssignSampleController();
    const req = createReq({ body: { boxId: 'b1' } });
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_INPUT',
      message: 'sampleId e boxId são obrigatórios'
    });
  });

  it('returns 400 INVALID_INPUT when boxId is missing', async () => {
    const controller = createAutoAssignSampleController();
    const req = createReq({ body: { sampleId: 's1' } });
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_INPUT',
      message: 'sampleId e boxId são obrigatórios'
    });
  });

  it('returns 201 with sampleLocation, interpolated message and graphPersisted true on success', async () => {
    const sampleLocation = { position: 'A1', sampleId: 's1', boxId: 'b1' };
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      sampleLocation,
      graphPersisted: true
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: sampleLocation,
      message: 'Amostra alocada automaticamente na Posição A1',
      graphPersisted: true
    });
  });

  it('coerces a truthy-but-not-strictly-true graphPersisted value to false', async () => {
    const sampleLocation = { position: 'B2' };
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      sampleLocation,
      graphPersisted: 1
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        graphPersisted: false
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

  it('falls back to 400 for an unrecognized error code', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: false,
      error: 'SOME_OTHER_ERROR',
      message: 'Something else went wrong'
    });

    const controller = createAutoAssignSampleController();
    const req = createReq();
    const res = createRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
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

    expect(res.status).toHaveBeenCalledWith(400);
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
