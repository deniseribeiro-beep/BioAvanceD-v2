import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same pattern as tests/unit/auditRoot.service.test.js: vi.mock() does not
// reliably intercept require() call sites in this repo's CJS setup, so we
// require the real singleton modules once, spy on their methods BEFORE
// requiring audit-v2.service.js (so its own top-level requires capture the
// already-patched functions), and reset call state between tests instead of
// resetting the module registry.
const mongo = require('../../src/database/mongo');
const signingProvider = require('../../src/services/audit-signing.provider');
const tsa = require('../../src/services/audit-tsa.service');
const witness = require('../../src/services/audit-witness.service');

vi.spyOn(mongo, 'connectDB').mockResolvedValue({ __fakeDb: true });
vi.spyOn(mongo, 'closeConnection').mockResolvedValue(undefined);
vi.spyOn(signingProvider, 'getKeyId').mockReturnValue('key-1');
vi.spyOn(signingProvider, 'sign').mockResolvedValue({
  signature: 'sig-base64',
  signatureAlgorithm: 'Ed25519',
  keyId: 'key-1',
  publicKeyFingerprint: 'fp-1',
});
vi.spyOn(tsa, 'requestTimestamp').mockResolvedValue({
  status: 'TIMESTAMPED',
  token: 'token-base64',
  tokenDerHex: 'deadbeef',
  messageImprint: 'imprint',
});
vi.spyOn(witness, 'publish').mockResolvedValue({ status: 'UNAVAILABLE', reason: 'not_attempted' });

const auditV2Service = require('../../src/services/audit-v2.service');
const { createFakeDb } = require('./foundation/helpers/fake-db');

function makeCollection(overrides = {}) {
  return {
    createIndex: vi.fn().mockResolvedValue('ok'),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    }),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    ...overrides,
  };
}

function makeDb(collectionsByName = {}) {
  const collections = {};
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) collections[name] = collectionsByName[name] || makeCollection();
      return collections[name];
    }),
  };
}

