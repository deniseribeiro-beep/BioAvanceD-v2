import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';

const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const env = require('../../src/config/env');

const originalLineageMode = env.LINEAGE_MODE;

afterEach(() => {
  env.LINEAGE_MODE = originalLineageMode;
});

function makeSample(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    storageLocation: { boxId: 'box-old', position: 'a1' },
    ...overrides
  };
}

function makeDeps({
  sample = makeSample(),
  secondSample = undefined, // if provided, used for the in-transaction lookup instead of `sample`
  withLineageRepo = false,
  lineageImpl = {},
  transactionImpl = null
} = {}) {
  const findSampleById = vi.fn(async () => sample);
  if (secondSample !== undefined) {
    findSampleById.mockImplementationOnce(async () => sample).mockImplementationOnce(async () => secondSample);
  }

  const storageRepository = {
    findSampleById,
    allocateSamplePosition: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (fn) => {
      if (transactionImpl) {
        return transactionImpl(fn);
      }
      return fn('session-token');
    })
  };

  const auditRepository = {
    appendImmutableAudit: vi.fn(async () => undefined)
  };

  let lineageRepository;
  if (withLineageRepo) {
    lineageRepository = {
      validateBeforePersistence: vi.fn(
        lineageImpl.validateBeforePersistence || (async () => undefined)
      ),
      recordCustodyEvent: vi.fn(
        lineageImpl.recordCustodyEvent || (async () => ({ eventId: 'evt-1' }))
      ),
      compensateCustodyEvent: vi.fn(
        lineageImpl.compensateCustodyEvent || (async () => undefined)
      )
    };
  }

  const useCase = new AllocateSampleUseCase({
    storageRepository,
    auditRepository,
    lineageRepository
  });

  return { useCase, storageRepository, auditRepository, lineageRepository };
}

const baseCommand = () => ({
  specimenId: 'sample-1',
  boxId: 'box-new',
  position: 'b2',
  actor: { userId: 'user-1' }
});

describe('AllocateSampleUseCase', () => {
  describe('validateCommand', () => {
    it('throws when specimenId is missing', async () => {
      const { useCase } = makeDeps();
      const cmd = baseCommand();
      delete cmd.specimenId;
      await expect(useCase.execute(cmd)).rejects.toThrow('specimenId, boxId e position são obrigatórios');
    });

    it('throws when boxId is missing', async () => {
      const { useCase } = makeDeps();
      const cmd = baseCommand();
      delete cmd.boxId;
      await expect(useCase.execute(cmd)).rejects.toThrow('specimenId, boxId e position são obrigatórios');
    });

    it('throws when position is missing', async () => {
      const { useCase } = makeDeps();
      const cmd = baseCommand();
      delete cmd.position;
      await expect(useCase.execute(cmd)).rejects.toThrow('specimenId, boxId e position são obrigatórios');
    });
  });

  it('happy path with no lineageRepository (fail-open default): lineage skipped, transaction succeeds', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository, auditRepository } = makeDeps();

    const result = await useCase.execute(baseCommand());

    expect(result).toEqual({
      success: true,
      sampleLocation: {
        specimenId: 'sample-1',
        boxId: 'box-new',
        position: 'B2'
      },
      lineageValidated: false,
      lineagePersisted: false,
      lineageEventId: null
    });
    expect(storageRepository.withTransaction).toHaveBeenCalledTimes(1);
    expect(storageRepository.allocateSamplePosition).toHaveBeenCalledTimes(1);
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledTimes(1);
  });

  it('happy path with a lineageRepository provided: validation+recording called, flags true, eventId from persisted result', async () => {
    const { useCase, lineageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        recordCustodyEvent: async () => ({ eventId: 'evt-success' })
      }
    });

    const result = await useCase.execute(baseCommand());

    expect(result.lineageValidated).toBe(true);
    expect(result.lineagePersisted).toBe(true);
    expect(result.lineageEventId).toBe('evt-success');
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
  });

  it('throws "Amostra não encontrada" when sample is not found on the first lookup, before any transaction attempt', async () => {
    const { useCase, storageRepository } = makeDeps({ sample: null });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('throws when the sample disappears between the first lookup and the in-transaction lookup (race)', async () => {
    const { useCase, storageRepository } = makeDeps({
      sample: makeSample(),
      secondSample: null
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.findSampleById).toHaveBeenCalledTimes(2);
  });

  it('fail-closed with no lineageRepository throws instead of continuing', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = makeDeps();

    await expect(useCase.execute(baseCommand())).rejects.toThrow();
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fail-closed and validateBeforePersistence rejects: throws wrapped ISO20387 error, transaction never runs', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        validateBeforePersistence: async () => {
          throw new Error('neo4j down');
        }
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fail-open (default) and lineage call rejects: swallowed, lineageValidated false, execution continues to the transaction', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        validateBeforePersistence: async () => {
          throw new Error('neo4j down');
        }
      }
    });

    const result = await useCase.execute(baseCommand());

    expect(result.success).toBe(true);
    expect(result.lineageValidated).toBe(false);
    expect(result.lineagePersisted).toBe(false);
    expect(result.lineageEventId).toBeNull();
    expect(storageRepository.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('transaction throws: compensateLineageIfNeeded is invoked with correct args and the original mongoError is re-thrown', async () => {
    const mongoError = new Error('mongo write conflict');
    const { useCase, lineageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        recordCustodyEvent: async () => ({ eventId: 'evt-compensate' })
      },
      transactionImpl: async () => {
        throw mongoError;
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('mongo write conflict');
    expect(lineageRepository.compensateCustodyEvent).toHaveBeenCalledTimes(1);
    expect(lineageRepository.compensateCustodyEvent).toHaveBeenCalledWith({
      eventId: 'evt-compensate',
      specimenId: 'sample-1',
      reason: 'mongo_transaction_failed'
    });
  });

  it('transaction throws but lineage was never persisted (fail-open, no lineageRepository): compensateCustodyEvent not called, original error still thrown', async () => {
    const mongoError = new Error('mongo write conflict 2');
    const { useCase } = makeDeps({
      transactionImpl: async () => {
        throw mongoError;
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('mongo write conflict 2');
    // no lineageRepository at all, so there is nothing to call - the rethrow itself is the assertion
  });

  it('a failing compensateCustodyEvent call does not mask/replace the original mongoError', async () => {
    const mongoError = new Error('mongo write conflict 3');
    const { useCase, lineageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        recordCustodyEvent: async () => ({ eventId: 'evt-compensate-fail' }),
        compensateCustodyEvent: async () => {
          throw new Error('compensation also failed');
        }
      },
      transactionImpl: async () => {
        throw mongoError;
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('mongo write conflict 3');
    expect(lineageRepository.compensateCustodyEvent).toHaveBeenCalledTimes(1);
  });
});
