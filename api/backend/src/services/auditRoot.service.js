const crypto = require('crypto');
const { connectDB, closeConnection } = require('../database/mongo');
const logger = require('../utils/logger');
const merkleEnvelopeService = require('./merkle-envelope.service');
const rfc3161AdapterService = require('./rfc3161-adapter.service');
const logService = require('./log.service');

/**
 * Service: auditRoot.service
 * Responsibilities:
 *  - Persist daily Merkle roots to collection `audit_roots`
 *  - Provide retrieval, chain listing and verification utilities
 */

class AuditRootService {
  constructor() {
    this.COLLECTION = 'audit_roots';
  }

  async _ensureIndexes(db) {
    try {
      const coll = db.collection(this.COLLECTION);
      await coll.createIndex({ date: 1 }, { unique: true });
      await coll.createIndex({ chainIndex: 1 });
      await coll.createIndex({ previousRootHash: 1 });
      await this._ensureTimestampTokenIndex(coll);
      await coll.createIndex({ 'timestamp.status': 1, date: 1 });
    } catch (err) {
      logger.warn('Não foi possível criar índices para audit_roots:', err.message);
    }
  }

  // #1236: unique among real tokens only. A sparse index skips an ABSENT field
  // but indexes an explicit null, and saveDailyRoot writes timestamp.token: null
  // for every root the TSA has not anchored, so `sparse` allowed exactly one
  // such root. A stack created before this carries the sparse index under the
  // same name, which createIndex rejects as IndexKeySpecsConflict (86): replace it.
  async _ensureTimestampTokenIndex(coll) {
    const keys = { 'timestamp.token': 1 };
    const options = { unique: true, partialFilterExpression: { 'timestamp.token': { $type: 'string' } } };
    try {
      await coll.createIndex(keys, options);
    } catch (err) {
      if (err?.code !== 86 && err?.code !== 85) throw err;
      await coll.dropIndex('timestamp.token_1');
      await coll.createIndex(keys, options);
    }
  }

