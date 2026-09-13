const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const env = require('../config/env');
const logger = require('../utils/logger');

const COLLECTION_NAME = 'graph_projection_outbox';

// #941: `ensureIndexes` (including the `eventId` unique index that makes
// outbox delivery idempotent) was previously only ever called from
// `scripts/neo4j-canonical-rebuild.js:83` -- a manual script, not the
// normal `appendEvent` write path, so on a regular boot or worker run the
// unique index was never built. Latched per collection name here, the same
// "once per process" shape `cid.service.js`'s `ensureIndexes` uses, so a
// hot append path doesn't re-issue `createIndex` on every call. Failure
// posture is unchanged from `ensureIndexes` itself: it still throws rather
// than logs (no internal try/catch), so this wiring does not swallow an
// index-build failure -- it just avoids retrying it after the first
// attempt in this process.
const ensuredOutboxIndexCollections = new Set();

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload || {})).digest('hex');
}

function normalizeText(value) {
  return String(value || '').trim();
}

class Neo4jOutboxService {
  constructor(options = {}) {
    this.collectionName = options.collectionName || COLLECTION_NAME;
  }

  getCollection(db) {
    if (!db || typeof db.collection !== 'function') {
      throw new Error('Database MongoDB indisponível para outbox do grafo');
    }
    return db.collection(this.collectionName);
  }

  async ensureIndexes(db) {
    const collection = this.getCollection(db);
    await collection.createIndex({ eventId: 1 }, { unique: true, name: 'graph_projection_outbox_eventId_unique' });
    await collection.createIndex({ status: 1, aggregateType: 1, aggregateId: 1, occurredAt: 1 }, { name: 'graph_projection_outbox_status_aggregate_idx' });
    await collection.createIndex({ leaseUntil: 1, status: 1, occurredAt: 1 }, { name: 'graph_projection_outbox_lease_idx' });
    return true;
  }

