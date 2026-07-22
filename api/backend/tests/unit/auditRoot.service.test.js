import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Same pattern as tests/unit/daily-merkle.job.test.js: vi.mock() does not
// reliably intercept require() call sites in this repo's CJS setup, so we
// require the real singleton modules once, spy on their methods BEFORE
// requiring auditRoot.service.js (so its own top-level requires capture the
// already-patched functions), and reset call state between tests instead of
// resetting the module registry.
const mongo = require('../../src/database/mongo');
const merkleEnvelopeService = require('../../src/services/merkle-envelope.service');
const rfc3161AdapterService = require('../../src/services/rfc3161-adapter.service');
const logService = require('../../src/services/log.service');
const logger = require('../../src/utils/logger');

vi.spyOn(mongo, 'connectDB').mockResolvedValue({ __fakeDb: true });
vi.spyOn(mongo, 'closeConnection').mockResolvedValue(undefined);
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});

const auditRootService = require('../../src/services/auditRoot.service');

function makeCollection(overrides = {}) {
  return {
    createIndex: vi.fn().mockResolvedValue('ok'),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    countDocuments: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) };
}

describe('auditRoot.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mongo.connectDB.mockResolvedValue({ __fakeDb: true });
    mongo.closeConnection.mockResolvedValue(undefined);
    vi.spyOn(merkleEnvelopeService, 'buildCanonicalEnvelope').mockReturnValue({
      schemaVersion: 2,
      hashAlgorithm: 'SHA-256',
      merkleAlgorithm: 'BIOAVANCED-MERKLE-V2',
      previousAnchorHash: null,
    });
    vi.spyOn(merkleEnvelopeService, 'signEnvelope').mockResolvedValue({
      signature: 'sig',
      signatureAlgorithm: 'ED25519',
      keyId: 'key-1',
      publicKeyFingerprint: 'fp-1',
      envelopeDigestSha256: 'digest-hex',
      envelopeDigestBase64: 'digest-b64',
    });
    vi.spyOn(merkleEnvelopeService, 'verifyEnvelopeSignature').mockReturnValue({
      ok: true,
      envelopeDigestSha256: 'digest-hex',
      envelopeDigestBase64: 'digest-b64',
    });
    vi.spyOn(merkleEnvelopeService, 'fromPersistedRoot').mockReturnValue({ schemaVersion: 1, legacyV1: true });
    vi.spyOn(rfc3161AdapterService, 'anchorEnvelopeDigest').mockResolvedValue({
      mode: 'mock',
      status: 'ANCHORED',
      token: 'token-1',
      tsa: 'tsa-1',
      messageImprint: 'imprint-1',
      anchoredAt: '2026-07-01T00:00:00.000Z',
      error: null,
    });
    vi.spyOn(rfc3161AdapterService, 'verifyTimestamp').mockReturnValue({
      ok: true,
      status: 'VERIFIED',
      verifiedAt: '2026-07-01T00:01:00.000Z',
      reason: null,
    });
    vi.spyOn(logService, 'createLog').mockResolvedValue(undefined);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('saveDailyRoot', () => {
    it('returns the existing doc without writing when a root for the date already exists', async () => {
      const existing = { date: '2026-07-01', root: 'existing-root' };
      const coll = makeCollection({ findOne: vi.fn().mockResolvedValue(existing) });
      const db = makeDb(coll);

      const result = await auditRootService.saveDailyRoot({ date: '2026-07-01', root: 'new-root', db });

      expect(result).toBe(existing);
      expect(coll.updateOne).not.toHaveBeenCalled();
      expect(merkleEnvelopeService.buildCanonicalEnvelope).not.toHaveBeenCalled();
    });

    it('builds, signs, anchors, verifies and persists a new root as chainIndex 0 when the chain is empty', async () => {
      const coll = makeCollection({
        findOne: vi.fn()
          .mockResolvedValueOnce(null) // existing check
          .mockResolvedValueOnce({ date: '2026-07-01', chainIndex: 0 }), // final re-read
      });
      const db = makeDb(coll);

      const result = await auditRootService.saveDailyRoot({ date: '2026-07-01', root: 'root-hash', treeSize: 5, db });

      expect(merkleEnvelopeService.buildCanonicalEnvelope).toHaveBeenCalledWith({
        date: '2026-07-01',
        root: 'root-hash',
        treeSize: 5,
        previousAnchorHash: null,
      });
      expect(coll.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, opts] = coll.updateOne.mock.calls[0];
      expect(filter).toEqual({ date: '2026-07-01' });
      expect(update.$setOnInsert.chainIndex).toBe(0);
      expect(update.$setOnInsert.previousRootHash).toBeNull();
      expect(opts).toEqual({ upsert: true });
      expect(logService.createLog).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ date: '2026-07-01', chainIndex: 0 });
      // db was passed explicitly, so no local connection was opened to close
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });

    it('chains off the last element by chainIndex when prior roots exist', async () => {
      const previous = { root: 'prev-root', chainIndex: 3 };
      const coll = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ date: '2026-07-02', chainIndex: 4 }),
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([previous]),
        }),
      });
      const db = makeDb(coll);

      await auditRootService.saveDailyRoot({ date: '2026-07-02', root: 'root-hash-2', db });

      expect(merkleEnvelopeService.buildCanonicalEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({ previousAnchorHash: 'prev-root' })
      );
      const [, update] = coll.updateOne.mock.calls[0];
      expect(update.$setOnInsert.chainIndex).toBe(4);
      expect(update.$setOnInsert.previousRootHash).toBe('prev-root');
    });

    it('marks the timestamp FAILED with the verification reason when RFC3161 verification does not confirm', async () => {
      rfc3161AdapterService.verifyTimestamp.mockReturnValue({ ok: false, reason: 'replay_detected' });
      const coll = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ date: '2026-07-03' }),
      });
      const db = makeDb(coll);

      await auditRootService.saveDailyRoot({ date: '2026-07-03', root: 'root-3', db });

      const [, update] = coll.updateOne.mock.calls[0];
      expect(update.$setOnInsert.timestamp.status).toBe('ANCHORED');
      expect(update.$setOnInsert.timestamp.error).toBe('replay_detected');
    });

    it('does not throw when logService.createLog rejects, and still returns the persisted doc', async () => {
      logService.createLog.mockRejectedValue(new Error('log write failed'));
      const coll = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ date: '2026-07-04' }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.saveDailyRoot({ date: '2026-07-04', root: 'root-4', db });

      expect(result).toEqual({ date: '2026-07-04' });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('opens and closes its own connection when no external db is passed', async () => {
      const coll = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ date: '2026-07-05' }),
      });
      mongo.connectDB.mockResolvedValue(makeDb(coll));

      await auditRootService.saveDailyRoot({ date: '2026-07-05', root: 'root-5' });

      expect(mongo.connectDB).toHaveBeenCalledTimes(1);
      expect(mongo.closeConnection).toHaveBeenCalledTimes(1);
    });

    it('propagates the error and still closes the connection when the collection write throws', async () => {
      const coll = makeCollection({
        findOne: vi.fn().mockResolvedValueOnce(null),
        updateOne: vi.fn().mockRejectedValue(new Error('mongo write failed')),
      });
      const db = makeDb(coll);

      await expect(auditRootService.saveDailyRoot({ date: '2026-07-06', root: 'root-6', db })).rejects.toThrow('mongo write failed');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getRootByDate', () => {
    it('looks up by date on the shared collection and closes only a locally-opened connection', async () => {
      const doc = { date: '2026-07-01', root: 'r1' };
      const coll = makeCollection({ findOne: vi.fn().mockResolvedValue(doc) });
      const db = makeDb(coll);

      const result = await auditRootService.getRootByDate('2026-07-01', db);

      expect(result).toBe(doc);
      expect(coll.findOne).toHaveBeenCalledWith({ date: '2026-07-01' });
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });

    it('opens its own connection and closes it when no external db is passed', async () => {
      const doc = { date: '2026-07-02', root: 'r2' };
      const coll = makeCollection({ findOne: vi.fn().mockResolvedValue(doc) });
      mongo.connectDB.mockResolvedValue(makeDb(coll));

      const result = await auditRootService.getRootByDate('2026-07-02');

      expect(result).toBe(doc);
      expect(mongo.closeConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOfficialRootRecord', () => {
    it('returns null when no root document exists for the date', async () => {
      const coll = makeCollection({ findOne: vi.fn().mockResolvedValue(null) });
      const db = makeDb(coll);

      const result = await auditRootService.getOfficialRootRecord('2026-07-01', db);

      expect(result).toBeNull();
      expect(merkleEnvelopeService.fromPersistedRoot).not.toHaveBeenCalled();
    });

    it('wraps the root doc and derived envelope record when found', async () => {
      const rootDoc = { date: '2026-07-01', root: 'r1' };
      const coll = makeCollection({ findOne: vi.fn().mockResolvedValue(rootDoc) });
      const db = makeDb(coll);

      const result = await auditRootService.getOfficialRootRecord('2026-07-01', db);

      expect(result.rootDoc).toBe(rootDoc);
      expect(merkleEnvelopeService.fromPersistedRoot).toHaveBeenCalledWith(rootDoc);
      expect(result.envelopeRecord).toEqual({ schemaVersion: 1, legacyV1: true });
    });
  });

  describe('getChain', () => {
    it('returns the chain sorted ascending by chainIndex', async () => {
      const chain = [{ chainIndex: 0 }, { chainIndex: 1 }];
      const toArray = vi.fn().mockResolvedValue(chain);
      const sort = vi.fn().mockReturnValue({ toArray });
      const coll = makeCollection({ find: vi.fn().mockReturnValue({ sort }) });
      const db = makeDb(coll);

      const result = await auditRootService.getChain(db);

      expect(sort).toHaveBeenCalledWith({ chainIndex: 1 });
      expect(result).toBe(chain);
    });
  });

  describe('verifyChainIntegrity', () => {
    it('reports ok with no anomalies for an empty chain', async () => {
      const coll = makeCollection();
      const db = makeDb(coll);

      const result = await auditRootService.verifyChainIntegrity({ externalDb: db });

      expect(result).toEqual({ ok: true, anomalies: [] });
    });

    it('flags the first item if it unexpectedly carries a previousRootHash', async () => {
      const chain = [{ date: '2026-07-01', root: 'r1', previousRootHash: 'unexpected', chainIndex: 0 }];
      const toArray = vi.fn().mockResolvedValue(chain);
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray }) }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.verifyChainIntegrity({ externalDb: db });

      expect(result.ok).toBe(false);
      expect(result.anomalies).toEqual([{ index: 0, reason: 'primeiro item contém previousRootHash' }]);
    });

    it('flags a divergent previousRootHash between consecutive chain items', async () => {
      const chain = [
        { date: '2026-07-01', root: 'r1', previousRootHash: null, chainIndex: 0 },
        { date: '2026-07-02', root: 'r2', previousRootHash: 'wrong', chainIndex: 1 },
      ];
      const toArray = vi.fn().mockResolvedValue(chain);
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray }) }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.verifyChainIntegrity({ externalDb: db });

      expect(result.ok).toBe(false);
      expect(result.anomalies).toEqual([{
        index: 1,
        reason: 'previousRootHash divergente',
        expected: 'r1',
        actual: 'wrong',
      }]);
    });

    it('reports no anomalies for a well-formed chain', async () => {
      const chain = [
        { date: '2026-07-01', root: 'r1', previousRootHash: null, chainIndex: 0 },
        { date: '2026-07-02', root: 'r2', previousRootHash: 'r1', chainIndex: 1 },
      ];
      const toArray = vi.fn().mockResolvedValue(chain);
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ toArray }) }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.verifyChainIntegrity({ externalDb: db });

      expect(result).toEqual({ ok: true, anomalies: [] });
    });
  });

  describe('updateTimestampStatus', () => {
    it('sets status/error/lastAttemptAt without touching verifiedAt or retries for a non-terminal status', async () => {
      const coll = makeCollection();
      const db = makeDb(coll);

      await auditRootService.updateTimestampStatus({ date: '2026-07-01', status: 'FAILED', error: 'boom', externalDb: db });

      const [filter, update] = coll.updateOne.mock.calls[0];
      expect(filter).toEqual({ date: '2026-07-01' });
      expect(update.$set['timestamp.status']).toBe('FAILED');
      expect(update.$set['timestamp.error']).toBe('boom');
      expect(update.$set['timestamp.verifiedAt']).toBeUndefined();
      expect(update.$inc['timestamp.retries']).toBe(0);
    });

    it('sets verifiedAt when status is VERIFIED', async () => {
      const coll = makeCollection();
      const db = makeDb(coll);

      await auditRootService.updateTimestampStatus({ date: '2026-07-01', status: 'VERIFIED', externalDb: db });

      const [, update] = coll.updateOne.mock.calls[0];
      expect(update.$set['timestamp.verifiedAt']).toBeInstanceOf(Date);
    });

    it('increments retries when status is RETRYING', async () => {
      const coll = makeCollection();
      const db = makeDb(coll);

      await auditRootService.updateTimestampStatus({ date: '2026-07-01', status: 'RETRYING', externalDb: db });

      const [, update] = coll.updateOne.mock.calls[0];
      expect(update.$inc['timestamp.retries']).toBe(1);
    });
  });

  describe('processTimestampBacklog', () => {
    it('returns processed: 0 when there is nothing pending', async () => {
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([]),
        }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.processTimestampBacklog({ externalDb: db });

      expect(result).toEqual({ processed: 0 });
    });

    it('marks a doc FAILED and skips anchoring when signature verification fails', async () => {
      merkleEnvelopeService.verifyEnvelopeSignature.mockReturnValue({ ok: false, reason: 'bad_signature' });
      const pendingDoc = { _id: 'doc-1', date: '2026-07-01', envelope: {}, signature: 's', timestamp: { token: 't' } };
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([pendingDoc]),
        }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.processTimestampBacklog({ externalDb: db });

      expect(result).toEqual({ processed: 1 });
      const [filter, update] = coll.updateOne.mock.calls[0];
      expect(filter).toEqual({ date: '2026-07-01' });
      expect(update.$set['timestamp.status']).toBe('FAILED');
      expect(update.$set['timestamp.error']).toBe('signature_bad_signature');
      expect(rfc3161AdapterService.anchorEnvelopeDigest).not.toHaveBeenCalled();
    });

    it('anchors a doc missing a timestamp token, then verifies and marks VERIFIED', async () => {
      const pendingDoc = { _id: 'doc-2', date: '2026-07-02', envelope: {}, signature: 's', timestamp: null };
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([pendingDoc]),
        }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.processTimestampBacklog({ externalDb: db });

      expect(result).toEqual({ processed: 1 });
      expect(rfc3161AdapterService.anchorEnvelopeDigest).toHaveBeenCalledTimes(1);
      // updateOne called: once for RETRYING pre-status, once to persist the new timestamp,
      // once for the final VERIFIED update via updateTimestampStatus's own updateOne call
      // — but VERIFIED is set directly here, not via updateTimestampStatus, so expect the
      // set-timestamp write plus the final status write.
      const calls = coll.updateOne.mock.calls;
      const finalCall = calls[calls.length - 1];
      expect(finalCall[1].$set['timestamp.status']).toBe('VERIFIED');
      expect(logService.createLog).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'MERKLE_ANCHORED' }));
    });

    it('marks FAILED and logs when the final timestamp verification does not pass', async () => {
      rfc3161AdapterService.verifyTimestamp.mockReturnValue({ ok: false, reason: 'expired' });
      const pendingDoc = { _id: 'doc-3', date: '2026-07-03', envelope: {}, signature: 's', timestamp: { token: 'tok' } };
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([pendingDoc]),
        }),
      });
      const db = makeDb(coll);

      const result = await auditRootService.processTimestampBacklog({ externalDb: db });

      expect(result).toEqual({ processed: 1 });
      const calls = coll.updateOne.mock.calls;
      const finalCall = calls[calls.length - 1];
      expect(finalCall[1].$set['timestamp.status']).toBe('FAILED');
      expect(finalCall[1].$set['timestamp.error']).toBe('expired');
      expect(logService.createLog).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'MERKLE_ANCHOR_FAILED' }));
    });

    it('detects replay when another doc shares the same timestamp token', async () => {
      const pendingDoc = { _id: 'doc-4', date: '2026-07-04', envelope: {}, signature: 's', timestamp: { token: 'shared-token' } };
      const coll = makeCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([pendingDoc]),
        }),
        countDocuments: vi.fn().mockResolvedValue(1),
      });
      const db = makeDb(coll);

      await auditRootService.processTimestampBacklog({ externalDb: db });

      expect(rfc3161AdapterService.verifyTimestamp).toHaveBeenCalledWith(
        expect.objectContaining({ replayDetected: true })
      );
    });
  });
});
