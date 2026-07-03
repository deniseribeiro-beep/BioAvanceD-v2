import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const env = require('../../src/config/env');

describe('consentNeo4jSync.service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete env.CONSENT_SYNC_BATCH_SIZE;
    delete env.NEO4J_DATABASE;
  });

  function loadService() {
    require.cache[require.resolve('../../src/services/consentNeo4jSync.service')] &&
      delete require.cache[require.resolve('../../src/services/consentNeo4jSync.service')];
    return require('../../src/services/consentNeo4jSync.service');
  }

  // Fake db: no listCollections method, so resolveSourceCollectionName
  // (per collectionResolver.js) short-circuits and returns the CANONICAL name
  // directly without needing to be stubbed/spied at all. This sidesteps the
  // destructuring-spy gotcha entirely.
  function createFakeDb({ consentDocs = [], samples = [] } = {}) {
    const consentsCollection = {
      aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(consentDocs) })
    };

    let idx = 0;
    const samplesCollection = {
      find: vi.fn().mockReturnValue({
        hasNext: vi.fn(async () => idx < samples.length),
        next: vi.fn(async () => samples[idx++])
      })
    };

    const db = {
      collection: vi.fn((name) => {
        if (name === 'consents' || name.toLowerCase().includes('consent')) return consentsCollection;
        return samplesCollection;
      }),
      __consentsCollection: consentsCollection,
      __samplesCollection: samplesCollection
    };
    return db;
  }

  function createFakeSession(runImpl) {
    return {
      run: vi.fn(runImpl || (async () => ({ records: [{ get: () => 1 }] }))),
      close: vi.fn().mockResolvedValue(undefined)
    };
  }

  function createFakeDriver(session) {
    return { session: vi.fn(() => session) };
  }

  describe('normalizeStatus', () => {
    it.each([
      ['ACTIVE', 'ACTIVE'],
      ['active', 'ACTIVE'],
      [' Valid ', 'ACTIVE'],
      ['granted', 'ACTIVE'],
      ['REVOKED', 'REVOKED'],
      ['denied', 'REVOKED'],
      ['Expired', 'REVOKED'],
      ['something-else', 'UNKNOWN'],
      [undefined, 'UNKNOWN'],
      [null, 'UNKNOWN'],
      ['', 'UNKNOWN']
    ])('normalizeStatus(%p) -> %p', (input, expected) => {
      const service = loadService();
      expect(service.normalizeStatus(input)).toBe(expected);
    });
  });

  describe('toIsoDate', () => {
    it('returns null for falsy input', () => {
      const service = loadService();
      expect(service.toIsoDate(null)).toBeNull();
      expect(service.toIsoDate(undefined)).toBeNull();
      expect(service.toIsoDate('')).toBeNull();
    });

    it('returns null for invalid date string', () => {
      const service = loadService();
      expect(service.toIsoDate('not-a-date')).toBeNull();
    });

    it('accepts a Date instance directly and returns its ISO string', () => {
      const service = loadService();
      const d = new Date('2024-01-15T10:00:00.000Z');
      expect(service.toIsoDate(d)).toBe(d.toISOString());
    });

    it('coerces a valid date string via new Date()', () => {
      const service = loadService();
      expect(service.toIsoDate('2024-01-15')).toBe(new Date('2024-01-15').toISOString());
    });
  });

  describe('buildConsentMap', () => {
    it('builds a map keyed by String(patientId) from the aggregation, skipping entries without _id', async () => {
      const service = loadService();
      const db = createFakeDb({
        consentDocs: [
          { _id: 'p1', consent: { status: 'ACTIVE', patientId: 'p1' } },
          { _id: null, consent: { status: 'REVOKED' } }, // no _id, should be skipped
          { _id: 42, consent: { status: 'REVOKED', patientId: 42 } }
        ]
      });

      const { consentMap, consentCollectionName } = await service.buildConsentMap(db);

      expect(consentMap.size).toBe(2);
      expect(consentMap.get('p1')).toEqual({ status: 'ACTIVE', patientId: 'p1' });
      expect(consentMap.get('42')).toEqual({ status: 'REVOKED', patientId: 42 });
      expect(typeof consentCollectionName).toBe('string');
      expect(db.__consentsCollection.aggregate).toHaveBeenCalled();
    });

    it('produces an empty map when aggregation yields nothing', async () => {
      const service = loadService();
      const db = createFakeDb({ consentDocs: [] });
      const { consentMap } = await service.buildConsentMap(db);
      expect(consentMap.size).toBe(0);
    });
  });

  describe('sync', () => {
    it('throws if db is missing', async () => {
      const service = loadService();
      await expect(service.sync({ db: null, neo4jDriver: createFakeDriver(createFakeSession()) }))
        .rejects.toThrow('[ISO20387][SYNC] Banco MongoDB é obrigatório');
    });

    it('throws if neo4jDriver is missing', async () => {
      const service = loadService();
      const db = createFakeDb();
      await expect(service.sync({ db, neo4jDriver: null }))
        .rejects.toThrow('[ISO20387][SYNC] Driver Neo4j é obrigatório');
    });

    it('throws if neo4jDriver.session is not a function', async () => {
      const service = loadService();
      const db = createFakeDb();
      await expect(service.sync({ db, neo4jDriver: {} }))
        .rejects.toThrow('[ISO20387][SYNC] Driver Neo4j é obrigatório');
    });

    it('processes samples, flushes at batch threshold, and flushes remainder, accumulating updated count', async () => {
      env.CONSENT_SYNC_BATCH_SIZE = 2;
      const service = loadService();

      const samples = [
        { _id: 's1', patientID: 'p1', barcode: 'b1', updatedAt: new Date('2024-01-01') },
        { _id: 's2', patientID: 'p2', barcode: 'b2', updatedAt: new Date('2024-01-02') },
        { _id: 's3', patientID: 'p3', barcode: 'b3', updatedAt: new Date('2024-01-03') }
      ];
      const db = createFakeDb({
        consentDocs: [{ _id: 'p1', consent: { status: 'ACTIVE', patientId: 'p1', signedAt: new Date('2023-01-01') } }],
        samples
      });

      let runCallCount = 0;
      const session = createFakeSession(async (query, params) => {
        runCallCount += 1;
        // first flush should have 2 rows (batch size), second (remainder) 1 row
        expect(Array.isArray(params.rows)).toBe(true);
        return { records: [{ get: (key) => (key === 'synced' ? params.rows.length : undefined) }] };
      });
      const driver = createFakeDriver(session);

      const result = await service.sync({ db, neo4jDriver: driver });

      expect(runCallCount).toBe(2); // one at threshold, one for remainder
      expect(result.processed).toBe(3);
      expect(result.updated).toBe(3); // 2 + 1
      expect(typeof result.consentCollection).toBe('string');
      expect(session.close).toHaveBeenCalledTimes(1);
    });

    it('marks a sample with no matching consent as hasConsent:false / UNKNOWN via a real flush call', async () => {
      env.CONSENT_SYNC_BATCH_SIZE = 500;
      const service = loadService();

      const samples = [
        { _id: 's1', patientID: 'unknown-patient', barcode: 'b1', updatedAt: new Date('2024-01-01') }
      ];
      const db = createFakeDb({ consentDocs: [], samples });

      let capturedRows = null;
      const session = createFakeSession(async (query, params) => {
        capturedRows = params.rows;
        return { records: [{ get: () => params.rows.length }] };
      });
      const driver = createFakeDriver(session);

      const result = await service.sync({ db, neo4jDriver: driver });

      expect(capturedRows).toHaveLength(1);
      expect(capturedRows[0].hasConsent).toBe(false);
      expect(capturedRows[0].consentStatus).toBe('UNKNOWN');
      expect(result.processed).toBe(1);
      expect(result.updated).toBe(1);
    });

    it('always closes the session even when the cursor loop throws', async () => {
      env.CONSENT_SYNC_BATCH_SIZE = 500;
      const service = loadService();

      const db = createFakeDb({ consentDocs: [] });
      // Override find() to throw on next() mid-loop
      db.__samplesCollection.find = vi.fn().mockReturnValue({
        hasNext: vi.fn().mockResolvedValue(true),
        next: vi.fn().mockRejectedValue(new Error('cursor exploded'))
      });

      const session = createFakeSession();
      const driver = createFakeDriver(session);

      await expect(service.sync({ db, neo4jDriver: driver })).rejects.toThrow('cursor exploded');
      expect(session.close).toHaveBeenCalledTimes(1);
    });

    it('opens the neo4j session with env.NEO4J_DATABASE when set, else defaults to "neo4j"', async () => {
      env.NEO4J_DATABASE = 'custom-db';
      const service = loadService();
      const db = createFakeDb({ consentDocs: [], samples: [] });
      const session = createFakeSession();
      const driver = createFakeDriver(session);

      await service.sync({ db, neo4jDriver: driver });

      expect(driver.session).toHaveBeenCalledWith({ database: 'custom-db' });
    });
  });

  describe('flushBatch', () => {
    it('returns 0 immediately for an empty array without calling session.run', async () => {
      const service = loadService();
      const session = createFakeSession();
      const result = await service.flushBatch(session, []);
      expect(result).toBe(0);
      expect(session.run).not.toHaveBeenCalled();
    });

    it('calls session.run with {rows} and extracts the synced count from the result', async () => {
      const service = loadService();
      const rows = [{ sampleId: 's1' }, { sampleId: 's2' }];
      const session = createFakeSession(async () => ({
        records: [{ get: (key) => (key === 'synced' ? 2 : undefined) }]
      }));

      const result = await service.flushBatch(session, rows);

      expect(session.run).toHaveBeenCalledWith(expect.any(String), { rows });
      expect(result).toBe(2);
    });

    it('returns 0 when result.records is empty', async () => {
      const service = loadService();
      const session = createFakeSession(async () => ({ records: [] }));
      const result = await service.flushBatch(session, [{ sampleId: 's1' }]);
      expect(result).toBe(0);
    });
  });
});
