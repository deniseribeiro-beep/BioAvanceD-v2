import { describe, it, expect, vi, afterEach } from 'vitest';

const MoveSampleUseCase = require('../../src/core/use-cases/MoveSampleUseCase');
const env = require('../../src/config/env');

const originalLineageMode = env.LINEAGE_MODE;

function sample(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    currentStoragePlacement: { boxId: 'box-src', positionCode: 'A1' },
    ...overrides
  };
}

function deps({ specimen = sample(), transactionalSpecimen, targetBox = { _id: 'box-dest' }, lineage = true, transactionImpl } = {}) {
  const findSampleById = vi.fn().mockResolvedValue(specimen);
  if (transactionalSpecimen !== undefined) {
    findSampleById.mockImplementationOnce(async () => specimen).mockImplementationOnce(async () => transactionalSpecimen);
  }
  const storageRepository = {
    findSampleById,
    findBoxById: vi.fn().mockResolvedValue(targetBox),
    moveSamplePosition: vi.fn().mockResolvedValue({
      newPlacement: { boxId: 'box-dest', positionCode: 'B2' }
    }),
    withTransaction: vi.fn(async (handler) => transactionImpl ? transactionImpl(handler) : handler('session-1'))
  };
  const auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 42 }) };
  const lineageRepository = lineage ? {
    validateBeforePersistence: vi.fn().mockResolvedValue(true),
    recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-move', queued: true })
  } : undefined;
  return {
    useCase: new MoveSampleUseCase({ storageRepository, auditRepository, lineageRepository }),
    storageRepository,
    auditRepository,
    lineageRepository
  };
}

const command = () => ({
  specimenId: 'sample-1',
  targetBoxId: 'box-dest',
  targetPosition: 'b2',
  reason: 'relocation',
  notes: 'governed move',
  actor: { userId: 'user-1' }
});

afterEach(() => {
  env.LINEAGE_MODE = originalLineageMode;
  vi.restoreAllMocks();
});

