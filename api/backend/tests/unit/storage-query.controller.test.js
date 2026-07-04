import { describe, it, expect, vi, afterEach } from 'vitest';

const {
  createListFreezersController,
  createSearchSamplesController,
  createGetSampleLocationController,
  createGetAvailablePositionsController,
  createValidatePositionController,
  createGetFreezerStatsController,
  createCheckBoxIntegrityController,
  createGetFreezerTreeController
} = require('../../src/interface/controllers/storage-query.controller');

const ListOperationalFreezersUseCase = require('../../src/core/use-cases/ListOperationalFreezersUseCase');
const SearchAllocatableSamplesUseCase = require('../../src/core/use-cases/SearchAllocatableSamplesUseCase');
const GetSampleStorageLocationUseCase = require('../../src/core/use-cases/GetSampleStorageLocationUseCase');
const GetBoxAvailablePositionsUseCase = require('../../src/core/use-cases/GetBoxAvailablePositionsUseCase');
const ValidateStoragePositionUseCase = require('../../src/core/use-cases/ValidateStoragePositionUseCase');
const GetFreezerOccupancyStatsUseCase = require('../../src/core/use-cases/GetFreezerOccupancyStatsUseCase');
const CheckStorageBoxIntegrityUseCase = require('../../src/core/use-cases/CheckStorageBoxIntegrityUseCase');
const GetFreezerTreeUseCase = require('../../src/core/use-cases/GetFreezerTreeUseCase');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildReq(overrides = {}) {
  return { app: { locals: { db: {} } }, params: {}, query: {}, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('storage-query.controller.listFreezersController', () => {
  const controller = createListFreezersController();

  it('returns 200 with data from the use case', async () => {
    vi.spyOn(ListOperationalFreezersUseCase.prototype, 'execute').mockResolvedValue([{ freezerId: 'F1' }]);
    const req = buildReq();
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ freezerId: 'F1' }] });
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(ListOperationalFreezersUseCase.prototype, 'execute').mockRejectedValue(new Error('db down'));
    const req = buildReq();
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'db down'
    });
  });
});

