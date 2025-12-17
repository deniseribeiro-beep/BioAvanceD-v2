const crypto = require('crypto');
const { connectDB, closeConnection } = require('../database/mongo');
const logger = require('../utils/logger');

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
    } catch (err) {
      logger.warn('Could not create indexes for audit_roots:', err.message);
    }
  }

  async saveDailyRoot({ date, root, db: externalDb = null }) {
    let localDb = null;
    const db = externalDb || (localDb = await connectDB());
    try {
      await this._ensureIndexes(db);

      const coll = db.collection(this.COLLECTION);

      // Find last chain element
      const last = await coll.find({}).sort({ chainIndex: -1 }).limit(1).toArray();
      const previous = last && last.length ? last[0] : null;

      const previousRootHash = previous ? previous.root : null;
      const chainIndex = previous ? previous.chainIndex + 1 : 0;

      const doc = {
        date,
        root,
        previousRootHash,
        chainIndex,
        createdAt: new Date()
      };

      // Upsert to avoid duplicates if run twice
      await coll.updateOne({ date }, { $setOnInsert: doc }, { upsert: true });

      return await coll.findOne({ date });
    } catch (error) {
      logger.error('Error saving daily root:', error.message);
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
            anomalies.push({ index: i, reason: 'first item has previousRootHash' });
          }
        } else {
          const prev = chain[i - 1];
          if (item.previousRootHash !== prev.root) {
            anomalies.push({ index: i, reason: 'previousRootHash mismatch', expected: prev.root, actual: item.previousRootHash });
          }
        }

        if (verifyRoots) {
          // Recalculate Merkle for the date to compare (expensive)
          const integrityService = require('./integrityCheckService');
          const res = await integrityService.buildMerkleForDate(item.date, db);
          if (!res || res.root !== item.root) {
            anomalies.push({ index: i, reason: 'root recalculation mismatch', date: item.date, saved: item.root, recalculated: res ? res.root : null });
          }
        }
      }

      return { ok: anomalies.length === 0, anomalies };
    } finally {
      if (localDb) await closeConnection();
    }
  }
}

module.exports = new AuditRootService();
