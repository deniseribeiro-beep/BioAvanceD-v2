import { describe, it, expect, vi, afterEach } from 'vitest';

const cidController = require('../../src/controllers/cid.controller');
const cidService = require('../../src/services/cid.service');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cid.controller.search', () => {
  it('returns 503 when req.app.locals.db is falsy (unreachable via the real route, but the controller guards it anyway)', async () => {
    const req = { app: { locals: { db: null } }, query: { q: 'colera' } };
    const res = buildRes();

    await cidController.search(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível',
    });
    expect(vi.spyOn(cidService, 'searchPaginated')).not.toHaveBeenCalled();
  });

  it('returns an empty paginated envelope without querying the service when q is shorter than 2 chars', async () => {
    const spy = vi.spyOn(cidService, 'searchPaginated');
    const req = { app: { locals: { db: {} } }, query: { q: ' a ', page: '3', limit: '20' } };
    const res = buildRes();

    await cidController.search(req, res);

    expect(spy).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      items: [],
      pagination: { page: 3, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false, query: 'a' },
    });
  });

  it('defaults page/limit to 1/10 when query params are missing or invalid', async () => {
    vi.spyOn(cidService, 'searchPaginated').mockResolvedValue({ items: [], pagination: {} });
    const req = { app: { locals: { db: {} } }, query: { q: 'colera', page: 'not-a-number', limit: 'nope' } };
    const res = buildRes();

    await cidController.search(req, res);

    expect(cidService.searchPaginated).toHaveBeenCalledWith({}, 'colera', 1, 10);
  });

  it('delegates to cidService.searchPaginated and returns its result as-is', async () => {
    const fakeResult = { items: [{ Descricao: 'Cólera' }], pagination: { page: 1, limit: 10, total: 1 } };
    vi.spyOn(cidService, 'searchPaginated').mockResolvedValue(fakeResult);
    const db = {};
    const req = { app: { locals: { db } }, query: { q: 'colera', page: '2', limit: '5' } };
    const res = buildRes();

    await cidController.search(req, res);

    expect(cidService.searchPaginated).toHaveBeenCalledWith(db, 'colera', 2, 5);
    expect(res.json).toHaveBeenCalledWith(fakeResult);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 500 with the error message when the service throws', async () => {
    vi.spyOn(cidService, 'searchPaginated').mockRejectedValue(new Error('boom'));
    const req = { app: { locals: { db: {} } }, query: { q: 'colera' } };
    const res = buildRes();

    await cidController.search(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao buscar CIDs',
      message: 'boom',
    });
  });
});
