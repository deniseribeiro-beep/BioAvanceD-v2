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

      // #1307: every record joins the one chain, never a chain of its own.
      expect(result.logId).toBe('audit-events');
      // A raw name is pseudonymized, never copied (RF012 AC1).
      expect(result.actorPseudonym).toMatch(/^USR-[0-9A-F]{8}$/);
      expect(result.actorPseudonym).not.toBe('alice');
      expect(result.purpose).toBe('operations');
      expect(result.policyVersion).toBe('governance-invariants-1.0.0');
      expect(result.canonicalModelReleaseId).toMatch(/^release-/);
      expect(result.canonicalEventHash).toBe(result.eventHash);
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

      expect(result.actorPseudonym).toBe('USR-SYSTEM');
      expect(result.action).toBe('UNKNOWN');
      expect(result.entityType).toBe('Log');
      expect(result.entityId).toBeNull();
      expect(result.result).toBe('success');
      expect(result.source).toBe('backend');
      expect(result.correlationId).toBeNull();
      expect(result.logId).toBe('audit-events');
    });

    // #1307: the defect itself. Each record used to key its own chain on its
    // own _id, so every chain was one event long and previousEventHash was
    // always null.
    it('chains consecutive log records into one chain, each naming the previous event hash', async () => {
      const db = createFakeDb();
      const first = await auditV2Service.ingestLogRecord({ _id: 'rec-a', action: 'CREATE', userName: 'USR-0A1B2C3D' }, db);
      const second = await auditV2Service.ingestLogRecord({ _id: 'rec-b', action: 'UPDATE', userName: 'USR-0A1B2C3D' }, db);

      expect(first.sequenceNumber).toBe(1);
      expect(first.previousEventHash).toBeNull();
      expect(second.logId).toBe(first.logId);
      expect(second.sequenceNumber).toBe(2);
      expect(second.previousEventHash).toBe(first.eventHash);
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db))).toEqual({ valid: true, brokenAt: null, reason: null });
    });

    // #1308: RF012 AC1's correlationId comes from the serving request.
    it('takes the serving request\'s id as correlationId when the record carries none', async () => {
      const requestContext = require('../../src/utils/requestContext');
      const db = createFakeDb();
      const result = await new Promise((resolve, reject) => {
        requestContext.middleware({ headers: { 'x-request-id': 'req-corr-0001' } }, { setHeader() {} }, () => {
          auditV2Service.ingestLogRecord({ action: 'READ' }, db).then(resolve, reject);
        });
      });
      expect(result.correlationId).toBe('req-corr-0001');
    });

    it('takes purpose and policyVersion from the record or its details when it carries them', async () => {
      const db = createFakeDb();
      const result = await auditV2Service.ingestLogRecord({ action: 'RETENTION_SWEEP', details: { purpose: 'retention', policyVersion: 3 } }, db);

      expect(result.purpose).toBe('retention');
      expect(result.policyVersion).toBe('3');
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

  // #1307: RF012 AC3/AC6 -- the chain detects a rewritten, removed or
  // relinked event, and sealing leaves every event as written (AC4).
  describe('chain integrity and sealing', () => {
    async function chainOf(db, n) {
      for (let i = 1; i <= n; i += 1) {
        await auditV2Service.ingestLogRecord({ _id: `rec-${i}`, action: `ACT-${i}`, userName: 'USR-0A1B2C3D' }, db);
      }
      return db.collection('audit_events').docs;
    }

    it('reads an intact chain as valid', async () => {
      const db = createFakeDb();
      await chainOf(db, 3);
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db)).valid).toBe(true);
    });

    it('finds an event whose field was rewritten in place', async () => {
      const db = createFakeDb();
      const docs = await chainOf(db, 3);
      docs[1].action = 'FORGED';
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db))).toEqual({ valid: false, brokenAt: 2, reason: 'eventHash' });
    });

    it('finds a removed event', async () => {
      const db = createFakeDb();
      const docs = await chainOf(db, 3);
      docs.splice(1, 1);
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db))).toEqual({ valid: false, brokenAt: 2, reason: 'sequence' });
    });

    it('finds an event re-hashed onto a forged predecessor', async () => {
      const db = createFakeDb();
      const docs = await chainOf(db, 3);
      // A forger who rewrites event 2 and recomputes its own hashes still
      // breaks event 3's previousEventHash.
      const forged = { ...auditV2Service.eventFieldsOf(docs[1]), action: 'FORGED' };
      const { digestCanonical } = require('../../src/services/audit-canonicalization.service');
      const { hash } = digestCanonical(forged);
      Object.assign(docs[1], forged, { eventHash: hash, canonicalLeaf: { ...forged, eventHash: hash } });
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db))).toEqual({ valid: false, brokenAt: 3, reason: 'previousEventHash' });
    });

    it('reads archived events as part of the chain, and continues the chain after them', async () => {
      const db = createFakeDb();
      const docs = await chainOf(db, 2);
      const archived = docs.splice(0, 2);
      for (const doc of archived) await db.collection('audit_events_archive').insertOne({ ...doc, archivedAt: new Date() });

      const next = await auditV2Service.ingestLogRecord({ action: 'AFTER' }, db);

      expect(next.sequenceNumber).toBe(3);
      expect(next.previousEventHash).toBe(archived[1].eventHash);
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db)).valid).toBe(true);
    });

    it('re-reads the chain and appends after a concurrent writer took the sequence number', async () => {
      const db = createFakeDb();
      await chainOf(db, 1);
      const events = db.collection('audit_events');
      const insertOne = events.insertOne.bind(events);
      let raced = false;
      events.insertOne = async (doc) => {
        if (!raced) {
          raced = true;
          // Another writer appends sequence 2 first; this insert is refused.
          await auditV2Service.ingestLogRecord({ action: 'RIVAL' }, db);
          const error = new Error('E11000 duplicate key');
          error.code = 11000;
          throw error;
        }
        return insertOne(doc);
      };

      const result = await auditV2Service.ingestLogRecord({ action: 'MINE' }, db);

      expect(result.sequenceNumber).toBe(3);
      expect(auditV2Service.verifyChain(await auditV2Service.loadChain(db)).valid).toBe(true);
    });

    it('seals the chain at its current size over every leaf, and links the next head to it', async () => {
      const tree = require('../../src/services/audit-tree.service');
      const db = createFakeDb();
      await chainOf(db, 3);

      const head = await auditV2Service.sealChain(db);
      const leaves = await auditV2Service.loadChain(db);

      expect(head.logId).toBe('audit-events');
      expect(head.treeSize).toBe(3);
      expect(head.rootHash).toBe(tree.buildTree(leaves.map((item) => item.canonicalLeaf)).rootHash);
      expect(head.previousTreeHeadHash).toBeNull();

      await chainOf(db, 1);
      const next = await auditV2Service.sealChain(db);
      expect(next.treeSize).toBe(4);
      expect(next.previousTreeHeadHash).toBe(head.rootHash);
    });

    it('seals nothing for an empty chain', async () => {
      expect(await auditV2Service.sealChain(createFakeDb())).toBeNull();
    });
  });
});
