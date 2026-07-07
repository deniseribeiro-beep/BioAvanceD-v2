const crypto = require('crypto');
const { connectDB, closeConnection } = require('../database/mongo');
const { canonicalize, digestCanonical } = require('./audit-canonicalization.service');
const signingProvider = require('./audit-signing.provider');
const tree = require('./audit-tree.service');
const tsa = require('./audit-tsa.service');
const witness = require('./audit-witness.service');

class AuditV2Service {
  collections() {
    return {
      events: 'audit_events',
      treeHeads: 'audit_tree_heads',
      tokens: 'audit_timestamp_tokens',
      witnesses: 'audit_witnesses',
    };
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
    const { events } = this.collections();
    const last = await db.collection(events).find({ logId }).sort({ sequenceNumber: -1 }).limit(1).toArray();
    return (last[0]?.sequenceNumber || 0) + 1;
  }

  async createEvent({
    logId,
    occurredAt,
    recordedAt,
    actorPseudonym,
    action,
    entityType,
    entityId,
    result,
    source,
    correlationId,
    payload = {},
    schemaVersion = 'audit.event.v1',
    hashAlgorithm = 'SHA-256',
  }, externalDb = null) {
    const db = externalDb || (await connectDB());
    try {
      await this.ensureIndexes(db);
      const { events } = this.collections();
      const sequenceNumber = await this.nextSequenceNumber(db, logId);
      const previous = await db.collection(events).find({ logId }).sort({ sequenceNumber: -1 }).limit(1).toArray();
      const payloadDigest = digestCanonical(payload).hash;
      const event = {
        eventId: crypto.randomUUID(),
        logId,
        sequenceNumber,
        occurredAt,
        recordedAt,
        actorPseudonym,
        action,
        entityType,
        entityId,
        result,
        source,
        correlationId,
        payloadDigest,
        previousEventHash: previous[0]?.eventHash || null,
        schemaVersion,
        hashAlgorithm,
      };
      const { canonical, hash } = digestCanonical(event);
      const canonicalLeaf = {
        ...event,
        canonical,
        eventHash: hash,
      };
      const proofTree = tree.buildTree(previous.length ? [...previous.map((item) => item.canonicalLeaf), canonicalLeaf] : [canonicalLeaf]);
      const inclusionIndex = proofTree.leafHashes.length - 1;
      const inclusionProof = tree.inclusionProof(proofTree, inclusionIndex);
      const persisted = {
        ...event,
        canonicalLeaf,
        canonical,
        eventHash: hash,
        inclusionProof,
        treeSize: proofTree.treeSize,
      };
      await db.collection(events).insertOne(persisted);
      return persisted;
    } finally {
      if (!externalDb) await closeConnection();
    }
  }

  async ingestLogRecord(logRecord, externalDb = null) {
    const db = externalDb || (await connectDB());
    try {
      await this.ensureIndexes(db);
      const event = await this.createEvent({
        logId: String(logRecord._id || logRecord.id || logRecord.resourceId || crypto.randomUUID()),
        occurredAt: logRecord.timestampISO || new Date().toISOString(),
        recordedAt: logRecord.createdAt || new Date().toISOString(),
        actorPseudonym: logRecord.userName || logRecord.userID || 'system',
        action: logRecord.action || 'UNKNOWN',
        entityType: logRecord.entity || logRecord.resourceType || 'Log',
        entityId: logRecord.entityID || logRecord.resourceId || null,
        result: logRecord.result || logRecord.status || 'success',
        source: logRecord.module || 'backend',
        correlationId: logRecord.correlationId || logRecord.requestId || null,
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
