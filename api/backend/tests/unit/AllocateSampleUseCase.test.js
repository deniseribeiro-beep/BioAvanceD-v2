import { describe, it, expect, vi, afterEach } from 'vitest';

const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const env = require('../../src/config/env');

const originalLineageMode = env.LINEAGE_MODE;
const placement = {
  specimenId: 'sample-1',
  containerId: 'container-1',
  storageRackId: 'rack-1',
  storagePositionId: 'position-1',
  boxId: 'box-new',
  positionCode: 'B2'
};

function makeSample(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    currentStoragePlacement: null,
    ...overrides
  };
}

function makeDeps({ sample = makeSample(), secondSample, lineage = true, transactionImpl } = {}) {
  const findSampleById = vi.fn().mockResolvedValue(sample);
  if (secondSample !== undefined) {
    findSampleById.mockImplementationOnce(async () => sample).mockImplementationOnce(async () => secondSample);
  }

  const storageRepository = {
    findSampleById,
    allocateSamplePosition: vi.fn().mockResolvedValue(placement),
    withTransaction: vi.fn(async (handler) => transactionImpl ? transactionImpl(handler) : handler('session-1'))
  };
  const auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 1 }) };
  const lineageRepository = lineage ? {
    validateBeforePersistence: vi.fn().mockResolvedValue(true),
    recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1', queued: true })
  } : undefined;

  return {
    useCase: new AllocateSampleUseCase({ storageRepository, auditRepository, lineageRepository }),
    storageRepository,
    auditRepository,
    lineageRepository
  };
}

const command = () => ({
  specimenId: 'sample-1',
  boxId: 'box-new',
  position: 'b2',
  actor: { userId: 'user-1' }
});

afterEach(() => {
  env.LINEAGE_MODE = originalLineageMode;
  vi.restoreAllMocks();
});

describe('AllocateSampleUseCase canonical v2', () => {
  it('validates required allocation fields before persistence', async () => {
    const { useCase, storageRepository } = makeDeps();
    await expect(useCase.execute({ boxId: 'box-new', position: 'A1' })).rejects.toThrow(
      'specimenId, boxId e position são obrigatórios'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('returns the canonical current placement and persists state, outbox lineage and audit in one session', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = makeDeps();
    const result = await useCase.execute(command());

    expect(result).toEqual({
      success: true,
      currentStoragePlacement: placement,
      lineageValidated: true,
      lineagePersisted: true,
      lineageQueued: true,
      lineageEventId: 'evt-1'
    });
    expect(storageRepository.allocateSamplePosition).toHaveBeenCalledWith(
      { specimenId: 'sample-1', boxId: 'box-new', position: 'B2' },
      'session-1'
    );
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(expect.anything(), 'session-1');
  });

  it('audits the previous canonical placement as physicalStorage', async () => {
    const { useCase, auditRepository } = makeDeps({
      sample: makeSample({ currentStoragePlacement: { boxId: 'box-old', positionCode: 'a1' } })
    });
    await useCase.execute(command());
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        before: { physicalStorage: { boxId: 'box-old', position: 'A1' } },
        after: { physicalStorage: { boxId: 'box-new', position: 'B2' } }
      }),
      'session-1'
    );
  });

  it('fails before opening a transaction when the specimen does not exist', async () => {
    const { useCase, storageRepository } = makeDeps({ sample: null });
    await expect(useCase.execute(command())).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fails atomically when the specimen disappears during the transaction', async () => {
    const { useCase, storageRepository } = makeDeps({ sample: makeSample(), secondSample: null });
    await expect(useCase.execute(command())).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.allocateSamplePosition).not.toHaveBeenCalled();
  });

  it('fail-open permits allocation when the lineage repository is unavailable', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository } = makeDeps({ lineage: false });
    const result = await useCase.execute(command());
    expect(result.lineageQueued).toBe(false);
    expect(storageRepository.allocateSamplePosition).toHaveBeenCalledTimes(1);
  });

  it('fail-closed blocks the whole Mongo transaction when canonical lineage cannot be persisted', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = makeDeps({ lineage: false });
    await expect(useCase.execute(command())).rejects.toThrow('Repositório canônico de linhagem ausente');
    expect(storageRepository.allocateSamplePosition).not.toHaveBeenCalled();
  });

  it('rethrows a Mongo transaction failure without any direct graph compensation path', async () => {
    const failure = new Error('mongo transaction failed');
    const { useCase } = makeDeps({ transactionImpl: async () => { throw failure; } });
    await expect(useCase.execute(command())).rejects.toThrow('mongo transaction failed');
  });
});
