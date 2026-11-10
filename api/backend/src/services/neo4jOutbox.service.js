const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const env = require('../config/env');
const logger = require('../utils/logger');
const { CANONICAL_MODEL_RELEASE_ID } = require('../foundation/readiness');
const { currentRequestId } = require('../utils/requestContext');

const COLLECTION_NAME = 'graph_projection_outbox';
const DEFAULT_EVENT_TYPE_VERSION = '1';
const CHECKPOINT_COLLECTION_NAME = 'graph_projection_checkpoints';
// #1313 (RNF019 C5): the longest a failed event waits between attempts. A
// module constant, like the projection worker's heartbeat path, rather than
// a new env key.
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000;

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

// #1313 (RF023 AC2, V2E-0470): the replay key names the aggregate version
// the event records and what it carries, so the same event re-applied keeps
// its key and two versions of one aggregate never share one.
function buildIdempotencyKey(event) {
  return crypto.createHash('sha256').update([
    event.aggregateType,
    event.aggregateId,
    event.aggregateVersion,
    event.eventType,
    event.eventTypeVersion,
    event.payloadHash,
  ].join('|')).digest('hex');
}

class Neo4jOutboxService {
  constructor(options = {}) {
    this.collectionName = options.collectionName || COLLECTION_NAME;
    this.versionCollectionName = options.versionCollectionName || `${this.collectionName}_aggregate_versions`;
    this.checkpointCollectionName = options.checkpointCollectionName || CHECKPOINT_COLLECTION_NAME;
  }

