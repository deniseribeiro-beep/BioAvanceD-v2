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
});