  buildEvent(event = {}) {
    const eventId = normalizeText(event.eventId) || crypto.randomUUID();
    const payload = event.payload || {};
    return {
      eventId,
      eventType: normalizeText(event.eventType),
      aggregateType: normalizeText(event.aggregateType),
      aggregateId: normalizeText(event.aggregateId),
      payload,
      payloadHash: hashPayload(payload),
      schemaVersion: Number(event.schemaVersion || 1),
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      projectedAt: null,
      processedAt: null,
      leaseUntil: null,
      sourceService: normalizeText(event.sourceService) || 'unknown',
      traceId: normalizeText(event.traceId) || null,
      projectionState: event.projectionState || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async appendEvent(db, event, options = {}) {
    const collection = this.getCollection(db);

    // #941: the outbox eventId unique index is what makes delivery idempotent,
    // and until now it was built ONLY by scripts/neo4j-canonical-rebuild.js --
    // so on a normal boot or worker run it never existed. Built here instead,
    // once per collection name per process.
    //
    // Logged, not thrown, and that differs deliberately from ensureIndexes own
    // posture. The two callers want opposite things from a failed build: the
    // manual rebuild script is ASKING for the indexes, so a failure is its
    // result; appendEvent is asking to append, and the index is a backstop
    // rather than the mechanism -- the same argument utils/sampleIndexes.js
    // makes for samples.barcode. Letting a build failure take down every
    // outbox append would trade a missing index for a broken projection
    // pipeline.
    //
    // Latched BEFORE the await so a persistent failure cannot retry per
    // append; that matches utils/collectionResolver.js:46-48.
    if (!ensuredOutboxIndexCollections.has(this.collectionName)) {
      ensuredOutboxIndexCollections.add(this.collectionName);
      try {
        await this.ensureIndexes(db);
      } catch (error) {
        logger.warn(
          `[NEO4J_OUTBOX] Falha ao criar indices de ${this.collectionName}: ${error.message}. ` +
          ('A entrega continua, mas sem a garantia de idempotencia do indice unico em eventId (#941).')
        );
      }
    }

    const doc = this.buildEvent({
      ...event,
      projectionState: event.projectionState || options.projectionState || {},
    });
    const { updatedAt, ...docWithoutUpdatedAt } = doc;

    await collection.updateOne(
      { eventId: doc.eventId },
      {
        $setOnInsert: docWithoutUpdatedAt,
        $set: {
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return doc;
  }

  async leaseNextBatch(db, options = {}) {
    const collection = this.getCollection(db);
    const batchSize = Math.max(1, Number(options.batchSize || env.GRAPH_OUTBOX_BATCH_SIZE || 100));
    const maxAttempts = Math.max(1, Number(options.maxAttempts || env.GRAPH_OUTBOX_MAX_ATTEMPTS || 8));
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - Number(options.leaseMs || env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000));

    await collection.updateMany(
      {
        status: 'PROCESSING',
        updatedAt: { $lte: staleProcessingBefore }
      },
      {
        $set: {
          status: 'RETRYING',
          leaseUntil: null,
          updatedAt: new Date()
        },
        $inc: { attempts: 1 },
        $setOnInsert: { lastError: 'leased_processing_timeout' }
      }
    );

    const events = await collection
      .find({
        status: { $in: ['PENDING', 'RETRYING'] },
        attempts: { $lt: maxAttempts }
      })
      .sort({ aggregateType: 1, aggregateId: 1, occurredAt: 1, _id: 1 })
      .limit(batchSize)
      .toArray();

    if (!events.length) {
      return [];
    }

    const eventIds = events.map((event) => event.eventId);
    await collection.updateMany(
      { eventId: { $in: eventIds } },
      {
        $set: {
          status: 'PROCESSING',
          leaseUntil: new Date(now.getTime() + Number(options.leaseMs || env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000)),
          updatedAt: now
        },
        $inc: { attempts: 1 }
      }
    );

    return collection.find({ eventId: { $in: eventIds } }).toArray();
  }

  async rescheduleStaleProcessing(db, options = {}) {
    const collection = this.getCollection(db);
    const now = new Date();
    const leaseMs = Number(options.leaseMs || env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000);
    const staleBefore = new Date(now.getTime() - leaseMs);
    const result = await collection.updateMany(
      {
        status: 'PROCESSING',
        updatedAt: { $lte: staleBefore }
      },
      {
        $set: {
          status: 'RETRYING',
          leaseUntil: null,
          updatedAt: now,
          lastError: 'processing_lease_expired'
        },
        $inc: { attempts: 1 }
      }
    );
    return result.modifiedCount || 0;
  }

  async markProjected(db, eventId) {
    const collection = this.getCollection(db);
    await collection.updateOne(
      { eventId },
      {
        $set: {
          status: 'PROJECTED',
          projectedAt: new Date(),
          processedAt: new Date(),
          leaseUntil: null,
          lastError: null,
          updatedAt: new Date()
        }
      }
    );
  }

  async markRetrying(db, eventId, error) {
    const collection = this.getCollection(db);
    await collection.updateOne(
      { eventId },
      {
        $set: {
          status: 'RETRYING',
          lastError: String(error?.message || error || 'unknown_error'),
          updatedAt: new Date()
        }
      }
    );
  }

  async markDeadLetter(db, eventId, error) {
    const collection = this.getCollection(db);
    await collection.updateOne(
      { eventId },
      {
        $set: {
          status: 'DEAD_LETTER',
          lastError: String(error?.message || error || 'unknown_error'),
          processedAt: new Date(),
          updatedAt: new Date(),
          leaseUntil: null
        }
      }
    );
  }

  async recoverProcessing(db, leaseMs = env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000) {
    const collection = this.getCollection(db);
    const staleBefore = new Date(Date.now() - Number(leaseMs));
    const result = await collection.updateMany(
      {
        status: 'PROCESSING',
        updatedAt: { $lte: staleBefore }
      },
      {
        $set: {
          status: 'RETRYING',
          leaseUntil: null,
          updatedAt: new Date()
        },
        $inc: { attempts: 1 }
      }
    );
    return result.modifiedCount || 0;
  }
}

module.exports = {
  Neo4jOutboxService,
  hashPayload,
  stableStringify,
  COLLECTION_NAME,
};
