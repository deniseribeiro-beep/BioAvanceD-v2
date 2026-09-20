import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');
const env = require('../../src/config/env');

const originalLineageMode = env.LINEAGE_MODE;

function specimen(overrides = {}) {
  return {
    _id: 'sample-residual',
    barcode: 'BC-RESIDUAL',
    currentStoragePlacement: { boxId: 'box-1', positionCode: 'a1' },
    ...overrides,
  };
}

function buildUseCase({ snapshot = specimen(), transactional = snapshot, recordResult = { eventId: 'evt-1', queued: true } } = {}) {
  const findSampleById = vi.fn()
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce(transactional);
  const storageRepository = {
    findSampleById,
    withTransaction: vi.fn(async (handler) => handler('session-residual')),
    releaseSamplePosition: vi.fn().mockResolvedValue({
      from: { boxId: 'box-1', position: 'A1' },
    }),
  };
  const auditRepository = {
    appendImmutableAudit: vi.fn().mockResolvedValue({}),
  };
  const lineageRepository = {
    validateBeforePersistence: vi.fn().mockResolvedValue(true),
    recordCustodyEvent: vi.fn().mockResolvedValue(recordResult),
  };
  return {
    useCase: new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository }),
    storageRepository,
    auditRepository,
    lineageRepository,
  };
}

afterEach(() => {
  env.LINEAGE_MODE = originalLineageMode;
  vi.restoreAllMocks();
});

describe('ReleaseSampleUseCase item 8 residual branches', () => {
  it('fails atomically when the placement disappears inside the transaction', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = buildUseCase({
      transactional: specimen({ currentStoragePlacement: { boxId: null, positionCode: null } }),
    });

    await expect(useCase.execute({ specimenId: 'sample-residual' }))
      .rejects.toThrow('Amostra não possui posicionamento físico ativo');

    expect(lineageRepository.validateBeforePersistence).not.toHaveBeenCalled();
    expect(storageRepository.releaseSamplePosition).not.toHaveBeenCalled();
    expect(auditRepository.appendImmutableAudit).not.toHaveBeenCalled();
  });

  it('preserves an explicit queued:false custody result and normalizes an empty eventId to null', async () => {
    const { useCase } = buildUseCase({
      recordResult: { queued: false, eventId: '' },
    });

    const result = await useCase.execute({ specimenId: 'sample-residual' });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      lineageValidated: true,
      lineagePersisted: true,
      lineageQueued: false,
      lineageEventId: null,
    }));
  });

  it('fail-open converts a primitive lineage failure into a non-persisted result without blocking release', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository, lineageRepository } = buildUseCase();
    lineageRepository.validateBeforePersistence.mockRejectedValueOnce('primitive-lineage-failure');

    const result = await useCase.execute({ specimenId: 'sample-residual' });

    expect(storageRepository.releaseSamplePosition).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      lineageValidated: false,
      lineagePersisted: false,
      lineageQueued: false,
      lineageEventId: null,
    }));
  });

  it('fail-closed maps a primitive lineage failure to the canonical fallback message before state mutation', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository, lineageRepository } = buildUseCase();
    lineageRepository.recordCustodyEvent.mockRejectedValueOnce('primitive-lineage-failure');

    await expect(useCase.execute({ specimenId: 'sample-residual' }))
      .rejects.toThrow('RF023_LINEAGE_VALIDATION_FAILED: operação bloqueada');

    expect(storageRepository.releaseSamplePosition).not.toHaveBeenCalled();
  });
});
