import { describe, it, expect, vi, afterEach } from 'vitest';

const { createAllocateSampleController } = require('../../src/interface/controllers/allocate-sample.controller');
const { createReleaseSampleController } = require('../../src/interface/controllers/release-sample.controller');
const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('allocate-sample.controller', () => {
  const controller = createAllocateSampleController();

  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, body: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados não disponível'
    });
  });

  it('allocates and returns 201 with the expected response shape', async () => {
    const currentStoragePlacement = { specimenId: 's1', boxId: 'box-1', positionCode: 'A1' };
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockResolvedValue({
      currentStoragePlacement,
      lineageQueued: true,
      lineageEventId: 'evt-allocate'
    });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { specimenId: 's1', boxId: 'box-1', position: 'A1' },
      headers: {}
    };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: currentStoragePlacement,
      currentStoragePlacement,
      projectionQueued: true,
      projectionEventId: 'evt-allocate',
      message: 'Amostra alocada com sucesso em A1'
    });
  });

  it('passes the canonical specimenId to the allocation use case', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { specimenId: 's1', boxId: 'box-1', position: 'A1' },
      headers: {}
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 's1',
      boxId: 'box-1',
      position: 'A1'
    }));
  });

  it('builds the actor from req.user.userID/name/roleName and req.ip/headers (Stage 2E)', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { specimenId: 's1', boxId: 'b1', position: 'A1' },
      user: {
        userID: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Alice',
        roleName: 'admin',
      },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440001',
        userName: 'Alice',
        userRole: 'admin',
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent'
      }
    }));
  });

  it('ignores legacy id/_id actor fields; uses userID, username/role, and x-forwarded-for', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { specimenId: 's1', boxId: 'b1', position: 'A1' },
      user: {
        _id: { toString: () => 'id-from-_id' },
        id: 'legacy-id',
        userID: '550e8400-e29b-41d4-a716-446655440002',
        username: 'bob',
        role: 'tech',
      },
      headers: { 'x-forwarded-for': '192.168.1.1' },
      connection: { remoteAddress: '127.0.0.1' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440002',
        userName: 'bob',
        userRole: 'tech',
        ipAddress: '192.168.1.1',
        userAgent: null
      }
    }));
  });

  it('falls back further to connection.remoteAddress when higher-priority fields are absent', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { specimenId: 's1', boxId: 'b1', position: 'A1' },
      user: { userID: '550e8400-e29b-41d4-a716-446655440003' },
      headers: {},
      connection: { remoteAddress: '127.0.0.1' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440003',
        userName: null,
        userRole: null,
        ipAddress: '127.0.0.1',
        userAgent: null
      }
    }));
  });

  it('builds an all-null actor when req.user is entirely absent and no ip/headers/connection provided', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { specimenId: 's1', boxId: 'b1', position: 'A1' },
      headers: {}
    };
    const res = buildRes();

    await expect(controller(req, res)).resolves.not.toThrow();

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: null,
        userName: null,
        userRole: null,
        ipAddress: null,
        userAgent: null
      }
    }));
  });

  it('returns 409 when execute rejects with a STORAGE_COLLISION message', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('STORAGE_COLLISION: slot occupied'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'ALLOCATION_ERROR',
      message: 'STORAGE_COLLISION: slot occupied'
    });
  });

  it('returns 404 when execute rejects with a "não encontrada" message', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Amostra não encontrada'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'ALLOCATION_ERROR',
      message: 'Amostra não encontrada'
    });
  });

  it('returns 500 for an unrecognised/infra-shaped error message (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('generic failure'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'ALLOCATION_ERROR',
      message: 'generic failure'
    });
  });

  it('falls back to the default Portuguese message (and 500) when the thrown error has no usable message (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error(''));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'ALLOCATION_ERROR',
      message: 'Erro ao alocar amostra'
    });
  });

  it('returns 400 for a validation-shaped message ("obrigatórios") (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('specimenId, boxId e position são obrigatórios'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'ALLOCATION_ERROR',
      message: 'specimenId, boxId e position são obrigatórios'
    });
  });

  // Title corrected: this case's message contains only "inválida". It was
  // named for two patterns and exercised one, so deleting 'fora dos limites'
  // from VALIDATION_ERROR_PATTERNS left the file green. The two cases below
  // cover the remaining entries, so every member of both allowlists is now
  // reachable from a test.
  it('returns 400 for a validation-shaped message ("inválida") (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Posição inválida. Use o formato Letra+Número (ex: A1, B4)'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for a validation-shaped message ("fora dos limites") (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Posição A99 fora dos limites da caixa'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for a validation-shaped message ("já está alocada em outra posição") (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Amostra já está alocada em outra posição'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for a location-blocked message ("está retirada de uso") (#987)', async () => {
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Caixa X está retirada de uso'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, body: {}, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('release-sample.controller', () => {
  const controller = createReleaseSampleController();

  it('returns 503 when req.app.locals.db is falsy', async () => {
    const req = { app: { locals: { db: null } }, params: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados não disponível'
    });
  });

  it('releases and returns 200 with the expected response shape', async () => {
    const releasedFrom = { boxId: 'box-1', position: 'A1' };
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockResolvedValue({ releasedFrom });
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: releasedFrom,
      message: 'Amostra liberada de A1'
    });
  });

  it('maps the wire-contract specimenId onto the use case command as specimenId (#321)', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { specimenId: 's1' },
      headers: {}
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 's1'
    }));
  });

  it('builds the actor from req.user.userID/name/roleName and req.ip/headers (Stage 2E)', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { specimenId: 's1' },
      user: {
        userID: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Alice',
        roleName: 'admin',
      },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 's1',
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440001',
        userName: 'Alice',
        userRole: 'admin',
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent'
      }
    }));
  });

  it('ignores legacy id/_id; uses userID, username/role, and x-forwarded-for', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { specimenId: 's1' },
      user: {
        _id: { toString: () => 'id-from-_id' },
        userID: '550e8400-e29b-41d4-a716-446655440002',
        username: 'bob',
        role: 'tech',
      },
      headers: { 'x-forwarded-for': '192.168.1.1' },
      connection: { remoteAddress: '127.0.0.1' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: '550e8400-e29b-41d4-a716-446655440002',
        userName: 'bob',
        userRole: 'tech',
        ipAddress: '192.168.1.1',
        userAgent: null
      }
    }));
  });

  it('builds an all-null actor when req.user is entirely absent and no ip/headers/connection provided', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { specimenId: 's1' },
      headers: {}
    };
    const res = buildRes();

    await expect(controller(req, res)).resolves.not.toThrow();

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: null,
        userName: null,
        userRole: null,
        ipAddress: null,
        userAgent: null
      }
    }));
  });

  it('returns 404 when execute rejects with a "não encontrada" message', async () => {
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Amostra não encontrada'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'RELEASE_ERROR',
      message: 'Amostra não encontrada'
    });
  });

  it('returns 409 when execute rejects with a STORAGE_COLLISION message, matching allocate-sample.controller', async () => {
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('STORAGE_COLLISION: slot occupied'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'RELEASE_ERROR',
      message: 'STORAGE_COLLISION: slot occupied'
    });
  });

  it('returns 500 for an unrecognised/infra-shaped error message (#987)', async () => {
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('generic failure'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'RELEASE_ERROR',
      message: 'generic failure'
    });
  });

  it('falls back to the default Portuguese message (and 500) when the thrown error has no usable message (#987)', async () => {
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockRejectedValue(new Error(''));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'RELEASE_ERROR',
      message: 'Erro ao liberar amostra'
    });
  });

  it('returns 400 for a validation-shaped message ("obrigatório") (#987)', async () => {
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('specimenId é obrigatório'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'RELEASE_ERROR',
      message: 'specimenId é obrigatório'
    });
  });

  it('returns 400 for a validation-shaped message ("não possui localização de armazenamento") (#987)', async () => {
    vi.spyOn(ReleaseSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Amostra não possui localização de armazenamento'));
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { specimenId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
