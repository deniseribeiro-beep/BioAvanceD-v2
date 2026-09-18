import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const router = require('../../src/interface/routes/logs.routes');
const logService = require('../../src/services/log.service');
const logger = require('../../src/utils/logger');

function getHandler(path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle;
}

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.send.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);
  return res;
}

function makeReq({ db = {}, query = {}, body = {}, params = {} } = {}) {
  return {
    app: { locals: { db } },
    query,
    body,
    params,
  };
}

function lastStatus(res) {
  return res.status.mock.calls.at(-1)?.[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logs.routes simple branch coverage for item 8', () => {
  it('covers list/all/query db, defaults, success and error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const root = getHandler('/', 'get');
    const all = getHandler('/all', 'get');
    const query = getHandler('/query', 'post');
    const getLogs = vi.spyOn(logService, 'getLogs');

    let res = makeRes();
    await root(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    getLogs.mockResolvedValueOnce({ logs: [], total: 0 });
    res = makeRes();
    await root(makeReq({ db: {}, query: { action: 'CREATE' } }), res);
    expect(lastStatus(res)).toBe(200);
    expect(getLogs).toHaveBeenLastCalledWith({}, { action: 'CREATE' });

    getLogs.mockRejectedValueOnce(new Error('root failed'));
    res = makeRes();
    await root(makeReq(), res);
    expect(lastStatus(res)).toBe(500);

    res = makeRes();
    await all(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    getLogs.mockResolvedValueOnce({ logs: [] });
    res = makeRes();
    await all(makeReq({ query: {} }), res);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), { limit: 5000, page: 1 });
    expect(lastStatus(res)).toBe(200);

    getLogs.mockResolvedValueOnce({ logs: [] });
    res = makeRes();
    await all(makeReq({ query: { limit: 123, module: 'Segurança' } }), res);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), {
      limit: 123,
      module: 'Segurança',
      page: 1,
    });

    getLogs.mockRejectedValueOnce(new Error('all failed'));
    res = makeRes();
    await all(makeReq(), res);
    expect(lastStatus(res)).toBe(500);

    res = makeRes();
    await query(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    getLogs.mockResolvedValueOnce({ logs: [{ logId: 'L1' }] });
    res = makeRes();
    await query(makeReq({ body: { severity: 'critical' } }), res);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), { severity: 'critical' });
    expect(lastStatus(res)).toBe(200);

    getLogs.mockResolvedValueOnce({ logs: [] });
    res = makeRes();
    const undefinedBody = makeReq();
    undefinedBody.body = undefined;
    await query(undefinedBody, res);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), {});

    getLogs.mockRejectedValueOnce(new Error('query failed'));
    res = makeRes();
    await query(makeReq(), res);
    expect(lastStatus(res)).toBe(500);
  });

  it('covers CSV/XLSX defaults, escaping, empty logs and failures', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const csv = getHandler('/export/csv', 'get');
    const xlsx = getHandler('/export/xlsx', 'get');
    const getLogs = vi.spyOn(logService, 'getLogs');

    let res = makeRes();
    await csv(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    getLogs.mockResolvedValueOnce({
      logs: [{
        timestamp: '2026-09-18T00:00:00Z',
        userName: 'A "quoted" user',
        action: 'CREATE',
        entity: 'Sample',
        result: 'success',
        severity: 'info',
        module: 'Test',
        ipSource: null,
        message: 'ok',
      }],
    });
    res = makeRes();
    await csv(makeReq({ query: {} }), res);
    expect(lastStatus(res)).toBe(200);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), { limit: 10000, page: 1 });
    expect(res.send.mock.calls.at(-1)[0]).toContain('"A ""quoted"" user"');
    expect(res.send.mock.calls.at(-1)[0]).toContain('""');

    getLogs.mockResolvedValueOnce({});
    res = makeRes();
    await csv(makeReq({ query: { limit: 25 } }), res);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), { limit: 25, page: 1 });
    expect(res.send.mock.calls.at(-1)[0]).toContain('timestamp,userName');

    getLogs.mockRejectedValueOnce(new Error('csv failed'));
    res = makeRes();
    await csv(makeReq(), res);
    expect(lastStatus(res)).toBe(500);

    res = makeRes();
    await xlsx(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    getLogs.mockResolvedValueOnce({ logs: [{ message: 'xlsx' }] });
    res = makeRes();
    await xlsx(makeReq({ query: {} }), res);
    expect(lastStatus(res)).toBe(200);
    expect(Buffer.isBuffer(res.send.mock.calls.at(-1)[0])).toBe(true);

    getLogs.mockResolvedValueOnce({});
    res = makeRes();
    await xlsx(makeReq({ query: { limit: 9 } }), res);
    expect(getLogs).toHaveBeenLastCalledWith(expect.anything(), { limit: 9, page: 1 });
    expect(lastStatus(res)).toBe(200);

    getLogs.mockRejectedValueOnce(new Error('xlsx failed'));
    res = makeRes();
    await xlsx(makeReq(), res);
    expect(lastStatus(res)).toBe(500);
  });

  it('covers get-by-id ObjectId, logId fallback, not-found and error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const getOne = getHandler('/:id', 'get');

    let res = makeRes();
    await getOne(makeReq({ db: null, params: { id: 'x' } }), res);
    expect(lastStatus(res)).toBe(503);

    const collection = { findOne: vi.fn() };
    const db = { collection: vi.fn(() => collection) };

    collection.findOne.mockResolvedValueOnce(null);
    res = makeRes();
    await getOne(makeReq({ db, params: { id: 'LOG-CODE' } }), res);
    expect(lastStatus(res)).toBe(404);
    expect(collection.findOne).toHaveBeenCalledTimes(1);
    expect(collection.findOne).toHaveBeenLastCalledWith({ logId: 'LOG-CODE' });

    collection.findOne.mockResolvedValueOnce({ _id: 'direct' });
    res = makeRes();
    await getOne(makeReq({ db, params: { id: '507f1f77bcf86cd799439011' } }), res);
    expect(lastStatus(res)).toBe(200);
    expect(collection.findOne).toHaveBeenCalledTimes(2);

    collection.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ logId: '507f1f77bcf86cd799439012' });
    res = makeRes();
    await getOne(makeReq({ db, params: { id: '507f1f77bcf86cd799439012' } }), res);
    expect(lastStatus(res)).toBe(200);

    collection.findOne.mockRejectedValueOnce(new Error('lookup failed'));
    res = makeRes();
    await getOne(makeReq({ db, params: { id: 'LOG-ERR' } }), res);
    expect(lastStatus(res)).toBe(500);
  });
});
