import { afterEach, describe, expect, it, vi } from 'vitest';

const env = require('../../src/config/env');
const logger = require('../../src/utils/logger');
const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const MoveSampleUseCase = require('../../src/core/use-cases/MoveSampleUseCase');
const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');
const RegisterSampleUseCase = require('../../src/core/use-cases/RegisterSampleUseCase');

const originalLineageMode = env.LINEAGE_MODE;

afterEach(() => {
  vi.restoreAllMocks();
  env.LINEAGE_MODE = originalLineageMode;
});

describe('item 8 branch-95 custody use-case behaviors', () => {
  it('uses fail-open default when lineage mode is absent for allocation without a lineage repository', async () => {
    env.LINEAGE_MODE = undefined;
    const useCase = new AllocateSampleUseCase({
      storageRepository: {},
      auditRepository: {},
      lineageRepository: null,
    });
    await expect(useCase.persistLineageInTransaction({ specimenId: 'S1' }, 'session'))
      .resolves.toEqual({
        lineageValidated: false,
        lineagePersisted: false,
        lineageQueued: false,
        eventId: null,
      });
  });

  it('normalizes non-Error allocation lineage failures in fail-open and fail-closed modes', async () => {
    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockRejectedValue('lineage-refused'),
      recordCustodyEvent: vi.fn(),
    };
    const useCase = new AllocateSampleUseCase({
      storageRepository: {},
      auditRepository: {},
      lineageRepository,
    });
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    env.LINEAGE_MODE = 'fail-open';
    await expect(useCase.persistLineageInTransaction({}, 'session'))
      .resolves.toMatchObject({ lineageValidated: false, lineagePersisted: false });

    lineageRepository.validateBeforePersistence.mockRejectedValueOnce({});
    env.LINEAGE_MODE = 'fail-closed';
    await expect(useCase.persistLineageInTransaction({}, 'session'))
      .rejects.toThrow('RF023_LINEAGE_VALIDATION_FAILED: operação bloqueada');
  });

  it('detects a sample disappearing inside a move transaction', async () => {
    const initial = {
      _id: 'S1',
      currentStoragePlacement: { boxId: 'B1', positionCode: 'A1' },
    };
    const storageRepository = {
      findSampleById: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(null),
      findBoxById: vi.fn().mockResolvedValue({ _id: 'B2' }),
      withTransaction: vi.fn(async (handler) => handler('session')),
    };
    const useCase = new MoveSampleUseCase({
      storageRepository,
      auditRepository: {},
      lineageRepository: null,
    });

    await expect(useCase.execute({
      specimenId: 'S1',
      targetBoxId: 'B2',
      targetPosition: 'B1',
    })).rejects.toThrow('Amostra não encontrada');
  });

  it('detects source placement disappearing inside a move transaction', async () => {
    const initial = {
      _id: 'S1',
      currentStoragePlacement: { boxId: 'B1', positionCode: 'A1' },
    };
    const storageRepository = {
      findSampleById: vi.fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce({ _id: 'S1', currentStoragePlacement: null }),
      findBoxById: vi.fn().mockResolvedValue({ _id: 'B2' }),
      withTransaction: vi.fn(async (handler) => handler('session')),
    };
    const useCase = new MoveSampleUseCase({
      storageRepository,
      auditRepository: {},
      lineageRepository: null,
    });

    await expect(useCase.execute({
      specimenId: 'S1',
      targetBoxId: 'B2',
      targetPosition: 'B1',
    })).rejects.toThrow('Amostra não possui posicionamento físico de origem');
  });

  it('uses fail-open default and generic hard-failure text for move lineage', async () => {
    env.LINEAGE_MODE = undefined;
    const noLineage = new MoveSampleUseCase({
      storageRepository: {},
      auditRepository: {},
      lineageRepository: null,
    });
    await expect(noLineage.persistLineageInTransaction({}, 'session'))
      .resolves.toMatchObject({ lineageValidated: false, lineagePersisted: false });

    const lineageRepository = {
      validateBeforePersistence: vi.fn().mockRejectedValue({}),
      recordCustodyEvent: vi.fn(),
    };
    const withLineage = new MoveSampleUseCase({
      storageRepository: {},
      auditRepository: {},
      lineageRepository,
    });
    env.LINEAGE_MODE = 'fail-closed';
    await expect(withLineage.persistLineageInTransaction({}, 'session'))
      .rejects.toThrow('RF023_LINEAGE_VALIDATION_FAILED: operação bloqueada');
  });

  it('covers release barcode fallback and absent lineage-mode default', async () => {
    env.LINEAGE_MODE = undefined;
    const storageRepository = {
      findSampleById: vi.fn().mockResolvedValue({
        _id: 'S1',
        currentStoragePlacement: { boxId: 'B1', positionCode: 'A1' },
      }),
      withTransaction: vi.fn(async (handler) => handler('session')),
      releaseSamplePosition: vi.fn().mockResolvedValue({
        from: { boxId: 'B1', position: 'A1' },
      }),
    };
    const auditRepository = {
      appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 1 }),
    };
    const useCase = new ReleaseSampleUseCase({
      storageRepository,
      auditRepository,
      lineageRepository: null,
    });

    await expect(useCase.execute({ specimenId: 'S1' })).resolves.toMatchObject({
      success: true,
      lineageValidated: false,
    });
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: null }),
      'session'
    );
  });

  it('normalizes a non-Error repository failure in RegisterSampleUseCase logging', async () => {
    const localLogger = { error: vi.fn() };
    const useCase = new RegisterSampleUseCase({
      sampleRepository: {
        create: vi.fn().mockRejectedValue('repository-refused'),
      },
      logger: localLogger,
    });

    await expect(useCase.execute({ sampleData: { specimenId: 'S1' } }))
      .rejects.toBe('repository-refused');
    expect(localLogger.error).toHaveBeenCalledWith(
      '[RegisterSampleUseCase] Falha no registro de amostra:',
      'repository-refused'
    );
  });

  it('uses fail-open default in RegisterSampleUseCase strict-mode resolution', () => {
    env.LINEAGE_MODE = undefined;
    const useCase = new RegisterSampleUseCase({
      sampleRepository: { create: vi.fn() },
    });

    expect(useCase.resolveStrictMode({ riskLevel: 'low', riskScore: 1 })).toBe(false);
  });
});
