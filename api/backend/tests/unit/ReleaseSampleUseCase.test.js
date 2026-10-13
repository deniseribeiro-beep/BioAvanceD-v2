import { describe, it, expect, vi, afterEach } from 'vitest';

const ReleaseSampleUseCase = require('../../src/core/use-cases/ReleaseSampleUseCase');
const env = require('../../src/config/env');

function makeSampleSnapshot(overrides = {}) {
  return {
    _id: 'sample-1',
    barcode: 'BC-1',
    storageAssignment: { boxId: 'box-1', positionCode: 'a1' },
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

const baseCommand = { specimenId: 'sample-1', actor: { userId: 'user-1' } };

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
      releasedFrom: { specimenId: 'sample-1', boxId: 'box-1', position: 'A1' },
      lineageValidated: true,
      lineagePersisted: true,
      lineageEventId: 'evt-1'
    });
    expect(auditRepository.appendImmutableAudit).toHaveBeenCalledTimes(1);
    const [auditPayload] = auditRepository.appendImmutableAudit.mock.calls[0];
    expect(auditPayload.after.storageLocation).toBeNull();
    // #1225/#1312: custody reads no consent; the pre-Mongo validation
    // carries no consent flag, so a revoked consent cannot block release to
    // quarantine or discard.
    const [validated] = lineageRepository.validateBeforePersistence.mock.calls[0];
    expect(validated).toMatchObject({ specimenId: 'sample-1', eventType: 'release' });
    expect(validated).not.toHaveProperty('requireEthicalConsent');
  });

  // #1312 (RF023 AC3/AC8): the custody event is an outbox append in the
  // release's own transaction, after the release and audit writes.
  it('#1312: appends the release custody event inside the transaction, with its session', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-1' }))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await useCase.execute(baseCommand);

    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledTimes(1);
    expect(lineageRepository.recordCustodyEvent).toHaveBeenCalledWith(
      {
        specimenId: 'sample-1',
        barcode: 'BC-1',
        eventType: 'release',
        from: { boxId: 'box-1', position: 'A1' },
        to: null,
        actorId: 'user-1',
        reason: 'release',
        happenedAt: expect.any(Date)
      },
      { session: 'session-1' }
    );
    const appendOrder = lineageRepository.recordCustodyEvent.mock.invocationCallOrder[0];
    expect(appendOrder).toBeGreaterThan(storageRepository.withTransaction.mock.invocationCallOrder[0]);
    expect(appendOrder).toBeGreaterThan(storageRepository.releaseSamplePosition.mock.invocationCallOrder[0]);
    expect(appendOrder).toBeGreaterThan(auditRepository.appendImmutableAudit.mock.invocationCallOrder[0]);
  });

  // #1220: the custody ledger row is keyed by the canonical specimenId, as the
  // create path writes it; the storage call and graph event keep the _id.
  it('#1220: the audit row carries the canonical specimenId while storage and lineage get the _id', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot({ specimenId: 'SP-1' }) });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-1' }))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await useCase.execute(baseCommand);

    expect(auditRepository.appendImmutableAudit.mock.calls[0][0].specimenId).toBe('SP-1');
    expect(storageRepository.releaseSamplePosition.mock.calls[0][0].specimenId).toBe('sample-1');
    expect(lineageRepository.recordCustodyEvent.mock.calls[0][0].specimenId).toBe('sample-1');
  });

  it('#1220: a legacy sample without a specimenId keys its audit row by the _id', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-1' }))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await useCase.execute(baseCommand);

    expect(auditRepository.appendImmutableAudit.mock.calls[0][0].specimenId).toBe('sample-1');
  });

  it.each(['fail-closed', 'fail-open'])('#1312: a failed append aborts the transaction and refuses the release (%s)', async (mode) => {
    env.LINEAGE_MODE = mode;
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.reject(new Error('outbox append failed')))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository: makeAuditRepository(), lineageRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('outbox append failed');
  });

  it('throws when command is undefined', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(undefined)).rejects.toThrow('specimenId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('throws when command is null', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(null)).rejects.toThrow('specimenId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('throws when specimenId is an empty string', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: makeSampleSnapshot() });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute({ specimenId: '' })).rejects.toThrow('specimenId é obrigatório');
    expect(storageRepository.findSampleById).not.toHaveBeenCalled();
  });

  it('throws when the sample is not found', async () => {
    const storageRepository = makeStorageRepository({ sampleSnapshot: null });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('Amostra não encontrada');
  });

  it('throws when the sample has no storageAssignment.boxId', async () => {
    const sampleSnapshot = makeSampleSnapshot({ storageAssignment: { positionCode: 'A1' } });
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      'Amostra não possui localização de armazenamento'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('throws when the sample has no storageAssignment.positionCode', async () => {
    const sampleSnapshot = makeSampleSnapshot({ storageAssignment: { boxId: 'box-1' } });
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow(
      'Amostra não possui localização de armazenamento'
    );
    expect(storageRepository.withTransaction).not.toHaveBeenCalled();
  });

  it('#1312: validates the custody payload before the transaction and appends it inside', async () => {
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

    expect(callOrder).toEqual(['validateBeforePersistence', 'withTransaction', 'recordCustodyEvent']);

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
      '[ISO20387][LINEAGE] Repositório de linhagem ausente para operação de custódia'
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
      '[ISO20387][LINEAGE] Repositório de linhagem ausente para operação de custódia'
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

  it('#1312: a transaction that fails before the append records no custody event and rethrows the Mongo error', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const mongoError = new Error('mongo release failed');
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    storageRepository.withTransaction.mockImplementation(async () => {
      throw mongoError;
    });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-comp' }))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await expect(useCase.execute(baseCommand)).rejects.toThrow('mongo release failed');
    expect(lineageRepository.recordCustodyEvent).not.toHaveBeenCalled();
  });

  it('rethrows the mongo error with no lineage repository', async () => {
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

  it('defaults barcode to null and actorId to null when both are absent', async () => {
    const sampleSnapshot = makeSampleSnapshot({ barcode: undefined });
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve({ eventId: 'evt-no-actor' }))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    await useCase.execute({ specimenId: 'sample-1', actor: {} });

    const [validatePayload] = lineageRepository.validateBeforePersistence.mock.calls[0];
    expect(validatePayload.barcode).toBeNull();
    expect(validatePayload.actorId).toBeNull();

    const [auditPayload] = auditRepository.appendImmutableAudit.mock.calls[0];
    expect(auditPayload.barcode).toBeNull();
  });

  it('defaults lineageEventId to null when recordCustodyEvent resolves without an eventId', async () => {
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const lineageRepository = {
      validateBeforePersistence: vi.fn(() => Promise.resolve()),
      recordCustodyEvent: vi.fn(() => Promise.resolve(undefined))
    };
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository, lineageRepository });

    const result = await useCase.execute(baseCommand);

    expect(result.lineageEventId).toBeNull();
  });

  it('defaults LINEAGE_MODE to fail-open when the env var is unset', async () => {
    env.LINEAGE_MODE = '';
    const sampleSnapshot = makeSampleSnapshot();
    const storageRepository = makeStorageRepository({ sampleSnapshot });
    const auditRepository = makeAuditRepository();
    const useCase = new ReleaseSampleUseCase({ storageRepository, auditRepository });

    const result = await useCase.execute(baseCommand);

    expect(result.success).toBe(true);
    expect(result.lineageValidated).toBe(false);
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
