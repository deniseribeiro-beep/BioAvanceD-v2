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

  it.each([undefined, null, {}, { specimenId: '' }])(
    'rejects a missing specimenId before any storage read',
    async (invalidCommand) => {
      const { useCase, storageRepository } = deps();
      await expect(useCase.execute(invalidCommand)).rejects.toThrow('specimenId é obrigatório');
      expect(storageRepository.findSampleById).not.toHaveBeenCalled();
      expect(storageRepository.withTransaction).not.toHaveBeenCalled();
    }
  );

  it('rejects a missing specimen before opening a transaction', async () => {
    const { useCase, storageRepository } = deps({ sample: null });
    await expect(useCase.execute(command)).rejects.toThrow('Amostra não encontrada');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ boxId: null, positionCode: 'A1' }],
    [{ boxId: 'box-1', positionCode: null }]
  ])('requires both canonical active-placement pointers', async (currentStoragePlacement) => {
    const { useCase, storageRepository } = deps({
      sample: specimen({ currentStoragePlacement })
    });
    await expect(useCase.execute(command)).rejects.toThrow('Amostra não possui posicionamento físico ativo');
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('keeps validation, custody outbox, canonical release, and audit ordered in one session', async () => {
    const order = [];
    const { useCase, storageRepository, auditRepository, lineageRepository } = deps();
    lineageRepository.validateBeforePersistence.mockImplementation(async () => { order.push('validate'); });
    lineageRepository.recordCustodyEvent.mockImplementation(async () => {
      order.push('outbox');
      return { eventId: 'evt-ordered', queued: true };
    });
    storageRepository.releaseSamplePosition.mockImplementation(async () => {
      order.push('release');
      return { from: { boxId: 'box-1', position: 'A1' } };
    });
    auditRepository.appendImmutableAudit.mockImplementation(async () => {
      order.push('audit');
      return { movementID: 3 };
    });

    await useCase.execute(command);

    expect(order).toEqual(['validate', 'outbox', 'release', 'audit']);
  });

  it('fail-open preserves release when lineage validation fails', async () => {
    env.LINEAGE_MODE = 'fail-open';
    const { useCase, storageRepository, lineageRepository } = deps();
    lineageRepository.validateBeforePersistence.mockRejectedValueOnce(new Error('consent unavailable'));

    const result = await useCase.execute(command);

    expect(result).toMatchObject({
      success: true,
      lineageValidated: false,
      lineagePersisted: false,
      lineageQueued: false,
      lineageEventId: null
    });
    expect(storageRepository.releaseSamplePosition).toHaveBeenCalledTimes(1);
  });

  it('treats fail-closed mode case-insensitively', async () => {
    env.LINEAGE_MODE = 'FAIL-CLOSED';
    const { useCase, storageRepository } = deps({ lineage: false });

    await expect(useCase.execute(command)).rejects.toThrow('Repositório canônico de linhagem ausente');
    expect(storageRepository.releaseSamplePosition).not.toHaveBeenCalled();
  });

  it('preserves null payload and missing eventId fallbacks on the v2 outbox contract', async () => {
    const { useCase, lineageRepository } = deps({
      sample: specimen({ barcode: null })
    });
    lineageRepository.recordCustodyEvent.mockResolvedValueOnce({ queued: true });
    const input = { specimenId: 'sample-1' };

    const result = await useCase.execute(input);

    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: null,
        actorId: null,
        reason: 'release',
        from: { boxId: 'box-1', position: 'A1' },
        to: null
      }),
      'session-1'
    );
    expect(result.lineageEventId).toBeNull();
    expect(result.lineageQueued).toBe(true);
  });

});
