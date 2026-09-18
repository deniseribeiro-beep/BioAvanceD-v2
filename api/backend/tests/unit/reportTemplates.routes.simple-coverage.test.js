import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const router = require('../../src/interface/routes/reportTemplates.routes');
const ReportTemplateModel = require('../../src/models/ReportTemplate');
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

function makeReq({ db = {}, body = {}, params = {}, query = {}, user } = {}) {
  return { app: { locals: { db } }, body, params, query, user };
}

function lastStatus(res) {
  return res.status.mock.calls.at(-1)?.[0];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportTemplates.routes simple branch coverage for item 8', () => {
  it('covers list and get branches including ObjectId/code resolution and failures', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const list = getHandler('/', 'get');
    const getOne = getHandler('/:id', 'get');

    let res = makeRes();
    await list(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    const cursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ code: 'audit' }]),
    };
    const collection = {
      find: vi.fn(() => cursor),
      findOne: vi.fn(),
    };
    const db = { collection: vi.fn(() => collection) };

    res = makeRes();
    await list(makeReq({ db }), res);
    expect(lastStatus(res)).toBe(200);
    expect(cursor.sort).toHaveBeenCalledWith({ isSystemDefined: -1, name: 1 });

    collection.find.mockImplementationOnce(() => { throw new Error('list failed'); });
    res = makeRes();
    await list(makeReq({ db }), res);
    expect(lastStatus(res)).toBe(500);

    res = makeRes();
    await getOne(makeReq({ db: null, params: { id: 'audit' } }), res);
    expect(lastStatus(res)).toBe(503);

    collection.findOne.mockResolvedValueOnce(null);
    res = makeRes();
    await getOne(makeReq({ db, params: { id: 'audit' } }), res);
    expect(lastStatus(res)).toBe(404);
    expect(collection.findOne.mock.calls.at(-1)[0].$or).toEqual([{ code: 'audit' }]);

    collection.findOne.mockResolvedValueOnce({ _id: 'row-1', code: 'audit' });
    res = makeRes();
    const validId = '507f1f77bcf86cd799439011';
    await getOne(makeReq({ db, params: { id: validId } }), res);
    expect(lastStatus(res)).toBe(200);
    expect(collection.findOne.mock.calls.at(-1)[0].$or).toHaveLength(2);

    collection.findOne.mockRejectedValueOnce(new Error('get failed'));
    res = makeRes();
    await getOne(makeReq({ db, params: { id: 'audit' } }), res);
    expect(lastStatus(res)).toBe(500);
  });

  it('covers create validation, duplicate, actor references, defaults and catch branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const create = getHandler('/', 'post');

    let res = makeRes();
    await create(makeReq({ db: null }), res);
    expect(lastStatus(res)).toBe(503);

    const collection = {
      findOne: vi.fn(),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-id' }),
    };
    const db = { collection: vi.fn(() => collection) };

    const validateSpy = vi.spyOn(ReportTemplateModel, 'validate');
    const createSpy = vi.spyOn(ReportTemplateModel, 'create');

    validateSpy.mockReturnValueOnce({ isValid: false, errors: ['bad'] });
    res = makeRes();
    await create(makeReq({ db, body: { code: 'X' } }), res);
    expect(lastStatus(res)).toBe(422);

    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOne.mockResolvedValueOnce({ _id: 'existing' });
    res = makeRes();
    await create(makeReq({ db, body: { code: '  DUPLICATE  ' } }), res);
    expect(lastStatus(res)).toBe(409);
    expect(collection.findOne).toHaveBeenLastCalledWith({ code: 'duplicate' });

    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOne.mockResolvedValueOnce(null);
    createSpy.mockReturnValueOnce({ code: 'one', name: 'One', createdBy: 'User/u-1' });
    res = makeRes();
    await create(makeReq({ db, body: { code: 'ONE' }, user: { userID: 'u-1' } }), res);
    expect(lastStatus(res)).toBe(201);
    expect(createSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      isSystemDefined: false,
      createdBy: 'User/u-1',
    }));

    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOne.mockResolvedValueOnce(null);
    createSpy.mockReturnValueOnce({ code: 'two', name: 'Two', createdBy: 'User/u-2' });
    res = makeRes();
    await create(makeReq({ db, body: { code: 'TWO' }, user: { _id: 'u-2' } }), res);
    expect(lastStatus(res)).toBe(201);

    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOne.mockResolvedValueOnce(null);
    createSpy.mockReturnValueOnce({ code: 'three', name: 'Three', createdBy: null });
    res = makeRes();
    await create(makeReq({ db, body: { code: 'THREE' } }), res);
    expect(lastStatus(res)).toBe(201);
    expect(createSpy).toHaveBeenLastCalledWith(expect.objectContaining({ createdBy: null }));

    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOne.mockRejectedValueOnce(new Error('create failed'));
    res = makeRes();
    await create(makeReq({ db, body: { code: 'FAIL' } }), res);
    expect(lastStatus(res)).toBe(500);

    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    res = makeRes();
    const undefinedBody = makeReq({ db });
    undefinedBody.body = undefined;
    await create(undefinedBody, res);
    expect(lastStatus(res)).toBe(500);
  });

  it('covers update defaults, validation, missing rows, update races and errors', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const update = getHandler('/:id', 'put');

    let res = makeRes();
    await update(makeReq({ db: null, params: { id: 'x' } }), res);
    expect(lastStatus(res)).toBe(503);

    const collection = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
    };
    const db = { collection: vi.fn(() => collection) };
    const validateSpy = vi.spyOn(ReportTemplateModel, 'validate');

    collection.findOne.mockResolvedValueOnce(null);
    res = makeRes();
    await update(makeReq({ db, params: { id: 'missing' } }), res);
    expect(lastStatus(res)).toBe(404);

    const existing = {
      _id: 'row-1',
      code: 'stable',
      name: 'Old',
      description: 'old',
      handlerKey: 'oldHandler',
      handlerOptions: { x: 1 },
      templateStatus: 'active',
    };
    collection.findOne.mockResolvedValueOnce(existing);
    validateSpy.mockReturnValueOnce({ isValid: false, errors: ['invalid'] });
    res = makeRes();
    await update(makeReq({ db, params: { id: 'stable' }, body: { name: 'New', code: 'ignored' } }), res);
    expect(lastStatus(res)).toBe(422);

    collection.findOne.mockResolvedValueOnce(existing);
    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOneAndUpdate.mockResolvedValueOnce(null);
    res = makeRes();
    await update(makeReq({
      db,
      params: { id: 'stable' },
      body: {
        name: 'No row',
        description: null,
        handlerKey: 'h1',
        handlerOptions: 'invalid-options',
        templateStatus: '',
      },
      user: { userID: 'u-1' },
    }), res);
    expect(lastStatus(res)).toBe(404);
    expect(collection.findOneAndUpdate.mock.calls.at(-1)[1].$set).toEqual(expect.objectContaining({
      description: null,
      handlerOptions: {},
      templateStatus: 'active',
      updatedBy: 'User/u-1',
    }));

    collection.findOne.mockResolvedValueOnce(existing);
    validateSpy.mockReturnValueOnce({ isValid: true, errors: [] });
    collection.findOneAndUpdate.mockResolvedValueOnce({ ...existing, name: 'Updated' });
    res = makeRes();
    await update(makeReq({
      db,
      params: { id: 'stable' },
      body: {
        name: 'Updated',
        description: 'desc',
        handlerKey: 'h2',
        handlerOptions: { enabled: true },
        templateStatus: 'inactive',
      },
      user: { _id: 'u-2' },
    }), res);
    expect(lastStatus(res)).toBe(200);
    expect(collection.findOneAndUpdate.mock.calls.at(-1)[1].$set).toEqual(expect.objectContaining({
      description: 'desc',
      handlerOptions: { enabled: true },
      templateStatus: 'inactive',
      updatedBy: 'User/u-2',
    }));

    collection.findOne.mockRejectedValueOnce(new Error('update failed'));
    res = makeRes();
    await update(makeReq({ db, params: { id: 'stable' } }), res);
    expect(lastStatus(res)).toBe(500);
  });

  it('covers delete not-found/system/success/error branches', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const remove = getHandler('/:id', 'delete');

    let res = makeRes();
    await remove(makeReq({ db: null, params: { id: 'x' } }), res);
    expect(lastStatus(res)).toBe(503);

    const collection = {
      findOne: vi.fn(),
      deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const db = { collection: vi.fn(() => collection) };

    collection.findOne.mockResolvedValueOnce(null);
    res = makeRes();
    await remove(makeReq({ db, params: { id: 'missing' } }), res);
    expect(lastStatus(res)).toBe(404);

    collection.findOne.mockResolvedValueOnce({ _id: 'system', isSystemDefined: true });
    res = makeRes();
    await remove(makeReq({ db, params: { id: 'system' } }), res);
    expect(lastStatus(res)).toBe(400);

    collection.findOne.mockResolvedValueOnce({ _id: 'custom', isSystemDefined: false });
    res = makeRes();
    await remove(makeReq({ db, params: { id: 'custom' } }), res);
    expect(lastStatus(res)).toBe(200);
    expect(collection.deleteOne).toHaveBeenLastCalledWith({ _id: 'custom' });

    collection.findOne.mockRejectedValueOnce(new Error('delete failed'));
    res = makeRes();
    await remove(makeReq({ db, params: { id: 'custom' } }), res);
    expect(lastStatus(res)).toBe(500);
  });
});
