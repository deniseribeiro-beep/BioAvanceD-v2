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
    storageAssignment: { boxId: 'box-old', positionCode: 'a1' },
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

  // #1312 (RF023 AC3/AC8): the custody event is an outbox append in the
  // allocation's own transaction, after the position and audit writes.
  it('#1312: appends the allocate custody event inside the transaction, with its session', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = makeDeps({ withLineageRepo: true });

    await useCase.execute(baseCommand());

    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(
      {
        specimenId: 'sample-1',
        barcode: 'BC-1',
        eventType: 'allocate',
        from: { boxId: 'box-old', position: 'A1' },
        to: { boxId: 'box-new', position: 'B2' },
        actorId: 'user-1',
        reason: 'allocate'
      },
      { session: 'session-token' }
    );
    const appendOrder = lineageRepository.recordCustodyEvent.mock.invocationCallOrder[0];
    expect(appendOrder).toBeGreaterThan(storageRepository.withTransaction.mock.invocationCallOrder[0]);
    expect(appendOrder).toBeGreaterThan(storageRepository.allocateSamplePosition.mock.invocationCallOrder[0]);
    expect(appendOrder).toBeGreaterThan(auditRepository.appendImmutableAudit.mock.invocationCallOrder[0]);
  });

  // RF023 AC3: a sample create allocating the sample it just inserted passes
  // its own session; the allocation joins it instead of opening a second
  // transaction, and reads the uncommitted sample through it.
  it('#1367: an outer session is used for every read and write, and no transaction of its own is opened', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = makeDeps({ withLineageRepo: true });

    const result = await useCase.execute(baseCommand(), { session: 'outer-session' });

    expect(result.lineageEventId).toBe('evt-1');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
    expect(storageRepository.findSampleById.mock.calls).toEqual([
      ['sample-1', 'outer-session'],
      ['sample-1', 'outer-session']
    ]);
    expect(storageRepository.allocateSamplePosition).toHaveBeenCalledWith(
      { specimenId: 'sample-1', boxId: 'box-new', position: 'B2' },
      'outer-session'
    );
    expect(auditRepository.appendImmutableAudit.mock.calls[0][1]).toBe('outer-session');
    expect(lineageRepository.recordCustodyEvent.mock.calls[0][1]).toEqual({ session: 'outer-session' });
  });

  it('#1367: a failed custody append under an outer session propagates, so the caller\'s transaction aborts', async () => {
    const { useCase, storageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: { recordCustodyEvent: async () => { throw new Error('outbox down'); } }
    });

    await expect(useCase.execute(baseCommand(), { session: 'outer-session' })).rejects.toThrow('outbox down');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('#1367: without an outer session the first lookup takes no session argument, as before', async () => {
    const { useCase, storageRepository } = makeDeps();

    await useCase.execute(baseCommand());

    expect(storageRepository.findSampleById.mock.calls[0]).toEqual(['sample-1']);
    expect(storageRepository.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('#1312: the pre-Mongo validation carries no consent flag; it reads nothing', async () => {
    const { useCase, lineageRepository } = makeDeps({ withLineageRepo: true });

    await useCase.execute(baseCommand());

    const validated = lineageRepository.validateBeforePersistence.mock.calls[0][0];
    expect(validated).toMatchObject({ specimenId: 'sample-1', eventType: 'allocate' });
    expect(validated).not.toHaveProperty('requireEthicalConsent');
  });

  it.each(['fail-closed', 'fail-open'])('#1312: a failed append aborts the transaction and refuses the allocation (%s)', async (mode) => {
    env.LINEAGE_MODE = mode;
    const { useCase } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        recordCustodyEvent: async () => {
          throw new Error('outbox append failed');
        }
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('outbox append failed');
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

  it('#1312: a transaction that fails before the append records no custody event and rethrows the Mongo error', async () => {
    const mongoError = new Error('mongo write conflict');
    const { useCase, lineageRepository } = makeDeps({
      withLineageRepo: true,
      transactionImpl: async () => {
        throw mongoError;
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('mongo write conflict');
    expect(lineageRepository.recordCustodyEvent).not.toHaveBeenCalled();
  });

  it('transaction throws with no lineageRepository (fail-open): original error still thrown', async () => {
    const mongoError = new Error('mongo write conflict 2');
    const { useCase } = makeDeps({
      transactionImpl: async () => {
        throw mongoError;
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('mongo write conflict 2');
    // no lineageRepository at all, so there is nothing to call - the rethrow itself is the assertion
  });

  it('sample with no prior storageAssignment and no barcode, actor with no userId: null-fallback branches all taken', async () => {
    const { useCase, auditRepository } = makeDeps({
      sample: makeSample({ storageAssignment: undefined, barcode: undefined })
    });
    const cmd = baseCommand();
    delete cmd.actor.userId;

    const result = await useCase.execute(cmd);

    expect(result.success).toBe(true);
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: null,
        before: { storageLocation: null }
      }),
      'session-token'
    );
  });

  it('sample has a storageAssignment object but boxId/positionCode fields are falsy: beforeLocation resolves those fields to null', async () => {
    const { useCase, auditRepository } = makeDeps({
      sample: makeSample({ storageAssignment: { boxId: '', positionCode: '' } })
    });

    await useCase.execute(baseCommand());

    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { storageLocation: { boxId: null, position: null } }
      }),
      'session-token'
    );
  });

  it('fail-closed with a lineageRepository, LINEAGE_MODE unset: falls back to fail-open default so it does not throw', async () => {
    delete env.LINEAGE_MODE;
    const { useCase } = makeDeps({ withLineageRepo: true });

    const result = await useCase.execute(baseCommand());

    expect(result.lineageValidated).toBe(true);
  });

  it('lineage validation rejects with a non-Error (no .message): logger.error still falls back to the raw value', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        validateBeforePersistence: async () => {
          throw 'neo4j down (string)';
        }
      }
    });

    const result = await useCase.execute(baseCommand());

    expect(result.lineageValidated).toBe(false);
  });
});