describe('storage-query.controller.searchSamplesController', () => {
  const controller = createSearchSamplesController();

  it('passes req.query.q through to the use case and returns 200', async () => {
    const executeSpy = vi
      .spyOn(SearchAllocatableSamplesUseCase.prototype, 'execute')
      .mockResolvedValue([{ sampleId: 'S1' }]);
    const req = buildReq({ query: { q: 'blood' } });
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith({ query: 'blood' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [{ sampleId: 'S1' }] });
  });

  it('defaults query to an empty string when req.query.q is absent', async () => {
    const executeSpy = vi.spyOn(SearchAllocatableSamplesUseCase.prototype, 'execute').mockResolvedValue([]);
    const req = buildReq({ query: {} });
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith({ query: '' });
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(SearchAllocatableSamplesUseCase.prototype, 'execute').mockRejectedValue(new Error('search failed'));
    const req = buildReq({ query: { q: 'x' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'search failed'
    });
  });
});

describe('storage-query.controller.getSampleLocationController', () => {
  const controller = createGetSampleLocationController();

  it('returns 200 with the location when found', async () => {
    vi.spyOn(GetSampleStorageLocationUseCase.prototype, 'execute').mockResolvedValue({
      found: true,
      location: { boxId: 'B1', position: 'A1' }
    });
    const req = buildReq({ params: { sampleId: 'sample-1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { boxId: 'B1', position: 'A1' } });
  });

  it('returns 404 when the sample is not found', async () => {
    vi.spyOn(GetSampleStorageLocationUseCase.prototype, 'execute').mockResolvedValue({
      found: false,
      error: 'SAMPLE_NOT_FOUND'
    });
    const req = buildReq({ params: { sampleId: 'missing' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, found: false, error: 'SAMPLE_NOT_FOUND' });
  });

  it('returns 400 when not found for a reason other than SAMPLE_NOT_FOUND', async () => {
    vi.spyOn(GetSampleStorageLocationUseCase.prototype, 'execute').mockResolvedValue({
      found: false,
      error: 'INVALID_SAMPLE_ID'
    });
    const req = buildReq({ params: { sampleId: '' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(GetSampleStorageLocationUseCase.prototype, 'execute').mockRejectedValue(new Error('boom'));
    const req = buildReq({ params: { sampleId: 's1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'boom'
    });
  });
});

describe('storage-query.controller.getAvailablePositionsController', () => {
  const controller = createGetAvailablePositionsController();

  it('returns 200 with the use case result', async () => {
    vi.spyOn(GetBoxAvailablePositionsUseCase.prototype, 'execute').mockResolvedValue({ positions: ['A1', 'A2'] });
    const req = buildReq({ params: { boxId: 'box-1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { positions: ['A1', 'A2'] } });
  });

  it('returns 404 when the error message indicates the box was not found ("não encontrada")', async () => {
    vi.spyOn(GetBoxAvailablePositionsUseCase.prototype, 'execute').mockRejectedValue(
      new Error('Caixa não encontrada')
    );
    const req = buildReq({ params: { boxId: 'missing-box' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Caixa não encontrada'
    });
  });

  it('returns 500 for a generic error message', async () => {
    vi.spyOn(GetBoxAvailablePositionsUseCase.prototype, 'execute').mockRejectedValue(new Error('unexpected failure'));
    const req = buildReq({ params: { boxId: 'box-1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('storage-query.controller.validatePositionController', () => {
  const controller = createValidatePositionController();

  it('returns 200 when the position is available', async () => {
    vi.spyOn(ValidateStoragePositionUseCase.prototype, 'execute').mockResolvedValue({ available: true });
    const req = buildReq({ params: { boxId: 'box-1', position: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, available: true });
  });

  it('returns 409 when the position is not available', async () => {
    vi.spyOn(ValidateStoragePositionUseCase.prototype, 'execute').mockResolvedValue({
      available: false,
      reason: 'OCCUPIED'
    });
    const req = buildReq({ params: { boxId: 'box-1', position: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, available: false, reason: 'OCCUPIED' });
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(ValidateStoragePositionUseCase.prototype, 'execute').mockRejectedValue(new Error('boom'));
    const req = buildReq({ params: { boxId: 'box-1', position: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'boom'
    });
  });
});

describe('storage-query.controller.getFreezerStatsController', () => {
  const controller = createGetFreezerStatsController();

  it('returns 200 with stats when found', async () => {
    vi.spyOn(GetFreezerOccupancyStatsUseCase.prototype, 'execute').mockResolvedValue({
      stats: { occupied: 10, total: 100 }
    });
    const req = buildReq({ params: { freezerId: 'F1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { occupied: 10, total: 100 } });
  });

  it('returns 404 when the freezer is not found', async () => {
    vi.spyOn(GetFreezerOccupancyStatsUseCase.prototype, 'execute').mockResolvedValue({
      stats: null,
      error: 'FREEZER_NOT_FOUND'
    });
    const req = buildReq({ params: { freezerId: 'missing' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, stats: null, error: 'FREEZER_NOT_FOUND' });
  });

  it('returns 400 when stats are missing for a reason other than FREEZER_NOT_FOUND', async () => {
    vi.spyOn(GetFreezerOccupancyStatsUseCase.prototype, 'execute').mockResolvedValue({
      stats: null,
      error: 'INVALID_FREEZER_ID'
    });
    const req = buildReq({ params: { freezerId: '' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(GetFreezerOccupancyStatsUseCase.prototype, 'execute').mockRejectedValue(new Error('boom'));
    const req = buildReq({ params: { freezerId: 'F1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('storage-query.controller.checkBoxIntegrityController', () => {
  const controller = createCheckBoxIntegrityController();

  it('returns 200 when the box is valid', async () => {
    vi.spyOn(CheckStorageBoxIntegrityUseCase.prototype, 'execute').mockResolvedValue({ valid: true, issues: [] });
    const req = buildReq({ params: { boxId: 'box-1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { valid: true, issues: [] } });
  });

  it('returns 400 when the box is invalid', async () => {
    vi.spyOn(CheckStorageBoxIntegrityUseCase.prototype, 'execute').mockResolvedValue({
      valid: false,
      issues: ['duplicate position']
    });
    const req = buildReq({ params: { boxId: 'box-1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      data: { valid: false, issues: ['duplicate position'] }
    });
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(CheckStorageBoxIntegrityUseCase.prototype, 'execute').mockRejectedValue(new Error('boom'));
    const req = buildReq({ params: { boxId: 'box-1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('storage-query.controller.getFreezerTreeController', () => {
  const controller = createGetFreezerTreeController();

  it('returns 200 with the tree when found', async () => {
    vi.spyOn(GetFreezerTreeUseCase.prototype, 'execute').mockResolvedValue({ freezerId: 'F1', shelves: [] });
    const req = buildReq({ params: { freezerId: 'F1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { freezerId: 'F1', shelves: [] } });
  });

  it('returns 404 with a message including the freezer id when the tree is falsy', async () => {
    vi.spyOn(GetFreezerTreeUseCase.prototype, 'execute').mockResolvedValue(null);
    const req = buildReq({ params: { freezerId: 'F-missing' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'FREEZER_NOT_FOUND',
      message: 'Freezer F-missing não encontrado'
    });
  });

  it('returns 500 with error message when the use case throws', async () => {
    vi.spyOn(GetFreezerTreeUseCase.prototype, 'execute').mockRejectedValue(new Error('boom'));
    const req = buildReq({ params: { freezerId: 'F1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'boom'
    });
  });
});
