const crypto = require('crypto');
const { connectDB, closeConnection } = require('../database/mongo');
const { canonicalize, digestCanonical } = require('./audit-canonicalization.service');
const signingProvider = require('./audit-signing.provider');
const tree = require('./audit-tree.service');
const tsa = require('./audit-tsa.service');
const witness = require('./audit-witness.service');
const { generateAnonId } = require('../utils/userAnonymization');
const { CANONICAL_MODEL_RELEASE_ID } = require('../foundation/readiness');
const { INVARIANT_CATALOG_VERSION } = require('../governance/invariants');
const { currentRequestId } = require('../utils/requestContext');

// RF012 AC3 / RNF009 C4: one append-only chain for the application's audit
// events. Every event names the previous one's hash, so deleting, inserting
// or rewriting any event breaks every later link. Keying the chain on each
// log record's own id made every chain one event long, with
// previousEventHash always null (#1307). See
// docs/decisions/2026-10-08-audit-event-chain.md.
const AUDIT_CHAIN_LOG_ID = 'audit-events';
// Defaults for the v4 fields a log record does not carry itself (same
// decision record): the act's purpose, and the governance policy in force.
const DEFAULT_PURPOSE = 'operations';
const DEFAULT_POLICY_VERSION = `governance-invariants-${INVARIANT_CATALOG_VERSION}`;
const ACTOR_PSEUDONYM = /^USR-(?:[0-9A-F]{8}|SYSTEM)$/;
// Two concurrent appends read the same last event; the unique
// {logId, sequenceNumber} index refuses the second, which re-reads and retries.
const APPEND_ATTEMPTS = 8;

// The fields eventHash covers, in the order createEvent writes them.
const EVENT_FIELDS = [
  'eventId', 'logId', 'sequenceNumber', 'occurredAt', 'recordedAt', 'actorPseudonym',
  'action', 'entityType', 'entityId', 'result', 'source', 'correlationId', 'purpose',
  'policyVersion', 'canonicalModelReleaseId', 'payloadDigest', 'previousEventHash',
  'schemaVersion', 'hashAlgorithm',
];

function toActorPseudonym(actor) {
  if (!actor || actor === 'system') return 'USR-SYSTEM';
  const value = String(actor);
  return ACTOR_PSEUDONYM.test(value) ? value : generateAnonId(value);
}

class AuditV2Service {
  collections() {
    return {
      events: 'audit_events',
      archive: 'audit_events_archive',
      treeHeads: 'audit_tree_heads',
      tokens: 'audit_timestamp_tokens',
      witnesses: 'audit_witnesses',
    };
  }

  chainLogId() {
    return AUDIT_CHAIN_LOG_ID;
  }

