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
    const sampleLocation = { boxId: 'box-1', position: 'A1' };
    vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockResolvedValue({ sampleLocation });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { sampleId: 's1', boxId: 'box-1', position: 'A1' },
      headers: {}
    };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: sampleLocation,
      message: 'Amostra alocada com sucesso em A1'
    });
  });

  it('maps the wire-contract sampleId onto the use case command as specimenId (#482)', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { sampleId: 's1', boxId: 'box-1', position: 'A1' },
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

  it('builds the actor from req.user/req.ip/req.headers using the primary fallbacks', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { sampleId: 's1', boxId: 'b1', position: 'A1' },
      user: { id: 'user-1', name: 'Alice', roleName: 'admin' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: 'user-1',
        userName: 'Alice',
        userRole: 'admin',
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent'
      }
    }));
  });

  it('falls back through req.user._id/userID, req.headers x-forwarded-for and req.connection.remoteAddress when primary fields are absent', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { sampleId: 's1', boxId: 'b1', position: 'A1' },
      user: { _id: { toString: () => 'id-from-_id' }, username: 'bob', role: 'tech' },
      headers: { 'x-forwarded-for': '192.168.1.1' },
      connection: { remoteAddress: '127.0.0.1' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: 'id-from-_id',
        userName: 'bob',
        userRole: 'tech',
        ipAddress: '192.168.1.1',
        userAgent: null
      }
    }));
  });

  it('falls back further to userID and connection.remoteAddress when higher-priority fields are absent', async () => {
    const executeSpy = vi.spyOn(AllocateSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ sampleLocation: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      body: { sampleId: 's1', boxId: 'b1', position: 'A1' },
      user: { userID: 'id-from-userID' },
      headers: {},
      connection: { remoteAddress: '127.0.0.1' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: 'id-from-userID',
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
      body: { sampleId: 's1', boxId: 'b1', position: 'A1' },
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: releasedFrom,
      message: 'Amostra liberada de A1'
    });
  });

  it('maps the wire-contract sampleId onto the use case command as specimenId (#321)', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { sampleId: 's1' },
      headers: {}
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 's1'
    }));
  });

  it('builds the actor from req.user/req.ip/req.headers using the primary fallbacks', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { sampleId: 's1' },
      user: { id: 'user-1', name: 'Alice', roleName: 'admin' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      specimenId: 's1',
      actor: {
        userId: 'user-1',
        userName: 'Alice',
        userRole: 'admin',
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent'
      }
    }));
  });

  it('falls back through req.user._id/userID, req.headers x-forwarded-for and req.connection.remoteAddress when primary fields are absent', async () => {
    const executeSpy = vi.spyOn(ReleaseSampleUseCase.prototype, 'execute')
      .mockResolvedValue({ releasedFrom: { position: 'A1' } });
    const req = {
      app: { locals: { db: { collection: vi.fn() } } },
      params: { sampleId: 's1' },
      user: { _id: { toString: () => 'id-from-_id' }, username: 'bob', role: 'tech' },
      headers: { 'x-forwarded-for': '192.168.1.1' },
      connection: { remoteAddress: '127.0.0.1' }
    };
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({
      actor: {
        userId: 'id-from-_id',
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
      params: { sampleId: 's1' },
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
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
    const req = { app: { locals: { db: { collection: vi.fn() } } }, params: { sampleId: 's1' }, headers: {} };
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
