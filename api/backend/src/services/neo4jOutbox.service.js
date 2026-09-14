const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const env = require('../config/env');
const logger = require('../utils/logger');

const COLLECTION_NAME = 'graph_projection_outbox';
const CANONICAL_MODEL_RELEASE_ID = 'release-2.0.0';
const DEFAULT_EVENT_TYPE_VERSION = '1.0.0';

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

function normalizeAggregateVersion(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 1;
}

function buildIdempotencyKey({ eventType, aggregateType, aggregateId, aggregateVersion, payloadHash }) {
  return crypto
    .createHash('sha256')
    .update(stableStringify({ eventType, aggregateType, aggregateId, aggregateVersion, payloadHash }))
    .digest('hex');
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
    await collection.createIndex({ idempotencyKey: 1 }, {
      name: 'graph_projection_outbox_idempotency_idx',
      partialFilterExpression: { idempotencyKey: { $type: 'string' } }
    });
    await collection.createIndex({ status: 1, aggregateType: 1, aggregateId: 1, occurredAt: 1 }, { name: 'graph_projection_outbox_status_aggregate_idx' });
    await collection.createIndex({ leaseUntil: 1, status: 1, occurredAt: 1 }, { name: 'graph_projection_outbox_lease_idx' });
    return true;
  }

  buildEvent(event = {}) {
    const eventId = normalizeText(event.eventId) || crypto.randomUUID();
    const payload = event.payload || {};
    const payloadHash = hashPayload(payload);
    const eventType = normalizeText(event.eventType);
    const aggregateType = normalizeText(event.aggregateType);
    const aggregateId = normalizeText(event.aggregateId);
    const aggregateVersion = normalizeAggregateVersion(event.aggregateVersion);
    const schemaVersion = Number(event.schemaVersion || 1);
    const canonicalModelReleaseId = normalizeText(event.canonicalModelReleaseId) || CANONICAL_MODEL_RELEASE_ID;
    const eventTypeVersion = normalizeText(event.eventTypeVersion) || DEFAULT_EVENT_TYPE_VERSION;
    const idempotencyKey = normalizeText(event.idempotencyKey) || buildIdempotencyKey({
      eventType,
      aggregateType,
      aggregateId,
      aggregateVersion,
      payloadHash
    });
    const now = new Date();

    return {
      eventId,
      eventType,
      aggregateType,
      aggregateId,
      payload,
      payloadHash,
      schemaVersion,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : now,
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      projectedAt: null,
      processedAt: null,
      leaseUntil: null,
      sourceService: normalizeText(event.sourceService) || 'unknown',
      traceId: normalizeText(event.traceId) || null,
      projectionState: event.projectionState || {},
      createdAt: now,
      updatedAt: now,
      canonicalModelReleaseId,
      aggregateVersion,
      eventTypeVersion,
      idempotencyKey,
    };
  }

  async appendEvent(db, event, options = {}) {
    const collection = this.getCollection(db);

    if (!ensuredOutboxIndexCollections.has(this.collectionName)) {
      ensuredOutboxIndexCollections.add(this.collectionName);
      try {
        await this.ensureIndexes(db);
      } catch (error) {
        logger.warn(
          `[NEO4J_OUTBOX] Falha ao criar indices de ${this.collectionName}: ${error.message}. ` +
          'A entrega continua, mas sem as garantias de indice do outbox (#941).'
        );
      }
    }

    const doc = this.buildEvent({
      ...event,
      projectionState: event.projectionState || options.projectionState || {},
    });
    const { updatedAt, ...docWithoutUpdatedAt } = doc;
    const writeOptions = {
      upsert: true,
      ...(options.session ? { session: options.session } : {}),
    };

    await collection.updateOne(
      { eventId: doc.eventId },
      {
        $setOnInsert: docWithoutUpdatedAt,
        $set: {
          updatedAt: new Date(),
        },
      },
      writeOptions
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
  buildIdempotencyKey,
  COLLECTION_NAME,
  CANONICAL_MODEL_RELEASE_ID,
  DEFAULT_EVENT_TYPE_VERSION,
};