describe('MoveSampleUseCase canonical v2', () => {
  it('rejects malformed commands before opening a transaction', async () => {
    const { useCase, storageRepository } = deps();
    await expect(useCase.execute({ specimenId: 'sample-1', targetBoxId: 'box-dest', targetPosition: 'AA' }))
      .rejects.toThrow('targetPosition deve seguir formato Letra+Número');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('requires an active canonical physical placement as the source', async () => {
    const { useCase, storageRepository } = deps({ specimen: sample({ currentStoragePlacement: null }) });
    await expect(useCase.execute(command())).rejects.toThrow('posicionamento físico de origem');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('moves, audits and queues lineage in the same Mongo session', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = deps();
    const result = await useCase.execute(command());

    expect(result).toEqual({
      success: true,
      movementID: 42,
      specimenId: 'sample-1',
      from: { boxId: 'box-src', position: 'A1' },
      to: { boxId: 'box-dest', position: 'B2' },
      movedAt: expect.any(Date),
      lineageSynced: true,
      lineageValidated: true,
      lineagePersisted: true,
      lineageQueued: true,
      lineageEventId: 'evt-move'
    });
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(storageRepository.moveSamplePosition).toHaveBeenCalledWith(expect.objectContaining({
      fromBoxId: 'box-src', fromPosition: 'A1', toBoxId: 'box-dest', toPosition: 'B2'
    }), 'session-1');
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(expect.objectContaining({
      before: { physicalStorage: { boxId: 'box-src', position: 'A1' } },
      after: { physicalStorage: { boxId: 'box-dest', position: 'B2' } }
    }), 'session-1');
  });

  it('detects a concurrent source-placement change inside the transaction', async () => {
    const { useCase, storageRepository } = deps({
      specimen: sample(),
      transactionalSpecimen: sample({ currentStoragePlacement: { boxId: 'box-src', positionCode: 'A2' } })
    });
    await expect(useCase.execute(command())).rejects.toThrow('Posicionamento físico de origem mudou');
    expect(storageRepository.moveSamplePosition).not.toHaveBeenCalled();
  });

  it('rejects a missing target box before mutation', async () => {
    const { useCase, storageRepository } = deps({ targetBox: null });
    await expect(useCase.execute(command())).rejects.toThrow('Caixa de destino não encontrada');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fail-open keeps the custody mutation available when lineage repository is unavailable', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository } = deps({ lineage: false });
    const result = await useCase.execute(command());
    expect(result.lineageQueued).toBe(false);
    expect(storageRepository.moveSamplePosition).toHaveBeenCalledTimes(1);
  });

  it('fail-closed prevents the custody mutation when canonical lineage cannot be persisted', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = deps({ lineage: false });
    await expect(useCase.execute(command())).rejects.toThrow('Repositório canônico de linhagem ausente');
    expect(storageRepository.moveSamplePosition).not.toHaveBeenCalled();
  });

  it('rethrows transaction failure without a direct Neo4j compensation write', async () => {
    const { useCase } = deps({ transactionImpl: async () => { throw new Error('mongo write conflict'); } });
    await expect(useCase.execute(command())).rejects.toThrow('mongo write conflict');
  });

  it.each([
    [null, 'Comando de movimentação inválido'],
    [{}, 'specimenId é obrigatório'],
    [{ specimenId: 'sample-1' }, 'targetBoxId é obrigatório'],
    [{ specimenId: 'sample-1', targetBoxId: 'box-dest' }, 'targetPosition é obrigatório'],
    [{ specimenId: 'sample-1', targetBoxId: 'box-dest', targetPosition: 2 }, 'targetPosition é obrigatório'],
    [{ specimenId: 'sample-1', targetBoxId: 'box-dest', targetPosition: '123' }, 'targetPosition deve seguir formato Letra+Número']
  ])('rejects each malformed move command before persistence', async (invalidCommand, message) => {
    const { useCase, storageRepository } = deps();
    await expect(useCase.execute(invalidCommand)).rejects.toThrow(message);
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a missing specimen before opening a transaction', async () => {
    const { useCase, storageRepository } = deps({ specimen: null });
    await expect(useCase.execute(command())).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ boxId: null, positionCode: 'A1' }],
    [{ boxId: 'box-src', positionCode: null }]
  ])('requires both canonical source-placement pointers', async (currentStoragePlacement) => {
    const { useCase, storageRepository } = deps({
      specimen: sample({ currentStoragePlacement })
    });
    await expect(useCase.execute(command())).rejects.toThrow('posicionamento físico de origem');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a destination equal to the current canonical position', async () => {
    const { useCase, storageRepository } = deps();
    const input = command();
    input.targetBoxId = 'box-src';
    input.targetPosition = 'a1';

    await expect(useCase.execute(input)).rejects.toThrow(
      'A posição de destino deve ser diferente da posição atual'
    );
    expect(storageRepository.findBoxById).not.toHaveBeenCalled();
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fails atomically when the target box disappears inside the transaction', async () => {
    const { useCase, storageRepository } = deps();
    storageRepository.findBoxById
      .mockResolvedValueOnce({ _id: 'box-dest' })
      .mockResolvedValueOnce(null);

    await expect(useCase.execute(command())).rejects.toThrow('Caixa de destino não encontrada');
    expect(storageRepository.moveSamplePosition).not.toHaveBeenCalled();
  });

  it('keeps validation, custody outbox, canonical move, and audit ordered in one session', async () => {
    const order = [];
    const { useCase, storageRepository, auditRepository, lineageRepository } = deps();
    lineageRepository.validateBeforePersistence.mockImplementation(async () => { order.push('validate'); });
    lineageRepository.recordCustodyEvent.mockImplementation(async () => {
      order.push('outbox');
      return { eventId: 'evt-ordered', queued: true };
    });
    storageRepository.moveSamplePosition.mockImplementation(async () => { order.push('move'); });
    auditRepository.appendImmutableAudit.mockImplementation(async () => {
      order.push('audit');
      return { movementID: 42 };
    });

    await useCase.execute(command());

    expect(order).toEqual(['validate', 'outbox', 'move', 'audit']);
  });

  it('fail-open preserves the canonical move when lineage validation fails', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository, lineageRepository } = deps();
    lineageRepository.validateBeforePersistence.mockRejectedValueOnce(new Error('consent unavailable'));

    const result = await useCase.execute(command());

    expect(result).toMatchObject({
      success: true,
      lineageValidated: false,
      lineagePersisted: false,
      lineageQueued: false,
      lineageEventId: null
    });
    expect(storageRepository.moveSamplePosition).toHaveBeenCalledTimes(1);
  });

  it('case-insensitive fail-closed blocks the move when custody outbox append fails', async () => {
    env.LINEAGE_MODE = 'FAIL-CLOSED';
    const { useCase, storageRepository, lineageRepository } = deps();
    lineageRepository.recordCustodyEvent.mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(useCase.execute(command())).rejects.toThrow(
      'RF023_LINEAGE_VALIDATION_FAILED: outbox unavailable'
    );
    expect(storageRepository.moveSamplePosition).not.toHaveBeenCalled();
  });

  it('preserves null payload fallbacks without restoring legacy storage contracts', async () => {
    const { useCase, lineageRepository } = deps({
      specimen: sample({ barcode: null })
    });
    const input = command();
    delete input.actor;
    delete input.reason;

    await useCase.execute(input);

    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: null,
        actorId: null,
        reason: null,
        from: { boxId: 'box-src', position: 'A1' },
        to: { boxId: 'box-dest', position: 'B2' }
      }),
      'session-1'
    );
  });

});