  // The event fields eventHash was computed over, read from a stored event.
  // A schema-v1 event predates purpose/policyVersion/canonicalModelReleaseId,
  // so only the fields it was written with are taken.
  eventFieldsOf(doc) {
    const out = {};
    for (const field of EVENT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(doc, field)) out[field] = doc[field];
    }
    return out;
  }

  // RF012 AC6: recompute the stored event's hash from its own fields. A field
  // rewritten in place no longer digests to eventHash, and a canonicalLeaf
  // left untouched beside it no longer matches the document.
  verifyEventHash(doc) {
    if (!doc || !doc.eventHash) return false;
    const { hash } = digestCanonical(this.eventFieldsOf(doc));
    if (hash !== doc.eventHash) return false;
    const leaf = doc.canonicalLeaf || {};
    const { hash: leafHash } = digestCanonical(this.eventFieldsOf(leaf));
    return leaf.eventHash === doc.eventHash && leafHash === doc.eventHash;
  }

  // Every event of one chain, archived ones included: the retention sweep
  // moves expired events to the archive, and a later event's proof still
  // needs them (retentionSweep.service.js).
  async loadChain(db, logId = AUDIT_CHAIN_LOG_ID) {
    const { events, archive } = this.collections();
    const [live, archived] = await Promise.all([
      db.collection(events).find({ logId }).sort({ sequenceNumber: 1 }).toArray(),
      db.collection(archive).find({ logId }).sort({ sequenceNumber: 1 }).toArray(),
    ]);
    return [...archived, ...live].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  // RF012 AC3/AC6: each event digests to its eventHash, sequence numbers run
  // 1..n with no gap, and each previousEventHash names the event before it.
  // Returns the first broken sequence number, or null for an intact chain.
  verifyChain(leaves) {
    let previousHash = null;
    for (let i = 0; i < leaves.length; i += 1) {
      const doc = leaves[i];
      if (doc.sequenceNumber !== i + 1) return { valid: false, brokenAt: i + 1, reason: 'sequence' };
      if (!this.verifyEventHash(doc)) return { valid: false, brokenAt: doc.sequenceNumber, reason: 'eventHash' };
      if ((doc.previousEventHash || null) !== previousHash) {
        return { valid: false, brokenAt: doc.sequenceNumber, reason: 'previousEventHash' };
      }
      previousHash = doc.eventHash;
    }
    return { valid: true, brokenAt: null, reason: null };
  }

  async ensureIndexes(db) {
    const { events, treeHeads, tokens, witnesses } = this.collections();
    await db.collection(events).createIndex({ logId: 1, sequenceNumber: 1 }, { unique: true });
    await db.collection(events).createIndex({ eventId: 1 }, { unique: true });
    await db.collection(events).createIndex({ logId: 1, eventHash: 1 }, { unique: true });
    await db.collection(treeHeads).createIndex({ logId: 1, treeSize: 1 }, { unique: true });
    await db.collection(treeHeads).createIndex({ logId: 1, rootHash: 1 });
    await db.collection(treeHeads).createIndex({ logId: 1, status: 1 });
    await db.collection(treeHeads).createIndex({ keyId: 1 });
    await db.collection(tokens).createIndex({ logId: 1, treeSize: 1 }, { unique: true });
    await db.collection(tokens).createIndex({ serialNumber: 1 }, { unique: true, sparse: true });
    await db.collection(witnesses).createIndex({ logId: 1, treeSize: 1 }, { unique: true });
    await db.collection(witnesses).createIndex({ receipt: 1 }, { unique: true, sparse: true });
  }

  async nextSequenceNumber(db, logId) {
    const last = await this.lastEvent(db, logId);
    return (last?.sequenceNumber || 0) + 1;
  }

  async lastEvent(db, logId) {
    const { events, archive } = this.collections();
    const live = await db.collection(events).find({ logId }).sort({ sequenceNumber: -1 }).limit(1).toArray();
    if (live.length) return live[0];
    // Every live event archived: the chain continues from the archive's last.
    const archived = await db.collection(archive).find({ logId }).sort({ sequenceNumber: -1 }).limit(1).toArray();
    return archived[0] || null;
  }

  async createEvent({
    logId = AUDIT_CHAIN_LOG_ID,
    occurredAt,
    recordedAt,
    actorPseudonym,
    action,
    entityType,
    entityId,
    result,
    source,
    correlationId,
    purpose = DEFAULT_PURPOSE,
    policyVersion = DEFAULT_POLICY_VERSION,
    canonicalModelReleaseId = CANONICAL_MODEL_RELEASE_ID,
    payload = {},
    schemaVersion = 'audit.event.v2',
    hashAlgorithm = 'SHA-256',
  }, externalDb = null) {
    const db = externalDb || (await connectDB());
    try {
      await this.ensureIndexes(db);
      const { events } = this.collections();
      const payloadDigest = digestCanonical(payload).hash;
      for (let attempt = 1; ; attempt += 1) {
        const previous = await this.lastEvent(db, logId);
        const event = {
          eventId: crypto.randomUUID(),
          logId,
          sequenceNumber: (previous?.sequenceNumber || 0) + 1,
          occurredAt,
          recordedAt,
          actorPseudonym: toActorPseudonym(actorPseudonym),
          action,
          entityType,
          entityId,
          result,
          source,
          correlationId,
          purpose,
          policyVersion,
          canonicalModelReleaseId,
          payloadDigest,
          previousEventHash: previous?.eventHash || null,
          schemaVersion,
          hashAlgorithm,
        };
        const { canonical, hash } = digestCanonical(event);
        const canonicalLeaf = { ...event, canonical, eventHash: hash };
        // canonicalEventHash is the v4 name (dict V2E-0496); eventHash stays
        // the stored key that indexes, proofs and readers already use.
        const persisted = {
          ...event,
          canonicalLeaf,
          canonical,
          eventHash: hash,
          canonicalEventHash: hash,
          // The tree this event first appears in. Its inclusion proof is
          // computed against a sealed tree head at verify time
          // (audit.controller.js verifyAudit), never stored per event.
          treeSize: event.sequenceNumber,
        };
        try {
          await db.collection(events).insertOne(persisted);
          return persisted;
        } catch (error) {
          if (error && error.code === 11000 && attempt < APPEND_ATTEMPTS) continue;
          throw error;
        }
      }
    } finally {
      if (!externalDb) await closeConnection();
    }
  }

  async ingestLogRecord(logRecord, externalDb = null) {
    const db = externalDb || (await connectDB());
    try {
      await this.ensureIndexes(db);
      const details = (logRecord.details && typeof logRecord.details === 'object') ? logRecord.details : {};
      const event = await this.createEvent({
        logId: AUDIT_CHAIN_LOG_ID,
        occurredAt: logRecord.timestampISO || new Date().toISOString(),
        recordedAt: (logRecord.createdAt instanceof Date ? logRecord.createdAt.toISOString() : logRecord.createdAt) || new Date().toISOString(),
        // userName is the USR- pseudonym auditLogger writes; a record with
        // only a raw userID is pseudonymized in createEvent, never copied.
        actorPseudonym: logRecord.userName || logRecord.userID || 'system',
        purpose: String(logRecord.purpose || details.purpose || DEFAULT_PURPOSE),
        policyVersion: String(logRecord.policyVersion || details.policyVersion || DEFAULT_POLICY_VERSION),
        action: logRecord.action || 'UNKNOWN',
        // resourceType/resourceId are the canonical Log fields (dict-02_DICIONARIO.md
        // P1X-0326/P1X-0327: "Substitui o alias entity"/"Substitui entityID") -- prefer
        // them over the entity/entityID aliases (#447).
        entityType: logRecord.resourceType || logRecord.entity || 'Log',
        entityId: logRecord.resourceId || logRecord.entityID || null,
        result: logRecord.result || logRecord.status || 'success',
        source: logRecord.module || 'backend',
        // #1308: the serving request's id when the record carries none.
        correlationId: logRecord.correlationId || logRecord.requestId || currentRequestId() || null,
        payload: {
          message: logRecord.message || null,
          severity: logRecord.severity || null,
          module: logRecord.module || null,
          resourceType: logRecord.resourceType || null,
          resourceId: logRecord.resourceId || null,
        },
      }, db);
      return event;
    } finally {
      if (!externalDb) await closeConnection();
    }
  }

  // RF012 AC4: seal the chain's current state as a signed tree head, leaving
  // every event as written. Idempotent per size: createTreeHead upserts on
  // {logId, treeSize}. Returns null for an empty chain.
  async sealChain(db, logId = AUDIT_CHAIN_LOG_ID) {
    const leaves = await this.loadChain(db, logId);
    if (!leaves.length) return null;
    const { rootHash } = tree.buildTree(leaves.map((item) => item.canonicalLeaf));
    const previous = await db.collection(this.collections().treeHeads)
      .find({ logId, treeSize: { $lt: leaves.length } }).sort({ treeSize: -1 }).limit(1).toArray();
    return this.createTreeHead({
      logId,
      treeSize: leaves.length,
      rootHash,
      previousTreeHeadHash: previous[0]?.rootHash || null,
      periodStart: leaves[0].recordedAt,
      periodEnd: leaves[leaves.length - 1].recordedAt,
    }, db);
  }

  async createTreeHead({ logId, treeSize, rootHash, previousTreeHeadHash = null, periodStart, periodEnd, createdAt = new Date().toISOString(), leaves = [] }, externalDb = null) {
    const db = externalDb || (await connectDB());
    try {
      await this.ensureIndexes(db);
      const { treeHeads } = this.collections();
      const envelope = {
        schemaVersion: 'audit.treehead.v1',
        logId,
        treeSize,
        rootHash,
        previousTreeHeadHash,
        periodStart,
        periodEnd,
        createdAt,
        hashAlgorithm: 'SHA-256',
        merkleAlgorithm: 'RFC9162-STYLE',
        signatureAlgorithm: 'Ed25519',
        keyId: signingProvider.getKeyId(),
        status: 'PENDING_TIMESTAMP',
      };
      const canonical = canonicalize(envelope);
      const digest = digestCanonical(envelope);
      const signature = await signingProvider.sign(Buffer.from(canonical, 'utf8'));
      let token = null;
      let tokenStatus = 'PENDING_TIMESTAMP';
      try {
        token = await tsa.requestTimestamp(digest.hash);
        tokenStatus = 'TIMESTAMPED';
      } catch (error) {
        token = {
          status: 'PENDING_TIMESTAMP',
          error: error.message,
          messageImprint: digest.hash,
          token: null,
        };
      }
      const witnessRecord = {
        logId,
        treeSize,
        rootHash,
        sthDigest: digest.hash,
        signatureDigest: crypto.createHash('sha256').update(signature.signature).digest('hex'),
        timestampTokenDigest: token && token.token ? crypto.createHash('sha256').update(token.token).digest('hex') : null,
        publishedAt: new Date().toISOString(),
        witnessId: null,
      };
      let witnessResult = { status: 'UNAVAILABLE', reason: 'not_attempted' };
      try {
        witnessResult = await witness.publish(witnessRecord);
      } catch (error) {
        witnessResult = { status: 'FAILED', reason: error.message };
      }
      const doc = {
        ...envelope,
        signature: signature.signature,
        publicKeyFingerprint: signature.publicKeyFingerprint,
        status: envelope.status,
        anchorStatus: witnessResult.status === 'WITNESSED' ? 'ANCHORED' : tokenStatus,
        canonical,
        digestSha256: digest.hash,
        timestampToken: token,
        witness: { ...witnessRecord, ...witnessResult },
        createdAt,
        previousTreeHeadHash,
      };
      await db.collection(treeHeads).updateOne({ logId, treeSize }, { $setOnInsert: doc }, { upsert: true });
      if (token && token.token) {
        await db.collection(this.collections().tokens).updateOne(
          { logId, treeSize },
          { $setOnInsert: { logId, treeSize, ...token, createdAt: new Date().toISOString() } },
          { upsert: true }
        );
      }
      if (witnessResult && witnessResult.receipt) {
        await db.collection(this.collections().witnesses).updateOne(
          { logId, treeSize },
          { $setOnInsert: { logId, treeSize, receipt: witnessResult.receipt, witnessId: witnessResult.witnessId || null, createdAt: new Date().toISOString() } },
          { upsert: true }
        );
      }
      return doc;
    } finally {
      if (!externalDb) await closeConnection();
    }
  }
}

module.exports = new AuditV2Service();
module.exports.AUDIT_CHAIN_LOG_ID = AUDIT_CHAIN_LOG_ID;
module.exports.EVENT_FIELDS = EVENT_FIELDS;
