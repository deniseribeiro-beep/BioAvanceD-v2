import { describe, it, expect, vi, afterEach } from 'vitest';

const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');
const env = require('../../src/config/env');

function makeSampleSnapshot(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    storageLocation: { boxId: 'box-1', position: 'a1' },
    ...overrides
  };
}

function makeStorageRepository({ sampleSnapshot, releaseResult, releaseImpl } = {}) {
  return {
    findSampleById: vi.fn(() => Promise.resolve(sampleSnapshot)),
    withTransaction: vi.fn(async (fn) => fn('session-1')),
    releaseSamplePosition: releaseImpl
      ? vi.fn(releaseImpl)
      : vi.fn(() => Promise.resolve(releaseResult || { from: { boxId: 'box-1', position: 'A1' } }))
  };
}

function makeAuditRepository() {
  return { appendImmutableAudit: vi.fn(() => Promise.resolve()) };
}

const baseCommand = { sampleId: 'sample-1', actor: { userId: 'user-1' } };

describe('ReleaseSampleUseCase', () => {
  const originalLineageMode = env.LINEAGE_MODE;

  afterEach(() => {
    env.LINEAGE_MODE = originalLineageMode;
    vi.restoreAllMocks();
  });

  it('releases the sample successfully and returns the expected shape (lineage repository present)', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-1' }))
    };

    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });
    const result = await useCase.execute(baseCommand);

    expect(result).toEqual({
      success: true,
      releasedFrom: { sampleId: 'sample-1', boxId: 'box-1', position: 'A1' },
      lineageValidated: true,
      lineagePersisted: true,
      lineageEventId: 'evt-1'
    });
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledTimes(1);
    const [auditPayload] = auditRepository.appendImmutableAudit.mock.calls[0];
    expect(auditPayload.after.storageLocation).toBeNull();
  });

  it('throws when command is undefined', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(undefined)).rejects.toThrow('sampleId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('throws when command is null', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(null)).rejects.toThrow('sampleId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('throws when sampleId is an empty string', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute({ sampleId: '' })).rejects.toThrow('sampleId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('throws when the sample is not found', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: null });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('Amostra não encontrada');
  });

  it('throws when the sample has no storageLocation.boxId', async () => {
    const sampleSnapshot = makeSampleSnapshot({ storageLocation: { position: 'A1' } });
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      'Amostra não possui localização de armazenamento'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('throws when the sample has no storageLocation.position', async () => {
    const sampleSnapshot = makeSampleSnapshot({ storageLocation: { boxId: 'box-1' } });
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      'Amostra não possui localização de armazenamento'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('resolves lineage before the Mongo transaction is opened (custody chain ordering)', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const callOrder = [];
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => {
        callOrder.push('validateBeforePersistence');
        return Promise.resolve();
      }),
      recordCustodyEvent: vi.fn(() => {
        callOrder.push('recordCustodyEvent');
        return Promise.resolve({ eventId: 'evt-order' });
      })
    };
    storageRepository.withTransaction.mockImplementation(async (fn) => {
      callOrder.push('withTransaction');
      return fn('session-1');
    });

    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });
    await useCase.execute(baseCommand);

    expect(callOrder).toEqual(['validateBeforePersistence', 'recordCustodyEvent', 'withTransaction']);

    const [validatePayload] = lineageRepository.validateBeforePersistence.mock.calls[0];
    expect(validatePayload.eventType).toBe('release');
    expect(validatePayload.to).toBeNull();
    expect(validatePayload.reason).toBe('release');
  });

  it('fail-open default: missing lineage repository logs a warning and still succeeds', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    const result = await useCase.execute(baseCommand);

    expect(result.success).toBe(true);
    expect(result.lineageValidated).toBe(false);
    expect(result.lineagePersisted).toBe(false);
    expect(result.lineageEventId).toBeNull();
  });

  it('fail-closed: missing lineage repository throws before any Mongo call', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      '[ISO20387][LINEAGE] Repositório Neo4j ausente para operação de custódia'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('fail-closed is case-insensitive (FAIL-CLOSED)', async () => {
    env.LINEAGE_MODE = 'FAIL-CLOSED';
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      '[ISO20387][LINEAGE] Repositório Neo4j ausente para operação de custódia'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('lineage validate/record throws, fail-open: execute still succeeds with lineage flags false', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.reject(new Error('neo4j down'))),
      recordCustodyEvent: vi.fn()
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    const result = await useCase.execute(baseCommand);

    expect(result.success).toBe(true);
    expect(result.lineageValidated).toBe(false);
    expect(result.lineagePersisted).toBe(false);
    expect(result.lineageEventId).toBeNull();
    expect(lineageRepository.recordCustodyEvent).not.toHaveBeenCalled();
  });

  it('lineage validate/record throws, fail-closed: execute throws ISO20387 error and withTransaction is never called', async () => {
    env.LINEAGE_MODE = 'fail-closed';
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.reject(new Error('neo4j down'))),
      recordCustodyEvent: vi.fn()
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      'ISO20387_LINEAGE_VALIDATION_FAILED: operação bloqueada antes do MongoDB'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('rethrows the original mongo error when the transaction fails, and attempts compensation when lineage was persisted with an eventId', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const mongoError = new Error('mongo release failed');
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    storageRepository.withTransaction.mockImplementation(async () => {
      throw mongoError;
    });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-comp' })),
      compensateCustodyEvent: vi.fn(() => Promise.resolve())
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('mongo release failed');
    expect(lineageRepository.compensateCustodyEvent).toHaveBeenCalledTimes(1);
    expect(lineageRepository.compensateCustodyEvent).toHaveBeenCalledWith({
      eventId: 'evt-comp',
      sampleId: 'sample-1',
      reason: 'mongo_transaction_failed'
    });
  });

  it('does not attempt compensation when lineage was not persisted, and still rethrows the mongo error', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const mongoError = new Error('mongo release failed again');
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    storageRepository.withTransaction.mockImplementation(async () => {
      throw mongoError;
    });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('mongo release failed again');
  });

  it('when compensation itself throws, the original mongo error is still what rejects (not masked)', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const mongoError = new Error('mongo release failed yet again');
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    storageRepository.withTransaction.mockImplementation(async () => {
      throw mongoError;
    });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-comp-2' })),
      compensateCustodyEvent: vi.fn(() => Promise.reject(new Error('compensation also failed')))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('mongo release failed yet again');
    expect(lineageRepository.compensateCustodyEvent).toHaveBeenCalledTimes(1);
  });

  it('throws when the sample disappears between the initial lookup and the transactional re-fetch', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    let callCount = 0;
    storageRepository.findSampleById.mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(callCount === 1 ? sampleSnapshot : null);
    });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('Amostra não encontrada');
  });
});
