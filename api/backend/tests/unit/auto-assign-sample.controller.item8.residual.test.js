import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { createAutoAssignSampleController } = require('../../src/interface/controllers/auto-assign-sample.controller');
const StorageService = require('../../src/services/storageService');
const logger = require('../../src/utils/logger');

function createReq({ db = { collection: vi.fn() }, body = { specimenId: 's1', boxId: 'b1' } } = {}) {
  return { app: { locals: { db } }, body };
}

function createRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auto-assign-sample.controller item 8 residual branches', () => {
  it('rejects when body is null (missing specimenId/boxId)', async () => {
    const controller = createAutoAssignSampleController();
    const res = createRes();

    await controller(createReq({ body: null }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INVALID_INPUT',
      message: 'specimenId e boxId são obrigatórios',
    });
  });

  it('returns a generic success message when placement has no positionCode', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      currentStoragePlacement: { specimenId: 's1', boxId: 'b1' },
      projectionQueued: false,
    });

    const controller = createAutoAssignSampleController();
    const res = createRes();
    await controller(createReq(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Amostra alocada automaticamente',
      currentStoragePlacement: { specimenId: 's1', boxId: 'b1' },
      projectionEventId: null,
    }));
  });

  it('coerces a missing currentStoragePlacement to null on success', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockResolvedValue({
      success: true,
      projectionQueued: true,
      projectionEventId: 'evt-2',
    });

    const controller = createAutoAssignSampleController();
    const res = createRes();
    await controller(createReq(), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: null,
      currentStoragePlacement: null,
      message: 'Amostra alocada automaticamente',
      projectionQueued: true,
      projectionEventId: 'evt-2',
    }));
  });

  it('logs and returns fallback message when the thrown error has no .message', async () => {
    vi.spyOn(StorageService.prototype, 'autoAssignSampleToBox').mockRejectedValue('plain alloc failure');
    const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const controller = createAutoAssignSampleController();
    const res = createRes();
    await controller(createReq(), res);

    expect(loggerSpy).toHaveBeenCalledWith(
      '[AutoAssignSampleController] Erro na alocação automática:',
      'plain alloc failure'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'AUTO_ALLOCATION_ERROR',
      message: 'Erro ao alocar amostra automaticamente',
    });
  });
});
