import { describe, it, expect, vi, afterEach } from 'vitest';

const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');
const env = require('../../src/config/env');

const originalLineageMode = env.LINEAGE_MODE;

function specimen(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    currentStoragePlacement: { boxId: 'box-1', positionCode: 'A1' },
    ...overrides
  };
}

function deps({ sample = specimen(), transactionalSample, lineage = true, transactionImpl } = {}) {
  const findSampleById = vi.fn().mockResolvedValue(sample);
  if (transactionalSample !== undefined) {
    findSampleById.mockImplementationOnce(async () => sample).mockImplementationOnce(async () => transactionalSample);
  }
  const storageRepository = {
    findSampleById,
    releaseSamplePosition: vi.fn().mockResolvedValue({ from: { boxId: 'box-1', position: 'A1' } }),
    withTransaction: vi.fn(async (handler) => transactionImpl ? transactionImpl(handler) : handler('session-1'))
  };
  const auditRepository = { appendImmutableAudit: vi.fn().mockResolvedValue({ movementID: 3 }) };
  const lineageRepository = lineage ? {
    validateBeforePersistence: vi.fn().mockResolvedValue(true),
    recordCustodyEvent: vi.fn().mockResolvedValue({ eventId: 'evt-release', queued: true })
  } : undefined;
  return {
    useCase: new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository }),
    storageRepository,
    auditRepository,
    lineageRepository
  };
}

const command = { specimenId: 'sample-1', actor: { userId: 'user-1' } };

afterEach(() => {
  env.LINEAGE_MODE = originalLineageMode;
  vi.restoreAllMocks();
});

describe('ReleaseSampleUseCase canonical v2', () => {
  it('requires specimenId before persistence', async () => {
    const { useCase, storageRepository } = deps();
    await expect(useCase.execute({})).rejects.toThrow('specimenId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('requires an active canonical physical placement', async () => {
    const { useCase, storageRepository } = deps({ sample: specimen({ currentStoragePlacement: null }) });
    await expect(useCase.execute(command)).rejects.toThrow('Amostra não possui posicionamento físico ativo');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('releases normalized custody, queues lineage and audits in one Mongo session', async () => {
    const { useCase, storageRepository, auditRepository, lineageRepository } = deps();
    const result = await useCase.execute(command);

    expect(result).toEqual({
      success: true,
      releasedFrom: { specimenId: 'sample-1', boxId: 'box-1', position: 'A1' },
      lineageValidated: true,
      lineagePersisted: true,
      lineageQueued: true,
      lineageEventId: 'evt-release'
    });
    expect(lineageRepository.validateBeforePersistence).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'release', from: { boxId: 'box-1', position: 'A1' }, to: null
    }), 'session-1');
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(expect.anything(), 'session-1');
    expect(storageRepository.releaseSamplePosition).toHaveBeenCalledWith({ specimenId: 'sample-1' }, 'session-1');
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledWith(expect.objectContaining({
      before: { physicalStorage: { boxId: 'box-1', position: 'A1' } },
      after: { physicalStorage: null }
    }), 'session-1');
  });

  it('fails atomically if the specimen disappears during the transaction', async () => {
    const { useCase, storageRepository } = deps({ sample: specimen(), transactionalSample: null });
    await expect(useCase.execute(command)).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.releaseSamplePosition).not.toHaveBeenCalled();
  });

  it('fail-open permits release when lineage repository is unavailable', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository } = deps({ lineage: false });
    const result = await useCase.execute(command);
    expect(result.lineageQueued).toBe(false);
    expect(storageRepository.releaseSamplePosition).toHaveBeenCalledTimes(1);
  });

  it('fail-closed blocks release when canonical lineage cannot be persisted', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository } = deps({ lineage: false });
    await expect(useCase.execute(command)).rejects.toThrow('Repositório canônico de linhagem ausente');
    expect(storageRepository.releaseSamplePosition).not.toHaveBeenCalled();
  });

  it('maps an outbox failure to a fail-closed rejection before the state mutation', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const { useCase, storageRepository, lineageRepository } = deps();
    lineageRepository.recordCustodyEvent.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(useCase.execute(command)).rejects.toThrow('RF023_LINEAGE_VALIDATION_FAILED');
    expect(storageRepository.releaseSamplePosition).not.toHaveBeenCalled();
  });

  it('rethrows a Mongo transaction failure without a direct graph compensation path', async () => {
    const { useCase } = deps({ transactionImpl: async () => { throw new Error('mongo release failed'); } });
    await expect(useCase.execute(command)).rejects.toThrow('mongo release failed');
  });
});
