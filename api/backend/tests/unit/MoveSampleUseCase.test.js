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
    storageAssignment: { boxId: 'box-src', positionCode: 'a1' },
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
  specimenId: 'sample-1',
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
      specimenId: 'sample-1',
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

  it('#1312: the pre-Mongo validation carries no consent flag; it reads nothing', async () => {
    const { useCase, lineageRepository } = makeDeps({ withLineageRepo: true });

    const result = await useCase.execute(baseCommand());

    expect(result.lineageValidated).toBe(true);
    const validated = lineageRepository.validateBeforePersistence.mock.calls[0][0];
    expect(validated).toMatchObject({ specimenId: 'sample-1', eventType: 'move' });
    expect(validated).not.toHaveProperty('requireEthicalConsent');
  });

  // #1312 (RF023 AC3/AC8): the custody event is an outbox append in the
  // move's own transaction, after the position and audit writes.
  it('#1312: appends the move custody event inside the transaction, with its session', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = makeDeps({ withLineageRepo: true });

    const result = await useCase.execute(baseCommand());

    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(
      {
        specimenId: 'sample-1',
        barcode: 'BC-1',
        eventType: 'move',
        from: { boxId: 'box-src', position: 'A1' },
        to: { boxId: 'box-dest', position: 'B2' },
        actorId: 'user-1',
        reason: 'relocation',
        happenedAt: result.movedAt
      },
      { session: 'session-token' }
    );
    const appendOrder = lineageRepository.recordCustodyEvent.mock.invocationCallOrder[0];
    expect(appendOrder).toBeGreaterThan(storageRepository.withTransaction.mock.invocationCallOrder[0]);
    expect(appendOrder).toBeGreaterThan(storageRepository.moveSamplePosition.mock.invocationCallOrder[0]);
    expect(appendOrder).toBeGreaterThan(auditRepository.appendImmutableAudit.mock.invocationCallOrder[0]);
  });

  it.each(['fail-closed', 'fail-open'])('#1312: a failed append aborts the transaction and refuses the move (%s)', async (mode) => {
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

  it('rejects a missing/non-object command', async () => {
    const { useCase } = makeDeps();
    await expect(useCase.execute(null)).rejects.toThrow('Comando de movimentação inválido');
  });

  it('rejects a command missing specimenId', async () => {
    const { useCase } = makeDeps();
    const cmd = baseCommand();
    delete cmd.specimenId;
    await expect(useCase.execute(cmd)).rejects.toThrow('specimenId é obrigatório');
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
      sample: makeSample({ storageAssignment: { positionCode: 'A1' } })
    });
    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'Amostra não possui localização de origem para movimentação'
    );
  });

  it('throws when the sample has no source position', async () => {
    const { useCase } = makeDeps({
      sample: makeSample({ storageAssignment: { boxId: 'box-src' } })
    });
    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'Amostra não possui localização de origem para movimentação'
    );
  });

  it('throws when target position equals the current position (same box and position)', async () => {
    const { useCase, storageRepository } = makeDeps({
      sample: makeSample({ storageAssignment: { boxId: 'box-src', positionCode: 'A1' } })
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

  it('#1312: validates the custody payload before the transaction and appends it inside', async () => {
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

    expect(order).toEqual(['validateBeforePersistence', 'withTransaction', 'recordCustodyEvent']);
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

  it('lineage repository present but validation throws, fail-closed: execute throws ISO20387 error and Mongo is never touched', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = makeDeps({
      withLineageRepo: true,
      lineageImpl: {
        validateBeforePersistence: async () => {
          throw new Error('eventType obrigatório');
        }
      }
    });

    await expect(useCase.execute(baseCommand())).rejects.toThrow(
      'ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
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

  it('Mongo transaction failure with no lineage repository rethrows the original error', async () => {
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
});