  // #1313 (RF023 AC1/AC4, V2E-0468): the aggregate's version counter. Each
  // append takes the next version of its aggregate in the caller's session,
  // so in a transaction an aborted write gives its version back, and two
  // concurrent appends to one aggregate conflict and retry rather than
  // share a version.
  async nextAggregateVersion(db, aggregateType, aggregateId, options = {}) {
    const counter = await db.collection(this.versionCollectionName).findOneAndUpdate(
      { _id: `${aggregateType}:${aggregateId}` },
      { $inc: { version: 1 }, $set: { aggregateType, aggregateId, updatedAt: new Date() } },
      {
        upsert: true,
        returnDocument: 'after',
        ...(options.session ? { session: options.session } : {}),
      }
    );
    return Number(counter?.version || 1);
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
    // #1313: events appended before the versioned contract carry no key,
    // so the index covers only the events that do.
    await collection.createIndex(
      { idempotencyKey: 1 },
      { unique: true, name: 'graph_projection_outbox_idempotencyKey_unique', partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
    );
    return true;
  }

  buildEvent(event = {}) {
    const eventId = normalizeText(event.eventId) || crypto.randomUUID();
    const payload = event.payload || {};
    const versioned = {
      eventType: normalizeText(event.eventType),
      eventTypeVersion: normalizeText(event.eventTypeVersion) || DEFAULT_EVENT_TYPE_VERSION,
      aggregateType: normalizeText(event.aggregateType),
      aggregateId: normalizeText(event.aggregateId),
      aggregateVersion: Number(event.aggregateVersion || 1),
      payloadHash: hashPayload(payload),
    };
    return {
      eventId,
      eventType: versioned.eventType,
      eventTypeVersion: versioned.eventTypeVersion,
      aggregateType: versioned.aggregateType,
      aggregateId: versioned.aggregateId,
      aggregateVersion: versioned.aggregateVersion,
      idempotencyKey: normalizeText(event.idempotencyKey) || buildIdempotencyKey(versioned),
      canonicalModelReleaseId: normalizeText(event.canonicalModelReleaseId) || CANONICAL_MODEL_RELEASE_ID,
      payload,
      payloadHash: versioned.payloadHash,
      schemaVersion: Number(event.schemaVersion || 1),
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      projectedAt: null,
      processedAt: null,
      leaseUntil: null,
      nextAttemptAt: null,
      sourceService: normalizeText(event.sourceService) || 'unknown',
      // #1323 RNF015 C1: the request's id when the caller gives none.
      traceId: normalizeText(event.traceId) || currentRequestId() || null,
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

    const aggregateVersion = event.aggregateVersion || await this.nextAggregateVersion(
      db,
      normalizeText(event.aggregateType),
      normalizeText(event.aggregateId),
      options
    );
    const doc = this.buildEvent({
      ...event,
      aggregateVersion,
      projectionState: event.projectionState || options.projectionState || {},
    });
    const { updatedAt, ...docWithoutUpdatedAt } = doc;

    // #1313 (RF023 AC3, RNF019 C1): `options.session` is the aggregate's own
    // transaction, so the event commits or aborts with the write it records.
    // The index build above stays outside it; an index build is not a
    // transactional operation.
    await collection.updateOne(
      { eventId: doc.eventId },
      {
        $setOnInsert: docWithoutUpdatedAt,
        $set: {
          updatedAt: new Date(),
        },
      },
      options.session ? { upsert: true, session: options.session } : { upsert: true }
    );

    return doc;
  }

  async leaseNextBatch(db, options = {}) {
    const collection = this.getCollection(db);
    const batchSize = Math.max(1, Number(options.batchSize || env.GRAPH_OUTBOX_BATCH_SIZE || 100));
    const maxAttempts = Math.max(1, Number(options.maxAttempts || env.GRAPH_OUTBOX_MAX_ATTEMPTS || 8));
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - Number(options.leaseMs || env.GRAPH_OUTBOX_LEASE_MS || 5 * 60 * 1000));

    // #1529 (RNF019 C5): a lease that timed out on its last allowed try is a dead letter.
    await this.deadLetterExhausted(collection, {
      maxAttempts,
      staleBefore: staleProcessingBefore,
      now,
      lastError: 'leased_processing_timeout',
    });

    // #1527 (RNF019 C5): the lease already counted this try; a timeout does not count it again.
    await collection.updateMany(
      {
        status: 'PROCESSING',
        updatedAt: { $lte: staleProcessingBefore }
      },
      {
        $set: {
          status: 'RETRYING',
          leaseUntil: null,
          lastError: 'leased_processing_timeout',
          updatedAt: new Date()
        }
      }
    );

    const events = await collection
      .find({
        status: { $in: ['PENDING', 'RETRYING'] },
        attempts: { $lt: maxAttempts },
        // #1313 (RNF019 C5): a retry waits out its backoff.
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }]
      })
      .sort({ aggregateType: 1, aggregateId: 1, aggregateVersion: 1, occurredAt: 1, _id: 1 })
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
    const maxAttempts = Math.max(1, Number(options.maxAttempts || env.GRAPH_OUTBOX_MAX_ATTEMPTS || 8));
    // #1529 (RNF019 C5): a lease that timed out on its last allowed try is a dead letter.
    const deadLettered = await this.deadLetterExhausted(collection, {
      maxAttempts,
      staleBefore,
      now,
      lastError: 'processing_lease_expired',
    });
    // #1527 (RNF019 C5): the lease already counted this try; a timeout does not count it again.
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
        }
      }
    );
    return deadLettered + (result.modifiedCount || 0);
  }

  // #1529 (RNF019 C5): no lease claims an event whose tries are spent, so one
  // whose last lease timed out, stale in PROCESSING or already put back in
  // RETRYING by an earlier sweep, would sit there for good. It goes to
  // DEAD_LETTER, where requeueDeadLetters can requeue it.
  async deadLetterExhausted(collection, { maxAttempts, staleBefore, now, lastError }) {
    const result = await collection.updateMany(
      {
        attempts: { $gte: maxAttempts },
        $or: [
          { status: 'RETRYING' },
          { status: 'PROCESSING', updatedAt: { $lte: staleBefore } },
        ],
      },
      {
        $set: {
          status: 'DEAD_LETTER',
          lastError,
          processedAt: now,
          updatedAt: now,
          leaseUntil: null,
        },
      }
    );
    const count = result?.modifiedCount || 0;
    if (count) {
      logger.error('[GRAPH_OUTBOX] DEAD_LETTER: lease expirado na última tentativa', { count, maxAttempts, lastError });
    }
    return count;
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

  // #1313 (RNF019 C5): a failed event waits base * 2^(attempts-1), capped,
  // before it is leased again.
  retryDelayMs(attempts, options = {}) {
    const baseMs = Math.max(1, Number(options.backoffBaseMs || env.GRAPH_OUTBOX_RETRY_BACKOFF_MS || 1000));
    const exponent = Math.max(0, Number(attempts || 1) - 1);
    return Math.min(baseMs * (2 ** exponent), MAX_RETRY_BACKOFF_MS);
  }

  async markRetrying(db, eventId, error, options = {}) {
    const collection = this.getCollection(db);
    const now = new Date();
    await collection.updateOne(
      { eventId },
      {
        $set: {
          status: 'RETRYING',
          lastError: String(error?.message || error || 'unknown_error'),
          nextAttemptAt: new Date(now.getTime() + this.retryDelayMs(options.attempts, options)),
          leaseUntil: null,
          updatedAt: now
        }
      }
    );
  }

  // #1313 (RF023 AC4, RNF019 C4): an event is applied in its aggregate's
  // version order. One leased while an earlier version of its aggregate is
  // still unprojected goes back to the queue, and the lease's attempt is
  // given back, since the event itself did not fail. A dead letter blocks
  // too, so the checkpoint never passes a version the graph lacks; it holds
  // its aggregate until scripts/graph-projection-reconcile.js requeues it.
  async findEarlierUnprojectedVersion(db, event) {
    return this.getCollection(db).findOne({
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: { $lt: event.aggregateVersion },
      status: { $in: ['PENDING', 'RETRYING', 'PROCESSING', 'DEAD_LETTER'] },
    }, { projection: { eventId: 1, status: 1 } });
  }

  // An event held by a dead letter waits the longest backoff, since only a
  // repair releases it; one held by a queued event waits the base delay.
  async markDeferred(db, eventId, options = {}) {
    const now = new Date();
    const delayMs = options.blockedByDeadLetter ? MAX_RETRY_BACKOFF_MS : this.retryDelayMs(1, options);
    await this.getCollection(db).updateOne(
      { eventId },
      {
        $set: {
          status: 'RETRYING',
          lastError: options.blockedByDeadLetter ? 'awaiting_dead_letter_repair' : 'awaiting_earlier_aggregate_version',
          nextAttemptAt: new Date(now.getTime() + delayMs),
          leaseUntil: null,
          updatedAt: now
        },
        $inc: { attempts: -1 }
      }
    );
  }

  // #1313 (RF023 AC4, RNF019 C4, V2E-0604..0610): a GraphProjectionCheckpoint
  // per projector and partition, the partition being the aggregate, whose
  // events the outbox orders by aggregateVersion.
  getCheckpointCollection(db) {
    if (!db || typeof db.collection !== 'function') {
      throw new Error('Database MongoDB indisponível para outbox do grafo');
    }
    return db.collection(this.checkpointCollectionName);
  }

  static partitionKeyOf(event) {
    return `${event.aggregateType}:${event.aggregateId}`;
  }

  async getCheckpoint(db, projectorName, partitionKey) {
    return this.getCheckpointCollection(db).findOne({ _id: `${projectorName}:${partitionKey}` });
  }

  async recordCheckpoint(db, projectorName, event, options = {}) {
    const collection = this.getCheckpointCollection(db);
    const partitionKey = Neo4jOutboxService.partitionKeyOf(event);
    const _id = `${projectorName}:${partitionKey}`;
    const aggregateVersion = Number(event.aggregateVersion);
    const now = new Date();
    // $max keeps the checkpoint from moving backwards; the event that set
    // the version then names itself.
    await collection.updateOne(
      { _id },
      {
        $max: { lastAggregateVersion: aggregateVersion },
        $setOnInsert: { graphProjectionCheckpointId: crypto.randomUUID(), projectorName, partitionKey },
      },
      { upsert: true }
    );
    await collection.updateOne(
      { _id, lastAggregateVersion: aggregateVersion },
      {
        $set: {
          lastEventId: event.eventId,
          projectionSchemaVersion: String(options.projectionSchemaVersion || event.schemaVersion || 1),
          updatedAt: now,
        },
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

  // #1313 (RNF019 C7): an aggregate whose counter is ahead of the projector's
  // checkpoint, with none of its later events still queued, will never reach
  // the graph on its own. Each one is reported with the dead letters that
  // hold its unprojected versions; one with none took a version no event
  // holds, a write that failed outside a transaction, and needs a rebuild.
  async findUnprojectedAggregates(db, projectorName) {
    const outbox = this.getCollection(db);
    const counters = await db.collection(this.versionCollectionName).find({}).toArray();
    const found = [];
    for (const counter of counters) {
      const partitionKey = Neo4jOutboxService.partitionKeyOf(counter);
      const checkpoint = await this.getCheckpoint(db, projectorName, partitionKey);
      const checkpointVersion = Number(checkpoint?.lastAggregateVersion || 0);
      const aggregateVersion = Number(counter.version || 0);
      if (aggregateVersion <= checkpointVersion) continue;

      const later = {
        aggregateType: counter.aggregateType,
        aggregateId: counter.aggregateId,
        aggregateVersion: { $gt: checkpointVersion },
      };
      // A dead letter holds every later version behind it, so its aggregate
      // is stalled whatever else is queued.
      const deadLetters = await outbox
        .find({ ...later, status: 'DEAD_LETTER' }, { projection: { eventId: 1 } })
        .toArray();
      if (!deadLetters.length) {
        const queued = await outbox.findOne(
          { ...later, status: { $in: ['PENDING', 'RETRYING', 'PROCESSING'] } },
          { projection: { eventId: 1 } }
        );
        if (queued) continue;
      }
      found.push({
        aggregateType: counter.aggregateType,
        aggregateId: counter.aggregateId,
        aggregateVersion,
        checkpointVersion,
        deadLetterEventIds: deadLetters.map((event) => event.eventId),
      });
    }
    return found;
  }

  // #1313 (RNF019 C7): the repair. A dead letter goes back to the queue with
  // its attempts reset; its lastError stays as the record of why it stopped.
  // The events it held are released for the next lease, which re-checks
  // their order.
  async requeueDeadLetters(db, eventIds) {
    if (!eventIds.length) return 0;
    const collection = this.getCollection(db);
    const result = await collection.updateMany(
      { eventId: { $in: eventIds }, status: 'DEAD_LETTER' },
      {
        $set: {
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: null,
          leaseUntil: null,
          processedAt: null,
          updatedAt: new Date(),
        },
      }
    );
    await collection.updateMany(
      { status: 'RETRYING', lastError: 'awaiting_dead_letter_repair' },
      { $set: { nextAttemptAt: null, updatedAt: new Date() } }
    );
    return result.modifiedCount || 0;
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
  CHECKPOINT_COLLECTION_NAME,
  MAX_RETRY_BACKOFF_MS,
};
