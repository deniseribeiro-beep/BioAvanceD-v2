import { describe, it, expect, afterEach } from 'vitest';
import { vi } from 'vitest';

const MoveSampleUseCase = require('../../src/core/use-cases/MoveSampleUseCase');
const env = require('../../src/config/env');

const originalLineageMode = env.LINEAGE_MODE;

afterEach(() => {
  env.LINEAGE_MODE = originalLineageMode;
});

function makeSample(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    storageLocation: { boxId: 'box-src', position: 'a1' },
    ...overrides
  };
}

function makeDeps({
  sample = makeSample(),
  box = { _id: 'box-dest' },
  movementID = 42,
  withLineageRepo = false,
  lineageImpl = {},
  transactionImpl = null
} = {}) {
  const calls = [];

  const storageRepository = {
    findSampleById: vi.fn(async () => sample),
    findBoxById: vi.fn(async () => box),
    moveSamplePosition: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (fn) => {
      calls.push('withTransaction');
      if (transactionImpl) {
        return transactionImpl(fn);
      }
      return fn('session-token');
    })
  };

  const auditRepository = {
    appendImmutableAudit: vi.fn(async () => ({ movementID }))
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

  const useCase = new MoveSampleUseCase({
    storageRepository,
    auditRepository,
    lineageRepository
  });

  return { useCase, storageRepository, auditRepository, lineageRepository, calls };
}

const baseCommand = () => ({
  sampleId: 'sample-1',
  targetBoxId: 'box-dest',
  targetPosition: 'b2',
  reason: 'relocation',
  notes: 'note',
  actor: { userId: 'user-1' }
});

