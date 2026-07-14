import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);
const LineageRepository = require2('../../src/infrastructure/database/neo4j/LineageRepository.js');

function makeSession({ records = [], runImpl } = {}) {
  return {
    run: runImpl || vi.fn().mockResolvedValue({ records }),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

function makeDriver(session) {
  return {
    session: vi.fn().mockReturnValue(session)
  };
}

function makeRecord(map) {
  return {
    get: (key) => map[key],
    toObject: () => map
  };
}

describe('LineageRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor / ensureDriver', () => {
    it('throws if driver missing session method', async () => {
      const repo = new LineageRepository({});
      await expect(repo.validateBeforePersistence({ specimenId: '1', eventType: 'X' })).rejects.toThrow(
        'Driver não inicializado'
      );
    });

    it('uses default database name when option not provided', () => {
      const repo = new LineageRepository({ session: vi.fn() });
      expect(repo.database).toBe('neo4j');
    });

    it('uses provided database option', () => {
      const repo = new LineageRepository({ session: vi.fn() }, { database: 'customdb' });
      expect(repo.database).toBe('customdb');
    });
  });

  describe('normalizePointerId', () => {
    it('trims and stringifies a valid pointer', () => {
      const repo = new LineageRepository({ session: vi.fn() });
      expect(repo.normalizePointerId('  abc  ', 'specimenId')).toBe('abc');
    });

    it('throws for null/undefined/empty pointer', () => {
      const repo = new LineageRepository({ session: vi.fn() });
      expect(() => repo.normalizePointerId(null, 'specimenId')).toThrow('specimenId obrigatório');
      expect(() => repo.normalizePointerId(undefined, 'parentSampleId')).toThrow('parentSampleId obrigatório');
      expect(() => repo.normalizePointerId('   ', 'eventId')).toThrow('eventId obrigatório');
    });
  });

  describe('validateBeforePersistence', () => {
    it('resolves true when an active consent status is present', async () => {
      const record = makeRecord({ sampleConsentStatus: 'UNKNOWN', consentStatuses: ['ACTIVE'] });
      const session = makeSession({ records: [record] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      const result = await repo.validateBeforePersistence({ specimenId: 's1', eventType: 'CREATE' });

      expect(result).toBe(true);
      expect(session.close).toHaveBeenCalled();
    });

    it('rejects when eventType is missing', async () => {
      const session = makeSession();
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.validateBeforePersistence({ specimenId: 's1' })).rejects.toThrow('eventType obrigatório');
    });

    it('rejects when consent is required but no active status found', async () => {
      const record = makeRecord({ sampleConsentStatus: 'UNKNOWN', consentStatuses: ['REVOKED'] });
      const session = makeSession({ records: [record] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(
        repo.validateBeforePersistence({ specimenId: 's1', eventType: 'CREATE' })
      ).rejects.toThrow('Consentimento ético ativo não encontrado');
      expect(session.close).toHaveBeenCalled();
    });

    it('skips consent check when requireEthicalConsent is false', async () => {
      const record = makeRecord({ sampleConsentStatus: 'UNKNOWN', consentStatuses: [] });
      const session = makeSession({ records: [record] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      const result = await repo.validateBeforePersistence({
        specimenId: 's1',
        eventType: 'CREATE',
        requireEthicalConsent: false
      });

      expect(result).toBe(true);
    });

    it('closes session even when session.run throws', async () => {
      const session = makeSession({ runImpl: vi.fn().mockRejectedValue(new Error('db down')) });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.validateBeforePersistence({ specimenId: 's1', eventType: 'CREATE' })).rejects.toThrow(
        'db down'
      );
      expect(session.close).toHaveBeenCalled();
    });
  });

  describe('createSampleNodeWithParent', () => {
    it('returns the created relationship data on success', async () => {
      const record = makeRecord({ specimenId: 'child1', parentId: 'parent1', relationshipType: 'ALIQUOT' });
      const session = makeSession({ records: [record] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      const result = await repo.createSampleNodeWithParent({
        specimenId: 'child1',
        parentSampleId: 'parent1',
        relationshipType: 'ALIQUOT'
      });

      expect(result).toEqual({ specimenId: 'child1', parentId: 'parent1', relationshipType: 'ALIQUOT' });
    });

    it('throws when parent has no active consent (no records returned)', async () => {
      const session = makeSession({ records: [] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(
        repo.createSampleNodeWithParent({ specimenId: 'child1', parentSampleId: 'parent1' })
      ).rejects.toThrow('Amostra pai sem consentimento ativo');
    });

    it('throws when specimenId is missing', async () => {
      const session = makeSession();
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(
        repo.createSampleNodeWithParent({ parentSampleId: 'parent1' })
      ).rejects.toThrow('specimenId obrigatório');
    });

    it('propagates and logs errors from session.run', async () => {
      const session = makeSession({ runImpl: vi.fn().mockRejectedValue(new Error('cypher error')) });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(
        repo.createSampleNodeWithParent({ specimenId: 'child1', parentSampleId: 'parent1' })
      ).rejects.toThrow('cypher error');
      expect(session.close).toHaveBeenCalled();
    });
  });

  describe('recordCustodyEvent', () => {
    it('resolves with the generated eventId on success', async () => {
      const session = makeSession({ records: [] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      const result = await repo.recordCustodyEvent({ specimenId: 's1', eventType: 'MOVE' });

      expect(result.eventId).toMatch(/^MOVE-s1-\d+$/);
      expect(session.run).toHaveBeenCalled();
    });

    it('passes normalized from/to storage positions to the query', async () => {
      const session = makeSession({ records: [] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await repo.recordCustodyEvent({
        specimenId: 's1',
        eventType: 'MOVE',
        from: { boxId: 'boxA', position: 'a1' },
        to: { boxId: 'boxB', position: 'b2' }
      });

      const params = session.run.mock.calls[0][1];
      expect(params.fromBoxId).toBe('boxA');
      expect(params.fromPosition).toBe('A1');
      expect(params.toBoxId).toBe('boxB');
      expect(params.toPosition).toBe('B2');
    });

    it('throws when specimenId is missing', async () => {
      const session = makeSession();
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.recordCustodyEvent({ eventType: 'MOVE' })).rejects.toThrow('specimenId obrigatório');
    });

    it('throws when eventType is missing instead of writing a malformed eventId', async () => {
      const session = makeSession();
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.recordCustodyEvent({ specimenId: 's1' })).rejects.toThrow('eventType obrigatório');
      expect(session.run).not.toHaveBeenCalled();
    });

    it('propagates errors from session.run and still closes session', async () => {
      const session = makeSession({ runImpl: vi.fn().mockRejectedValue(new Error('write failed')) });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.recordCustodyEvent({ specimenId: 's1', eventType: 'MOVE' })).rejects.toThrow('write failed');
      expect(session.close).toHaveBeenCalled();
    });
  });

  describe('compensateCustodyEvent', () => {
    it('returns compensation summary on success', async () => {
      const record = makeRecord({ cleanedPositions: 2 });
      const session = makeSession({ records: [record] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      const result = await repo.compensateCustodyEvent({ eventId: 'evt1' });

      expect(result).toEqual({ compensated: true, eventId: 'evt1', cleanedPositions: 2 });
    });

    it('defaults cleanedPositions to 0 when no records returned', async () => {
      const session = makeSession({ records: [] });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      const result = await repo.compensateCustodyEvent({ eventId: 'evt1' });

      expect(result.cleanedPositions).toBe(0);
    });

    it('throws when eventId is missing', async () => {
      const session = makeSession();
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.compensateCustodyEvent({})).rejects.toThrow('eventId obrigatório');
    });

    it('propagates errors from session.run and still closes session', async () => {
      const session = makeSession({ runImpl: vi.fn().mockRejectedValue(new Error('compensation failed')) });
      const driver = makeDriver(session);
      const repo = new LineageRepository(driver);

      await expect(repo.compensateCustodyEvent({ eventId: 'evt1' })).rejects.toThrow('compensation failed');
      expect(session.close).toHaveBeenCalled();
    });
  });
});
