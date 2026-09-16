import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RegisterSampleUseCase = require('../../src/core/use-cases/RegisterSampleUseCase');
const env = require('../../src/config/env');

function repository(result = { _id: 'specimen-1', barcode: 'BC-1' }) {
  return { create: vi.fn().mockResolvedValue(result) };
}

describe('RegisterSampleUseCase canonical v2', () => {
  let originalLineageMode;

  beforeEach(() => {
    originalLineageMode = env.LINEAGE_MODE;
  });

  afterEach(() => {
    env.LINEAGE_MODE = originalLineageMode;
    vi.restoreAllMocks();
  });

  it('requires a sample repository with create()', () => {
    expect(() => new RegisterSampleUseCase()).toThrow('sampleRepository com método create é obrigatório');
    expect(() => new RegisterSampleUseCase({ sampleRepository: {} })).toThrow(
      'sampleRepository com método create é obrigatório'
    );
  });

  it('persists through the canonical Mongo repository and reports an asynchronous projection', async () => {
    const sampleRepository = repository();
    const useCase = new RegisterSampleUseCase({ sampleRepository });

    const result = await useCase.execute({
      sampleData: { barcode: 'BC-1' },
      options: { skipValidation: true },
      actor: {
        userId: 'user-1',
        userName: 'Alice',
        userRole: 'technician',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest'
      }
    });

    expect(sampleRepository.create).toHaveBeenCalledWith(
      { barcode: 'BC-1' },
      {
        skipValidation: true,
        auditInfo: {
          userId: 'user-1',
          userName: 'Alice',
          userRole: 'technician',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest'
        }
      }
    );
    expect(result).toEqual({
      sample: { _id: 'specimen-1', barcode: 'BC-1' },
      strictMode: false,
      topology: {
        synced: false,
        fallbackQueued: false,
        projectionQueued: true
      }
    });
  });

  it('accepts the sample payload directly and defaults audit fields to null', async () => {
    const sampleRepository = repository();
    const useCase = new RegisterSampleUseCase({ sampleRepository });

    await useCase.execute({ barcode: 'BC-2' });

    expect(sampleRepository.create).toHaveBeenCalledWith(
      { barcode: 'BC-2' },
      {
        auditInfo: {
          userId: null,
          userName: null,
          userRole: null,
          ipAddress: null,
          userAgent: null
        }
      }
    );
  });

  it.each(['not-an-object', 42])('rejects a non-object sample payload: %s', async (payload) => {
    const sampleRepository = repository();
    const useCase = new RegisterSampleUseCase({ sampleRepository });
    await expect(useCase.execute(payload)).rejects.toThrow('sampleData inválido');
    expect(sampleRepository.create).not.toHaveBeenCalled();
  });

  it('logs and preserves a canonical repository failure', async () => {
    const error = new Error('mongo write failed');
    const sampleRepository = { create: vi.fn().mockRejectedValue(error) };
    const logger = { error: vi.fn() };
    const useCase = new RegisterSampleUseCase({ sampleRepository, logger });

    await expect(useCase.execute({ barcode: 'BC-3' })).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledWith(
      '[RegisterSampleUseCase] Falha no registro de amostra:',
      'mongo write failed'
    );
  });

  it('honours fail-closed and dynamic risk without introducing a direct graph write', async () => {
    const sampleRepository = repository();
    const useCase = new RegisterSampleUseCase({ sampleRepository });

    env.LINEAGE_MODE = 'fail-closed';
    expect(useCase.resolveStrictMode({})).toBe(true);

    env.LINEAGE_MODE = 'fail-open';
    expect(useCase.resolveStrictMode({ isRareDisease: true })).toBe(true);
    expect(useCase.resolveStrictMode({ riskLevel: 'critical' })).toBe(true);
    expect(useCase.resolveStrictMode({ riskGrade: 'alto' })).toBe(true);
    expect(useCase.resolveStrictMode({ riskScore: 7 })).toBe(true);
    expect(useCase.resolveStrictMode({ riskLevel: 'low', riskScore: 6.9 })).toBe(false);
  });

  it('does not expose legacy direct-Neo4j persistence or Mongo rollback helpers', () => {
    const useCase = new RegisterSampleUseCase({ sampleRepository: repository() });
    expect(useCase.persistTopology).toBeUndefined();
    expect(useCase.rollbackMongoSample).toBeUndefined();
    expect(useCase.enqueueForSelfHealing).toBeUndefined();
  });
});
