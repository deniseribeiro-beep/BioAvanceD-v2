import { describe, it, expect, vi, afterEach } from 'vitest';

const analysisTypeController = require('../../src/controllers/analysis-type.controller');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analysis-type.controller.getAnalysisTypes', () => {
  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } } };
    const res = buildRes();

    await analysisTypeController.getAnalysisTypes(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível'
    });
  });

  it('returns 200 with the sorted active analysis types', async () => {
    const types = [{ name: 'Bioquímica' }, { name: 'Hematologia' }];
    const toArray = vi.fn().mockResolvedValue(types);
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const collection = vi.fn().mockReturnValue({ find });
    const req = { app: { locals: { db: { collection } } } };
    const res = buildRes();

    await analysisTypeController.getAnalysisTypes(req, res);

    expect(collection).toHaveBeenCalledWith('analysisTypes');
    expect(find).toHaveBeenCalledWith({ active: true });
    expect(sort).toHaveBeenCalledWith({ name: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: types });
  });

  it('returns 500 with the error message when the query throws', async () => {
    const toArray = vi.fn().mockRejectedValue(new Error('boom'));
    const sort = vi.fn().mockReturnValue({ toArray });
    const find = vi.fn().mockReturnValue({ sort });
    const collection = vi.fn().mockReturnValue({ find });
    const req = { app: { locals: { db: { collection } } } };
    const res = buildRes();

    await analysisTypeController.getAnalysisTypes(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao listar tipos de análise',
      message: 'boom'
    });
  });
});

describe('analysis-type.controller.createAnalysisType', () => {
  function buildDb({ existing = null, insertedId = 'id-1' } = {}) {
    const findOne = vi.fn().mockResolvedValue(existing);
    const insertOne = vi.fn().mockResolvedValue({ insertedId });
    const collection = vi.fn().mockReturnValue({ findOne, insertOne });
    return { collection: { collection }, findOne, insertOne };
  }

  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, body: {} };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Banco de dados não disponível'
    });
  });

  it('derives code from name via slugify when code is missing', async () => {
    const { collection, findOne, insertOne } = buildDb();
    const req = { app: { locals: { db: collection } }, body: { name: 'Análise Ção' } };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(findOne).toHaveBeenCalledWith({ code: 'analise_cao' });
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ code: 'analise_cao' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('lowercases an explicitly provided code', async () => {
    const { collection, findOne } = buildDb();
    const req = { app: { locals: { db: collection } }, body: { name: 'X', code: 'ABC' } };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(findOne).toHaveBeenCalledWith({ code: 'abc' });
  });

  it('returns 422 when validation fails', async () => {
    const { collection, findOne } = buildDb();
    const req = { app: { locals: { db: collection } }, body: {} };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Dados inválidos',
      message: expect.stringContaining('name é obrigatório')
    });
  });

  it('returns 409 when the code already exists', async () => {
    const { collection, insertOne } = buildDb({ existing: { code: 'abc' } });
    const req = { app: { locals: { db: collection } }, body: { name: 'X', code: 'abc' } };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(insertOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Código já existe',
      message: 'Já existe um tipo com o código abc'
    });
  });

  it('creates and returns 201 with the inserted document', async () => {
    const { collection } = buildDb({ insertedId: 'abc123' });
    const req = { app: { locals: { db: collection } }, body: { name: 'Bioquímica', code: 'bio' } };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Tipo de análise criado com sucesso',
      data: expect.objectContaining({ _id: 'abc123', name: 'Bioquímica', code: 'bio' })
    });
  });

  it('returns 400 with the error message when the insert throws', async () => {
    const { collection, insertOne } = buildDb();
    insertOne.mockRejectedValue(new Error('boom'));
    const req = { app: { locals: { db: collection } }, body: { name: 'X', code: 'abc' } };
    const res = buildRes();

    await analysisTypeController.createAnalysisType(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Erro ao criar tipo de análise',
      message: 'boom'
    });
  });
});