  async saveDailyRoot({ date, root, treeSize = 0, db: externalDb = null }) {
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      await this._ensureIndexes(db);

      const coll = db.collection(this.COLLECTION);

      const existing = await coll.findOne({ date });
      if (existing) return existing;

      // Find last chain element
      const last = await coll.find({}).sort({ chainIndex: -1 }).limit(1).toArray();
      const previous = last && last.length ? last[0] : null;

      const previousRootHash = previous ? previous.root : null;
      const chainIndex = previous ? previous.chainIndex + 1 : 0;
      const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
        date,
        root,
        treeSize,
        previousAnchorHash: previousRootHash,
      });

      const signaturePayload = await merkleEnvelopeService.signEnvelope(envelope);
      const timestampDraft = await rfc3161AdapterService.anchorEnvelopeDigest({
        envelopeDigestSha256: signaturePayload.envelopeDigestSha256,
        envelopeDigestBase64: signaturePayload.envelopeDigestBase64,
      });
      const timestampVerification = rfc3161AdapterService.verifyTimestamp({
        envelopeDigestSha256: signaturePayload.envelopeDigestSha256,
        timestamp: timestampDraft,
      });

      const timestamp = {
        mode: timestampDraft.mode,
        status: timestampVerification.ok ? timestampVerification.status : timestampDraft.status,
        token: timestampDraft.token,
        tsa: timestampDraft.tsa,
        messageImprint: timestampDraft.messageImprint,
        anchoredAt: timestampDraft.anchoredAt || null,
        verifiedAt: timestampVerification.verifiedAt || timestampDraft.verifiedAt || null,
        retries: 0,
        lastAttemptAt: new Date(),
        error: timestampVerification.ok ? null : (timestampVerification.reason || timestampDraft.error || null),
      };

      const doc = {
        date,
        root,
        schemaVersion: 2,
        envelope,
        signature: signaturePayload.signature,
        signatureAlgorithm: signaturePayload.signatureAlgorithm,
        keyId: signaturePayload.keyId,
        publicKeyFingerprint: signaturePayload.publicKeyFingerprint,
        hashAlgorithm: envelope.hashAlgorithm,
        merkleAlgorithm: envelope.merkleAlgorithm,
        treeSize,
        previousAnchorHash: envelope.previousAnchorHash,
        timestamp,
        previousRootHash,
        chainIndex,
        createdAt: new Date()
      };

      // Upsert to avoid duplicates if run twice
      await coll.updateOne({ date }, { $setOnInsert: doc }, { upsert: true });

      try {
        await logService.createLog(db, {
          userID: 'USR-SYSTEM',
          action: 'MERKLE_ENVELOPE_GENERATED',
          resourceType: 'AuditRoot',
          resourceId: date,
          entity: 'Report',
          entityID: date,
          status: 'success',
          result: 'success',
          severity: 'info',
          module: 'Sistema',
          message: `Envelope assinado da root diária gerado para ${date}`,
          payload: {
            date,
            keyId: signaturePayload.keyId,
            schemaVersion: 2,
            timestampStatus: timestamp.status,
          },
        });
      } catch (logError) {
        logger.warn('Falha ao registrar evento MERKLE_ENVELOPE_GENERATED:', logError.message || logError);
      }

      return await coll.findOne({ date });
    } catch (error) {
      logger.error('Erro ao salvar root diária:', error.message);
      throw error;
    } finally {
      if (localDb) await closeConnection();
    }
  }

  async getRootByDate(date, externalDb = null) {
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      const coll = db.collection(this.COLLECTION);
      return await coll.findOne({ date });
    } finally {
      if (localDb) await closeConnection();
    }
  }

  async getOfficialRootRecord(date, externalDb = null) {
    const rootDoc = await this.getRootByDate(date, externalDb);
    if (!rootDoc) return null;
    return {
      rootDoc,
      envelopeRecord: merkleEnvelopeService.fromPersistedRoot(rootDoc),
    };
  }

  async getChain(externalDb = null) {
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      const coll = db.collection(this.COLLECTION);
      const chain = await coll.find({}).sort({ chainIndex: 1 }).toArray();
      return chain;
    } finally {
      if (localDb) await closeConnection();
    }
  }

  async verifyChainIntegrity({ verifyRoots = false, externalDb = null } = {}) {
    // verify structural linking of previousRootHash and optional root recalculation
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      const coll = db.collection(this.COLLECTION);
      const chain = await coll.find({}).sort({ chainIndex: 1 }).toArray();
      const anomalies = [];

      for (let i = 0; i < chain.length; i++) {
        const item = chain[i];
        if (i === 0) {
          if (item.previousRootHash) {
            anomalies.push({ index: i, reason: 'primeiro item contém previousRootHash' });
          }
        } else {
          const prev = chain[i - 1];
          if (item.previousRootHash !== prev.root) {
            anomalies.push({ index: i, reason: 'previousRootHash divergente', expected: prev.root, actual: item.previousRootHash });
          }
        }

        if (verifyRoots) {
          // Recalculate Merkle for the date to compare (expensive)
          const integrityService = require('./integrityCheckService');
          const res = await integrityService.buildMerkleForDate(item.date, db);
          if (!res || res.root !== item.root) {
            anomalies.push({ index: i, reason: 'divergência na recomputação da root', date: item.date, saved: item.root, recalculated: res ? res.root : null });
          }
        }
      }

      return { ok: anomalies.length === 0, anomalies };
    } finally {
      if (localDb) await closeConnection();
    }
  }

  async updateTimestampStatus({ date, status, error = null, externalDb = null }) {
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      const coll = db.collection(this.COLLECTION);
      await coll.updateOne(
        { date },
        {
          $set: {
            'timestamp.status': status,
            'timestamp.error': error,
            'timestamp.lastAttemptAt': new Date(),
            ...(status === 'VERIFIED' ? { 'timestamp.verifiedAt': new Date() } : {}),
          },
          $inc: { 'timestamp.retries': status === 'RETRYING' ? 1 : 0 },
        }
      );
    } finally {
      if (localDb) await closeConnection();
    }
  }

  async processTimestampBacklog({ externalDb = null, limit = 50, maxRetries = 5 } = {}) {
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      await this._ensureIndexes(db);
      const coll = db.collection(this.COLLECTION);
      const pending = await coll.find({
        schemaVersion: 2,
        'timestamp.status': { $in: ['PENDING', 'RETRYING', 'FAILED', 'ANCHORED'] },
        $or: [
          { 'timestamp.retries': { $lt: maxRetries } },
          { 'timestamp.retries': { $exists: false } },
        ],
      }).sort({ date: 1 }).limit(limit).toArray();

      for (const doc of pending) {
        const verification = merkleEnvelopeService.verifyEnvelopeSignature({
          envelope: doc.envelope,
          signature: doc.signature,
          signatureAlgorithm: doc.signatureAlgorithm,
          keyId: doc.keyId,
          publicKeyFingerprint: doc.publicKeyFingerprint,
        });
        if (!verification.ok) {
          await this.updateTimestampStatus({ date: doc.date, status: 'FAILED', error: `signature_${verification.reason}`, externalDb: db });
          continue;
        }

        let timestamp = doc.timestamp || null;
        if (!timestamp || !timestamp.token) {
          await this.updateTimestampStatus({ date: doc.date, status: 'RETRYING', error: null, externalDb: db });
          const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
            envelopeDigestSha256: verification.envelopeDigestSha256,
            envelopeDigestBase64: verification.envelopeDigestBase64,
          });
          timestamp = {
            mode: anchored.mode,
            status: anchored.status,
            token: anchored.token,
            tsa: anchored.tsa,
            messageImprint: anchored.messageImprint,
            anchoredAt: anchored.anchoredAt || null,
            verifiedAt: null,
            retries: (doc.timestamp?.retries || 0) + 1,
            lastAttemptAt: new Date(),
            error: anchored.error || null,
          };
          await coll.updateOne({ _id: doc._id }, { $set: { timestamp } });
        }

        const replay = timestamp.token
          ? await coll.countDocuments({
            _id: { $ne: doc._id },
            'timestamp.token': timestamp.token,
          }) > 0
          : false;
        const timestampCheck = rfc3161AdapterService.verifyTimestamp({
          envelopeDigestSha256: verification.envelopeDigestSha256,
          timestamp,
          replayDetected: replay,
        });

        if (!timestampCheck.ok) {
          await this.updateTimestampStatus({ date: doc.date, status: 'FAILED', error: timestampCheck.reason, externalDb: db });
          try {
            await logService.createLog(db, {
              userID: 'USR-SYSTEM',
              action: 'MERKLE_ANCHOR_FAILED',
              resourceType: 'AuditRoot',
              resourceId: doc.date,
              entity: 'Report',
              entityID: doc.date,
              status: 'failure',
              result: 'failure',
              severity: 'warning',
              module: 'Sistema',
              message: `Falha na ancoragem/validação RFC3161 para ${doc.date}`,
              payload: { date: doc.date, reason: timestampCheck.reason },
            });
          } catch (logError) {
            logger.warn('Falha ao registrar evento MERKLE_ANCHOR_FAILED:', logError.message || logError);
          }
          continue;
        }

        await coll.updateOne(
          { _id: doc._id },
          {
            $set: {
              'timestamp.status': 'VERIFIED',
              'timestamp.error': null,
              'timestamp.verifiedAt': new Date(),
              'timestamp.lastAttemptAt': new Date(),
            },
          }
        );

        try {
          await logService.createLog(db, {
            userID: 'USR-SYSTEM',
            action: 'MERKLE_ANCHORED',
            resourceType: 'AuditRoot',
            resourceId: doc.date,
            entity: 'Report',
            entityID: doc.date,
            status: 'success',
            result: 'success',
            severity: 'info',
            module: 'Sistema',
            message: `Root diária ancorada e validada para ${doc.date}`,
            payload: { date: doc.date, status: 'VERIFIED' },
          });
        } catch (logError) {
          logger.warn('Falha ao registrar evento MERKLE_ANCHORED:', logError.message || logError);
        }
      }

      return { processed: pending.length };
    } finally {
      if (localDb) await closeConnection();
    }
  }
}

module.exports = new AuditRootService();
