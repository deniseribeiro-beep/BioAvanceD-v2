import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require2 = createRequire(import.meta.url);

const integrityCheckService = require2('../../src/services/integrityCheckService');
const { computeAuditHash } = integrityCheckService;
const biomarkerIntegrityService = require2('../../src/services/biomarker-integrity.service');
const mqttIngestionAuditService = require2('../../src/services/mqtt-ingestion-audit.service');
const logService = require2('../../src/services/log.service');

function makeDb({ docs = [], bulkWriteImpl } = {}) {
  const toArray = vi.fn().mockResolvedValue(docs);
  const sort = vi.fn().mockReturnValue({ toArray });
  const find = vi.fn().mockReturnValue({ sort });
  const bulkWrite = bulkWriteImpl || vi.fn().mockResolvedValue({});
  const collection = vi.fn().mockReturnValue({ find, bulkWrite });
  return { collection, find, sort, toArray, bulkWrite };
}

describe('integrityCheckService.computeAuditHash', () => {
  it('produces a deterministic sha256 hex string', () => {
    const log = { userID: 'U1', action: 'CREATE', entity: 'Sample', entityID: 'S1', message: 'hi' };
    const hash = computeAuditHash(log);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeAuditHash(log)).toBe(hash);
  });

  it('is stable regardless of key insertion order', () => {
    const logA = { userID: 'U1', action: 'CREATE', entity: 'Sample' };
    const logB = { entity: 'Sample', action: 'CREATE', userID: 'U1' };
    expect(computeAuditHash(logA)).toBe(computeAuditHash(logB));
  });

  it('differs when payload content differs', () => {
    const logA = { userID: 'U1', action: 'CREATE', entity: 'Sample' };
    const logB = { userID: 'U1', action: 'DELETE', entity: 'Sample' };
    expect(computeAuditHash(logA)).not.toBe(computeAuditHash(logB));
  });

  it('stringifies a mongoose/bson ObjectId-like value via toHexString', () => {
    const objectIdLike = { toHexString: () => 'abc123' };
    const log = { userID: 'U1', action: 'CREATE', payload: { ref: objectIdLike } };
    const hashWithIdLike = computeAuditHash(log);
    const hashWithHexString = computeAuditHash({ userID: 'U1', action: 'CREATE', payload: { ref: 'abc123' } });
    expect(hashWithIdLike).toBe(hashWithHexString);
  });

  it('stringifies a raw _bsontype ObjectID via String() when no toHexString is present', () => {
    const bsonLike = { _bsontype: 'ObjectID', toString: () => 'deadbeef' };
    const log = { userID: 'U1', action: 'CREATE', payload: { ref: bsonLike } };
    const hashWithBson = computeAuditHash(log);
    const hashWithString = computeAuditHash({ userID: 'U1', action: 'CREATE', payload: { ref: 'deadbeef' } });
    expect(hashWithBson).toBe(hashWithString);
  });

  it('recurses into arrays nested in payload/metadata', () => {
    const log = { userID: 'U1', action: 'CREATE', payload: { items: ['a', 'b', 3] } };
    const hashArray = computeAuditHash(log);
    const hashDifferentOrder = computeAuditHash({ userID: 'U1', action: 'CREATE', payload: { items: [3, 'b', 'a'] } });
    expect(hashArray).not.toBe(hashDifferentOrder);
    expect(hashArray).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serializes a Date instance nested in payload via toISOString', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const log = { userID: 'U1', action: 'CREATE', payload: { at: date } };
    const hashWithDate = computeAuditHash(log);
    const hashWithIso = computeAuditHash({ userID: 'U1', action: 'CREATE', payload: { at: date.toISOString() } });
    expect(hashWithDate).toBe(hashWithIso);
    expect(hashWithDate).toMatch(/^[0-9a-f]{64}$/);
  });

  it('falls back to plain JSON.stringify for values with no dedicated branch (e.g. a function value)', () => {
    const log = { userID: 'U1', action: 'CREATE', payload: { fn: () => {} } };
    expect(() => computeAuditHash(log)).not.toThrow();
    const hashWithFn = computeAuditHash(log);
    const hashWithOtherFn = computeAuditHash({ userID: 'U1', action: 'CREATE', payload: { fn: function other() {} } });
    // JSON.stringify(functionValue) === undefined regardless of which function, so both serialize identically
    expect(hashWithFn).toBe(hashWithOtherFn);
  });

  it('derives timestampISO from dateTime/timestamp/createdAt when timestampISO is absent', () => {
    const withDateTime = computeAuditHash({ userID: 'U1', action: 'CREATE', dateTime: new Date('2026-02-01T00:00:00.000Z') });
    const withTimestamp = computeAuditHash({ userID: 'U1', action: 'CREATE', timestamp: '2026-02-02T00:00:00.000Z' });
    const withCreatedAt = computeAuditHash({ userID: 'U1', action: 'CREATE', createdAt: '2026-02-03T00:00:00.000Z' });
    expect(withDateTime).not.toBe(withTimestamp);
    expect(withTimestamp).not.toBe(withCreatedAt);
  });

  it('uses an explicit timestampISO field directly, bypassing date derivation', () => {
    const withExplicit = computeAuditHash({ userID: 'U1', action: 'CREATE', timestampISO: '2026-03-01T00:00:00.000Z', timestamp: '2099-01-01T00:00:00.000Z' });
    const withDerivedOnly = computeAuditHash({ userID: 'U1', action: 'CREATE', timestamp: '2026-03-01T00:00:00.000Z' });
    expect(withExplicit).toBe(withDerivedOnly);
  });

  it('includes userName in the hash payload when present', () => {
    const withUserName = computeAuditHash({ userID: 'U1', action: 'CREATE', userName: 'Alice' });
    const withoutUserName = computeAuditHash({ userID: 'U1', action: 'CREATE' });
    expect(withUserName).not.toBe(withoutUserName);
  });

  it('treats an unparseable date value as null timestampISO instead of throwing', () => {
    const withBadDate = computeAuditHash({ userID: 'U1', action: 'CREATE', timestamp: 'not-a-real-date' });
    const withNoTimestamp = computeAuditHash({ userID: 'U1', action: 'CREATE' });
    expect(withBadDate).toBe(withNoTimestamp);
  });
});