describe('audit-v2.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mongo.connectDB.mockResolvedValue({ __fakeDb: true });
    mongo.closeConnection.mockResolvedValue(undefined);
    signingProvider.getKeyId.mockReturnValue('key-1');
    signingProvider.sign.mockResolvedValue({
      signature: 'sig-base64',
      signatureAlgorithm: 'Ed25519',
      keyId: 'key-1',
      publicKeyFingerprint: 'fp-1',
    });
    tsa.requestTimestamp.mockResolvedValue({
      status: 'TIMESTAMPED',
      token: 'token-base64',
      tokenDerHex: 'deadbeef',
      messageImprint: 'imprint',
    });
    witness.publish.mockResolvedValue({ status: 'UNAVAILABLE', reason: 'not_attempted' });
  });

  describe('createEvent', () => {
    it('creates the first event for a log with no previousEventHash and closes the connection when using the default db', async () => {
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const result = await auditV2Service.createEvent({
        logId: 'log-1',
        occurredAt: '2026-01-01T00:00:00.000Z',
        recordedAt: '2026-01-01T00:00:00.000Z',
        actorPseudonym: 'user-1',
        action: 'CREATE',
        entityType: 'Patient',
        entityId: 'p-1',
        result: 'success',
        source: 'backend',
        correlationId: 'corr-1',
      });

      expect(result.previousEventHash).toBeNull();
      expect(result.sequenceNumber).toBe(1);
      expect(result.treeSize).toBe(1);
      expect(db.collection('audit_events').insertOne).toHaveBeenCalledTimes(1);
      expect(mongo.closeConnection).toHaveBeenCalledTimes(1);
    });

    it('chains a subsequent event off the previous event hash and does not close the connection when given an externalDb', async () => {
      const previousLeaf = {
        canonicalLeaf: { eventId: 'prev', logId: 'log-1', sequenceNumber: 1 },
        eventHash: 'prev-hash',
        sequenceNumber: 1,
      };
      const eventsCollection = makeCollection({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockResolvedValue([previousLeaf]),
        }),
      });
      const db = makeDb({ audit_events: eventsCollection });

      const result = await auditV2Service.createEvent({
        logId: 'log-1',
        occurredAt: '2026-01-02T00:00:00.000Z',
        recordedAt: '2026-01-02T00:00:00.000Z',
        actorPseudonym: 'user-1',
        action: 'UPDATE',
        entityType: 'Patient',
        entityId: 'p-1',
        result: 'success',
        source: 'backend',
        correlationId: 'corr-2',
      }, db);

      expect(result.previousEventHash).toBe('prev-hash');
      expect(result.sequenceNumber).toBe(2);
      expect(result.treeSize).toBe(2);
      expect(mongo.connectDB).not.toHaveBeenCalled();
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });

    // #841: the stub above returns its one event whatever sort it is handed,
    // so it cannot tell "the latest event" from "the first one stored". This
    // store sorts, and holds the log's events out of order beside another
    // log's higher sequence.
    it('chains off the log\'s highest sequenceNumber, not the first event stored', async () => {
      const db = createFakeDb();
      const events = db.collection('audit_events');
      const stored = (logId, sequenceNumber) => ({
        logId,
        sequenceNumber,
        eventHash: `${logId}-hash-${sequenceNumber}`,
        canonicalLeaf: { eventId: `${logId}-${sequenceNumber}`, logId, sequenceNumber },
      });
      for (const doc of [stored('log-1', 2), stored('log-1', 3), stored('log-1', 1), stored('log-2', 9)]) {
        await events.insertOne(doc);
      }

      const result = await auditV2Service.createEvent({
        logId: 'log-1',
        occurredAt: '2026-01-03T00:00:00.000Z',
        recordedAt: '2026-01-03T00:00:00.000Z',
        actorPseudonym: 'user-1',
        action: 'UPDATE',
        entityType: 'Patient',
        entityId: 'p-1',
        result: 'success',
        source: 'backend',
        correlationId: 'corr-3',
      }, db);

      expect(result.sequenceNumber).toBe(4);
      expect(result.previousEventHash).toBe('log-1-hash-3');
    });
  });

  describe('ingestLogRecord', () => {
    it('maps a fully-populated log record onto createEvent fields', async () => {
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const logRecord = {
        _id: 'rec-1',
        timestampISO: '2026-01-03T00:00:00.000Z',
        createdAt: '2026-01-03T00:00:01.000Z',
        userName: 'alice',
        action: 'DELETE',
        entity: 'Sample',
        entityID: 'sample-1',
        result: 'failure',
        module: 'lims',
        correlationId: 'corr-3',
        message: 'deleted sample',
        severity: 'high',
        resourceType: 'Sample',
        resourceId: 'sample-1',
      };

      const result = await auditV2Service.ingestLogRecord(logRecord);

      expect(result.logId).toBe('rec-1');
      expect(result.actorPseudonym).toBe('alice');
      expect(result.action).toBe('DELETE');
      expect(result.entityType).toBe('Sample');
      expect(result.result).toBe('failure');
      expect(result.source).toBe('lims');
      expect(mongo.closeConnection).toHaveBeenCalledTimes(1);
    });

    it('falls back to defaults when the log record is missing optional fields', async () => {
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const result = await auditV2Service.ingestLogRecord({});

      expect(result.actorPseudonym).toBe('system');
      expect(result.action).toBe('UNKNOWN');
      expect(result.entityType).toBe('Log');
      expect(result.entityId).toBeNull();
      expect(result.result).toBe('success');
      expect(result.source).toBe('backend');
      expect(result.correlationId).toBeNull();
      expect(typeof result.logId).toBe('string');
    });

    it('does not close the connection when given an externalDb', async () => {
      const db = makeDb();

      await auditV2Service.ingestLogRecord({}, db);

      expect(mongo.connectDB).not.toHaveBeenCalled();
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });

    it('canonicalizes a Date instance for createdAt instead of throwing (#369 — LogModel.create() always sets createdAt to `new Date()`, not a string)', async () => {
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const createdAt = new Date('2026-01-04T00:00:00.000Z');
      const logRecord = {
        _id: 'rec-2',
        timestampISO: '2026-01-04T00:00:00.000Z',
        createdAt,
        action: 'CREATE',
        entity: 'Patient',
      };

      const result = await auditV2Service.ingestLogRecord(logRecord);

      expect(result.recordedAt).toBe(createdAt.toISOString());
    });
  });

  describe('createTreeHead', () => {
    const baseArgs = {
      logId: 'log-1',
      treeSize: 5,
      rootHash: 'root-hash',
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-01-02T00:00:00.000Z',
    };

    it('marks anchorStatus TIMESTAMPED and persists the token when the TSA request succeeds and witness is unavailable', async () => {
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const doc = await auditV2Service.createTreeHead(baseArgs);

      expect(doc.anchorStatus).toBe('TIMESTAMPED');
      expect(doc.timestampToken.token).toBe('token-base64');
      expect(db.collection('audit_tree_heads').updateOne).toHaveBeenCalledTimes(1);
      expect(db.collection('audit_timestamp_tokens').updateOne).toHaveBeenCalledTimes(1);
      expect(db.collection('audit_witnesses').updateOne).not.toHaveBeenCalled();
    });

    it('falls back to PENDING_TIMESTAMP and skips the token write when the TSA request throws', async () => {
      tsa.requestTimestamp.mockRejectedValueOnce(new Error('tsa unreachable'));
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const doc = await auditV2Service.createTreeHead(baseArgs);

      expect(doc.anchorStatus).toBe('PENDING_TIMESTAMP');
      expect(doc.timestampToken.status).toBe('PENDING_TIMESTAMP');
      expect(doc.timestampToken.error).toBe('tsa unreachable');
      expect(doc.timestampToken.token).toBeNull();
      expect(db.collection('audit_timestamp_tokens').updateOne).not.toHaveBeenCalled();
    });

    it('marks anchorStatus ANCHORED and persists the witness receipt when witness.publish succeeds with a receipt', async () => {
      witness.publish.mockResolvedValueOnce({ status: 'WITNESSED', receipt: 'receipt-1', witnessId: 'w-1' });
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const doc = await auditV2Service.createTreeHead(baseArgs);

      expect(doc.anchorStatus).toBe('ANCHORED');
      expect(doc.witness.receipt).toBe('receipt-1');
      expect(db.collection('audit_witnesses').updateOne).toHaveBeenCalledTimes(1);
    });

    it('falls back to a null witnessId when the witness receipt omits one', async () => {
      witness.publish.mockResolvedValueOnce({ status: 'WITNESSED', receipt: 'receipt-2' });
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      await auditV2Service.createTreeHead(baseArgs);

      const [, setDoc] = db.collection('audit_witnesses').updateOne.mock.calls[0];
      expect(setDoc.$setOnInsert.witnessId).toBeNull();
    });

    it('falls back to tokenStatus anchorStatus and records the failure reason when witness.publish throws', async () => {
      witness.publish.mockRejectedValueOnce(new Error('witness down'));
      const db = makeDb();
      mongo.connectDB.mockResolvedValue(db);

      const doc = await auditV2Service.createTreeHead(baseArgs);

      expect(doc.anchorStatus).toBe('TIMESTAMPED');
      expect(doc.witness.status).toBe('FAILED');
      expect(doc.witness.reason).toBe('witness down');
      expect(db.collection('audit_witnesses').updateOne).not.toHaveBeenCalled();
    });

    it('closes the connection only when no externalDb is supplied', async () => {
      const db = makeDb();

      await auditV2Service.createTreeHead(baseArgs, db);

      expect(mongo.connectDB).not.toHaveBeenCalled();
      expect(mongo.closeConnection).not.toHaveBeenCalled();
    });
  });
});
