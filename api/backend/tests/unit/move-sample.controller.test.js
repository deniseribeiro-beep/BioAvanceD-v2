import { describe, it, expect, vi, afterEach } from 'vitest';

const { createMoveSampleController } = require('../../src/interface/controllers/move-sample.controller');
const MoveSampleUseCase = require('../../src/core/use-cases/MoveSampleUseCase');

function buildRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function buildReq(overrides = {}) {
  return {
    app: { locals: { db: {} } },
    body: {},
    headers: {},
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('move-sample.controller', () => {
  const controller = createMoveSampleController();

  it('passes a command that satisfies the real MoveSampleUseCase.validateCommand (regression: #487)', async () => {
    // Exercises the real validateCommand instead of a mocked execute(), so a
    // controller/use-case field-name mismatch (sampleId vs specimenId) fails
    // this test instead of silently 400ing on every real request.
    const validateSpy = vi.spyOn(MoveSampleUseCase.prototype, 'validateCommand');
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockImplementation(function (command) {
      this.validateCommand(command);
      return Promise.resolve({});
    });

    const req = buildReq({
      body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' }
    });
    const res = buildRes();

    await controller(req, res);

    expect(validateSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('returns 503 when the db is not available', async () => {
    const req = buildReq({ app: { locals: {} } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados não disponível'
    });
  });

  it('returns 200 with the use-case result on success', async () => {
    // The shape MoveSampleUseCase.execute really returns, so the echo below
    // is a body the endpoint can produce.
    const moved = {
      success: true,
      movementID: 'MOV-1',
      specimenId: 'S1',
      from: { boxId: 'B0', position: 'C3' },
      to: { boxId: 'B1', position: 'A1' },
      movedAt: '2026-10-07T00:00:00.000Z',
      lineageSynced: true,
      lineageValidated: true,
      lineagePersisted: true,
      lineageEventId: null
    };
    const executeSpy = vi
      .spyOn(MoveSampleUseCase.prototype, 'execute')
      .mockResolvedValue(moved);
    const req = buildReq({
      body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1', reason: 'relocation', notes: 'n/a' },
      user: { id: 'u1', name: 'Alice', roleName: 'admin' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'test-agent' }
    });
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith({
      specimenId: 'S1',
      targetBoxId: 'B1',
      targetPosition: 'A1',
      reason: 'relocation',
      notes: 'n/a',
      actor: {
        userId: 'u1',
        userName: 'Alice',
        userRole: 'admin',
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent'
      }
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: moved,
      message: 'Amostra movida com sucesso'
    });
  });

  it('falls back to alternate user identity fields and headers when primary fields are absent', async () => {
    const executeSpy = vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockResolvedValue({});
    const req = buildReq({
      body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' },
      user: { _id: { toString: () => 'u2' }, username: 'bob', role: 'tech' },
      headers: { 'x-forwarded-for': '1.2.3.4' },
      connection: { remoteAddress: '9.9.9.9' }
    });
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        specimenId: 'S1',
        actor: {
          userId: 'u2',
          userName: 'bob',
          userRole: 'tech',
          ipAddress: '1.2.3.4',
          userAgent: null
        }
      })
    );
  });

  it('defaults actor fields to null when req.user is absent and no ip/agent info is present', async () => {
    const executeSpy = vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockResolvedValue({});
    const req = buildReq({ body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          userId: null,
          userName: null,
          userRole: null,
          ipAddress: null,
          userAgent: null
        }
      })
    );
  });

  it('handles a missing req.body without throwing, passing undefined fields through', async () => {
    const executeSpy = vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockResolvedValue({});
    const req = buildReq({ body: undefined });
    const res = buildRes();

    await controller(req, res);

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        specimenId: undefined,
        targetBoxId: undefined,
        targetPosition: undefined
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when the use case throws a "não encontrada" error', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('Amostra não encontrada'));
    const req = buildReq({ body: { sampleId: 'missing', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'Amostra não encontrada'
    });
  });

  it('returns 409 when the use case throws a STORAGE_COLLISION error', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('STORAGE_COLLISION: position occupied'));
    const req = buildReq({ body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'STORAGE_COLLISION: position occupied'
    });
  });

  it('returns 400 when the use case throws a known validation error', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('targetBoxId é obrigatório'));
    const req = buildReq({ body: { sampleId: 'S1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'targetBoxId é obrigatório'
    });
  });

  it('returns 400 when checkLocationBlocked rejects a RETIRED destination box (#646 RF017 AC#7)', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(
      new Error('StorageBox 507f1f77bcf86cd799439099 está retirada de uso (status: RETIRED)')
    );
    const req = buildReq({ body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'StorageBox 507f1f77bcf86cd799439099 está retirada de uso (status: RETIRED)'
    });
  });

  it('returns 400 when checkLocationBlocked rejects a non-OPERATIONAL ancestor container (#646 RF017 AC#7)', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(
      new Error('Localização indisponível: FREEZER "Freezer 3" está com status MAINTENANCE')
    );
    const req = buildReq({ body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'Localização indisponível: FREEZER "Freezer 3" está com status MAINTENANCE'
    });
  });

  it('returns 500 for an unrecognized use-case error message instead of masking it as a 400 (issue #54)', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(new Error('targetPosition is required'));
    const req = buildReq({ body: { sampleId: 'S1', targetBoxId: 'B1' } });
    const res = buildRes();

    await controller(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'MOVE_SAMPLE_ERROR',
      message: 'targetPosition is required'
    });
  });

  it('falls back to the default error message with a 500 when the thrown error has no message (issue #54)', async () => {
    vi.spyOn(MoveSampleUseCase.prototype, 'execute').mockRejectedValue(new Error());
    const req = buildReq({ body: { sampleId: 'S1', targetBoxId: 'B1', targetPosition: 'A1' } });
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