describe('MoveSampleUseCase', () => {
  it('performs a successful move, normalizing from/to and reflecting lineage-absent (fail-open) result', async () => {
    const { useCase, storageRepository, auditRepository } = makeDeps();

    const result = await useCase.execute(baseCommand());

    expect(result).toEqual({
      success: true,
      movementID: 42,
      sampleId: 'sample-1',
      from: { boxId: 'box-src', position: 'A1' },
      to: { boxId: 'box-dest', position: 'B2' },
      movedAt: expect.any(Date),
      lineageSynced: false,
      lineageValidated: false,
      lineagePersisted: false,
      lineageEventId: null
    });
    expect(storageRepository.moveSamplePosition).toHaveBeenCalledTimes(1);
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing/non-object command', async () => {
    const { useCase } = makeDeps();
    await expect(useCase.execute(null)).rejects.toThrow('Comando de movimentação inválido');
  });

  it('rejects a command missing sampleId', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    delete cmd.sampleId;
    await expect(useCase.execute(cmd)).rejects.toThrow('sampleId é obrigatório');
  });

  it('rejects a command missing targetBoxId', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    delete cmd.targetBoxId;
    await expect(useCase.execute(cmd)).rejects.toThrow('targetBoxId é obrigatório');
  });

  it('rejects a command missing targetPosition', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    delete cmd.targetPosition;
    await expect(useCase.execute(cmd)).rejects.toThrow('targetPosition é obrigatório');
  });

  it('normalizes lowercase targetPosition before checking format (valid case passes)', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    cmd.targetPosition = 'a1'; // lowercase but matches source position after normalization -> different box though
    const result = await useCase.execute(cmd);
    expect(result.to).toEqual({ boxId: 'box-dest', position: 'A1' });
  });

  it('rejects a targetPosition with an invalid format (letters only)', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    cmd.targetPosition = 'AA';
    await expect(useCase.execute(cmd)).rejects.toThrow(
      'targetPosition deve seguir formato Letra+Número (ex: A1, B4)'
    );
  });

  it('rejects a targetPosition with an invalid format (digits only)', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    cmd.targetPosition = '11';
    await expect(useCase.execute(cmd)).rejects.toThrow(
      'targetPosition deve seguir formato Letra+Número (ex: A1, B4)'
    );
  });

  it('throws when the sample is not found', async () => {
    const { useCase, storageRepository } = makeDeps({ sample: null });
    await expect(useCase.execute(baseCommand())).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.findBoxById).not.toHaveBeenCalled();
  });

  it('throws when the sample has no source boxId', async () => {
    const { useCase } = makeDeps({
      sample: makeSample({ storageLocation: { position: 'A1' } })
    });
    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'Amostra não possui localização de origem para movimentação'
    );
  });

  it('throws when the sample has no source position', async () => {
    const { useCase } = makeDeps({
      sample: makeSample({ storageLocation: { boxId: 'box-src' } })
    });
    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'Amostra não possui localização de origem para movimentação'
    );
  });

  it('throws when target position equals the current position (same box and position)', async () => {
    const { useCase, storageRepository } = makeDeps({
      sample: makeSample({ storageLocation: { boxId: 'box-src', position: 'A1' } })
    });
    const cmd = baseCommand();
    cmd.targetBoxId = 'box-src';
    cmd.targetPosition = 'a1';

    await expect(useCase.execute(cmd)).rejects.toThrow(
      'A posição de destino deve ser diferente da posição atual'
    );
    expect(storageRepository.findBoxById).not.toHaveBeenCalled();
  });

  it('throws when the target box is not found', async () => {
    const { useCase, storageRepository } = makeDeps({ box: null });
    await expect(useCase.execute(baseCommand())).rejects.toThrow('Caixa de destino não encontrada');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('resolves lineage before the Mongo transaction runs (custody-chain ordering)', async () => {
    const order = [];
    const { useCase, storageRepository, lineageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        validateBeforePersistence: async () => {
          order.push('validateBeforePersistence');
        },
        recordCustodyEvent: async () => {
          order.push('recordCustodyEvent');
          return { eventId: 'evt-order' };
        }
      }
    });
    storageRepository.withTransaction.mockImplementationOnce(async (fn) => {
      order.push('withTransaction');
      return fn('session-token');
    });

    await useCase.execute(baseCommand());

    expect(order).toEqual(['validateBeforePersistence', 'recordCustodyEvent', 'withTransaction']);
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
  });

  it('fail-open default: lineage repository absent logs/skips but execute still succeeds', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository } = makeDeps();

    const result = await useCase.execute(baseCommand());

    expect(result.success).toBe(true);
    expect(result.lineageValidated).toBe(false);
    expect(result.lineagePersisted).toBe(false);
    expect(storageRepository.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: lineage repository absent throws before any Mongo transaction call', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = makeDeps();

    await expect(useCase.execute(baseCommand())).rejects.toThrow();
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fail-closed mode is case-insensitive (FAIL-CLOSED)', async () => {
    env.LINEAGE_MODE = 'FAIL-CLOSED';
    const { useCase, storageRepository } = makeDeps();

    await expect(useCase.execute(baseCommand())).rejects.toThrow();
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('lineage repository present and successful: eventId flows through to the result', async () => {
    const { useCase, lineageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        recordCustodyEvent: async () => ({ eventId: 'evt-success' })
      }
    });

    const result = await useCase.execute(baseCommand());

    expect(result.lineageValidated).toBe(true);
    expect(result.lineagePersisted).toBe(true);
    expect(result.lineageSynced).toBe(true);
    expect(result.lineageEventId).toBe('evt-success');
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
  });

  it('lineage repository present but validation throws, fail-open: execute still succeeds with lineage flags false', async () => {
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

  it('lineage repository present but recording throws, fail-closed: execute throws ISO20387 error and Mongo is never touched', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        recordCustodyEvent: async () => {
          throw new Error('neo4j write failed');
        }
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('Mongo transaction failure triggers compensation when lineage was persisted with an eventId, and rethrows the original error', async () => {
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
      sampleId: 'sample-1',
      reason: 'mongo_transaction_failed'
    });
  });

  it('Mongo transaction failure does not attempt compensation when lineage was never persisted', async () => {
    const mongoError = new Error('mongo write conflict 2');
    const { useCase } = makeDeps({
      // no lineage repository at all -> lineagePersisted stays false
      transactionImpl: async () => {
        throw mongoError;
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow('mongo write conflict 2');
    // no lineageRepository exists, so nothing to assert calls on beyond the rethrow succeeding
  });

  it('compensation itself throwing does not mask the original mongoError', async () => {
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
