import { describe, it, expect, vi, afterEach } from 'vitest';

const MoveSampleUseCase = require('../../src/core/use-cases/MoveSampleUseCase');
const { createMoveSampleController } = require('../../src/interface/controllers/move-sample.controller');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildReq(overrides = {}) {
  return {
    app: { locals: { db: { marker: 'db-v2' } } },
    body: {},
    headers: {},
    ...overrides
  };
}

function buildController({ executeImpl } = {}) {
  const execute = vi.fn(executeImpl || (async () => ({})));
  const constructed = {};

  class StorageRepositoryDouble {
    constructor(db) {
      constructed.storageDb = db;
    }
  }
  class AuditRepositoryDouble {
    constructor(db) {
      constructed.auditDb = db;
    }
  }
  class LineageRepositoryDouble {
    constructor(db) {
      constructed.lineageDb = db;
    }
  }
  class MoveSampleUseCaseDouble {
    constructor(dependencies) {
      constructed.useCaseDependencies = dependencies;
    }

    execute(command) {
      return execute(command);
    }
  }

  const controller = createMoveSampleController({
    MoveSampleUseCaseClass: MoveSampleUseCaseDouble,
    StorageRepositoryClass: StorageRepositoryDouble,
    AuditRepositoryClass: AuditRepositoryDouble,
    LineageRepositoryClass: LineageRepositoryDouble
  });

  return { controller, execute, constructed };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('move-sample.controller canonical v2', () => {
  it('passes specimenId/targetBoxId/targetPosition in a command accepted by the real v2 validator', async () => {
    const { controller } = buildController({
      executeImpl: async (command) => {
        MoveSampleUseCase.prototype.validateCommand(command);
        return { validated: true };
      }
    });
    const req = buildReq({
      body: { specimenId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' }
    });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { validated: true },
      message: 'Amostra movida com sucesso'
    });
  });

  it('returns 503 when MongoDB is unavailable before constructing repositories', async () => {
    const { controller, execute, constructed } = buildController();
    const req = buildReq({ app: { locals: {} } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados não disponível'
    });
    expect(execute).not.toHaveBeenCalled();
    expect(constructed.storageDb).toBeUndefined();
  });

  it('constructs canonical repositories from the request db and returns the governed move result', async () => {
    const result = { specimenId: 'S1', to: { boxId: 'B1', position: 'A1' }, lineageQueued: true };
    const { controller, execute, constructed } = buildController({ executeImpl: async () => result });
    const req = buildReq({
      body: { specimenId: 'S1', targetBoxId: 'B1', targetPosition: 'A1', reason: 'relocation', notes: 'n/a' },
      user: {
        userID: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Alice',
        roleName: 'admin',
      },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' }
    });
    const res = buildRes();

    await controller(req, res);

    expect(constructed.storageDb).toBe(req.app.locals.db);
    expect(constructed.auditDb).toBe(req.app.locals.db);
    expect(constructed.lineageDb).toBe(req.app.locals.db);
    expect(constructed.useCaseDependencies).toEqual({
      storageRepository: expect.anything(),
      auditRepository: expect.anything(),
      lineageRepository: expect.anything()
    });
    expect(execute).toHaveBeenCalledWith({
      specimenId: 'S1',
      targetBoxId: 'B1',
      targetPosition: 'A1',
      reason: 'relocation',
      notes: 'n/a',
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440001',
        userName: 'Alice',
        userRole: 'admin',
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent'
      }
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result, message: 'Amostra movida com sucesso' });
  });

  it('ignores legacy id/_id actor fields; uses userID, username/role, and x-forwarded-for', async () => {
    const { controller, execute } = buildController();
    const req = buildReq({
      body: { specimenId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' },
      user: {
        _id: { toString: () => 'id-from-_id' },
        id: 'legacy-id',
        userID: '550e8400-e29b-41d4-a716-446655440002',
        username: 'bob',
        role: 'tech',
      },
      headers: { 'x-forwarded-for': '1.2.3.4' },
      connection: { remoteAddress: '9.9.9.9' }
    });
    const res = buildRes();

    await controller(req, res);

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 'S1',
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440002',
        userName: 'bob',
        userRole: 'tech',
        ipAddress: '1.2.3.4',
        userAgent: null
      }
    }));
  });

  it('defaults actor fields to null when no authenticated actor metadata is present', async () => {
    const { controller, execute } = buildController();
    const req = buildReq({ body: { specimenId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: null,
        userName: null,
        userRole: null,
        ipAddress: null,
        userAgent: null
      }
    }));
  });

  it('passes missing body fields as undefined so the v2 use case remains the validation authority', async () => {
    const { controller, execute } = buildController();
    const req = buildReq({ body: undefined });
    const res = buildRes();

    await controller(req, res);

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: undefined,
      targetBoxId: undefined,
      targetPosition: undefined
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([
    ['Amostra não encontrada', 404],
    ['STORAGE_COLLISION: position occupied', 409],
    ['targetBoxId é obrigatório', 400],
    ['StorageBox B1 está retirada de uso (status: RETIRED)', 400],
    ['Localização indisponível: FREEZER "Freezer 3" está com status MAINTENANCE', 400],
    ['RF023_LINEAGE_VALIDATION_FAILED: outbox recusado', 422],
    ['targetPosition is required', 500]
  ])('maps governed move error "%s" to HTTP %i', async (message, expectedStatus) => {
    const { controller } = buildController({ executeImpl: async () => { throw new Error(message); } });
    const req = buildReq({ body: { specimenId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message
    });
  });

  it('falls back to the canonical generic move error for a thrown Error without message', async () => {
    const { controller } = buildController({ executeImpl: async () => { throw new Error(); } });
    const req = buildReq({ body: { specimenId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'Erro ao mover amostra'
    });
  });
});