describe('integrityCheckService.buildMerkleForDate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when db is falsy', async () => {
    await expect(integrityCheckService.buildMerkleForDate('2026-01-01', null))
      .rejects.toThrow('Banco de dados não disponível');
  });

  it('throws when date is falsy', async () => {
    const db = makeDb();
    await expect(integrityCheckService.buildMerkleForDate(null, db))
      .rejects.toThrow('Data é obrigatória');
  });

  it('throws on an invalid date string', async () => {
    const db = makeDb();
    await expect(integrityCheckService.buildMerkleForDate('not-a-date', db))
      .rejects.toThrow('Formato de data inválido. Esperado YYYY-MM-DD');
  });

  it('queries logs collection with sort and computes missing auditHash, returning merkle result shape', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [
      { _id: '1', action: 'CREATE', entity: 'Sample', auditHash: 'existinghash' },
      { _id: '2', action: 'UPDATE', entity: 'Sample' } // no auditHash -> should be computed
    ];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-01', db);

    expect(db.collection).toHaveBeenCalledWith('logs');
    expect(db.sort).toHaveBeenCalledWith({ timestamp: 1, dateTime: 1, _id: 1 });

    expect(result.date).toBe('2026-01-01');
    expect(result.logsLeafCount).toBe(2);
    expect(result.biomarkersLeafCount).toBe(0);
    expect(result.mqttLeafCount).toBe(0);
    expect(result.leaves).toHaveLength(2);
    expect(result.leaves[0]).toBe('existinghash');
    expect(result.leaves[1]).toBe(computeAuditHash(docs[1]));
    expect(result.docs).toBe(docs);
    expect(typeof result.root).toBe('string');
    expect(typeof result.getProofForHash).toBe('function');
    // root should equal sha256 of the two leaves concatenated (2-leaf tree)
    const crypto = require2('crypto');
    const expectedRoot = crypto.createHash('sha256').update(result.leaves[0] + result.leaves[1]).digest('hex');
    expect(result.root).toBe(expectedRoot);
  });

  it('merges biomarker and mqtt hashes into leaves and counts', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([
      { integrityHash: 'bio1' },
      { integrityHash: 'bio2' },
      { integrityHash: '' }, // filtered out (empty string)
      { notAHash: true } // filtered out (missing integrityHash)
    ]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue(['mqtt1']);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [{ _id: '1', action: 'CREATE', auditHash: 'loghash1' }];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-02', db);

    expect(result.biomarkersLeafCount).toBe(2);
    expect(result.mqttLeafCount).toBe(1);
    expect(result.leaves).toEqual(['loghash1', 'bio1', 'bio2', 'mqtt1']);
  });

  it('calls bulkWrite with updateOne ops for docs missing auditHash when persistMissing is true', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [
      { _id: 'a1', action: 'CREATE' }, // missing auditHash
      { _id: 'a2', action: 'DELETE', auditHash: 'already-has-hash' }
    ];
    const db = makeDb({ docs });

    await integrityCheckService.buildMerkleForDate('2026-01-03', db, { persistMissing: true });

    expect(db.bulkWrite).toHaveBeenCalledTimes(1);
    const [updates, options] = db.bulkWrite.mock.calls[0];
    expect(updates).toHaveLength(1);
    expect(updates[0].updateOne.filter).toEqual({ _id: 'a1' });
    expect(updates[0].updateOne.update.$set.auditHash).toBe(computeAuditHash(docs[0]));
    expect(options).toEqual({ ordered: false });
  });

  it('does not call bulkWrite when persistMissing is true but no docs are missing auditHash', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [{ _id: 'a1', action: 'CREATE', auditHash: 'h1' }];
    const db = makeDb({ docs });

    await integrityCheckService.buildMerkleForDate('2026-01-04', db, { persistMissing: true });

    expect(db.bulkWrite).not.toHaveBeenCalled();
  });

  it('swallows a bulkWrite failure instead of throwing', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [{ _id: 'a1', action: 'CREATE' }];
    const bulkWriteImpl = vi.fn().mockRejectedValue(new Error('bulkWrite exploded'));
    const db = makeDb({ docs, bulkWriteImpl });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-05', db, { persistMissing: true });

    expect(result.root).toBeTruthy();
    expect(db.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it('degrades biomarker leaves to empty array when getBiomarkerHashesForDate rejects', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockRejectedValue(new Error('biomarker db down'));
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue(['mqtt1']);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [{ _id: '1', action: 'CREATE', auditHash: 'h1' }];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-06', db);

    expect(result.biomarkersLeafCount).toBe(0);
    expect(result.biomarkerDocs).toEqual([]);
    expect(result.mqttLeafCount).toBe(1);
    expect(result.leaves).toEqual(['h1', 'mqtt1']);
  });

  it('degrades mqtt leaves to empty array when getHashesForDate rejects', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([{ integrityHash: 'bio1' }]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockRejectedValue(new Error('mqtt db down'));
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [{ _id: '1', action: 'CREATE', auditHash: 'h1' }];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-07', db);

    expect(result.mqttLeafCount).toBe(0);
    expect(result.biomarkersLeafCount).toBe(1);
    expect(result.leaves).toEqual(['h1', 'bio1']);
  });

  it('calls logService.createLog with MERKLE_HASH_GENERATED audit payload', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    const createLogSpy = vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [{ _id: '1', action: 'CREATE', auditHash: 'h1' }];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-08', db, { persistMissing: true });

    expect(createLogSpy).toHaveBeenCalledTimes(1);
    const [calledDb, payload] = createLogSpy.mock.calls[0];
    expect(calledDb).toBe(db);
    expect(payload.action).toBe('MERKLE_HASH_GENERATED');
    expect(payload.resourceId).toBe('2026-01-08');
    expect(payload.payload.merkleRoot).toBe(result.root);
    expect(payload.payload.logsLeafCount).toBe(1);
    expect(payload.payload.persistMissing).toBe(true);
  });

  it('swallows a logService.createLog failure instead of throwing, and still returns the merkle result', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    vi.spyOn(logService, 'createLog').mockRejectedValue(new Error('log write failed'));

    const docs = [{ _id: '1', action: 'CREATE', auditHash: 'h1' }];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-09', db);

    expect(result.root).toBeTruthy();
    expect(result.leaves).toEqual(['h1']);
  });

  it('exposes a working getProofForHash that returns null for an unknown hash', async () => {
    vi.spyOn(biomarkerIntegrityService, 'getBiomarkerHashesForDate').mockResolvedValue([]);
    vi.spyOn(mqttIngestionAuditService, 'getHashesForDate').mockResolvedValue([]);
    vi.spyOn(logService, 'createLog').mockResolvedValue({});

    const docs = [
      { _id: '1', action: 'CREATE', auditHash: 'leafA' },
      { _id: '2', action: 'DELETE', auditHash: 'leafB' }
    ];
    const db = makeDb({ docs });

    const result = await integrityCheckService.buildMerkleForDate('2026-01-10', db);

    expect(result.getProofForHash('leafA')).not.toBeNull();
    expect(result.getProofForHash('nonexistent-hash')).toBeNull();
  });
});
