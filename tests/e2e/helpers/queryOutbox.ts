import crypto from 'crypto';
import { MongoClient, Db } from 'mongodb';

/**
 * #1499 helper for sample-storage-lifecycle.spec.ts: reads a sample's outbox
 * events straight from the test stack's Mongo and recomputes their payload
 * hash and idempotency key the way the outbox service builds them, so the
 * spec can prove the event contract (RF023 AC1/AC2, RNF019 C2) and the
 * aggregate/event atomicity (RF023 AC3, RNF019 C1). Same URI and direct
 * connection as seedCustody.ts.
 *
 * #1500: pipeline-continuity.spec.ts reads a consent's outbox events and the
 * projector's per-partition checkpoint through it too, and re-queues an
 * applied event to prove the projector's version order and idempotent
 * re-apply (RF023 AC4/AC6, RNF019 C3/C4).
 */

const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
  }
  return client.db(mongoDbName);
}

export async function closeOutboxDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/** The sample's Mongo _id as a string: the outbox aggregateId of its events. */
export async function sampleMongoId(specimenId: string): Promise<string> {
  const db = await getDb();
  const sample = await db.collection('samples').findOne({ specimenId });
  if (!sample) throw new Error(`no sample with specimenId ${specimenId}`);
  return String(sample._id);
}

export async function sampleOutboxEvents(mongoId: string) {
  const db = await getDb();
  return db
    .collection('graph_projection_outbox')
    .find({ aggregateType: 'Sample', aggregateId: mongoId })
    .sort({ aggregateVersion: 1 })
    .toArray();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableValue(record[key]);
        return acc;
      }, {});
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/** sha256 hex of the payload's key-sorted JSON, as the outbox service hashes it. */
export function expectedPayloadHash(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(payload || {})))
    .digest('hex');
}

/** sha256 hex of the event's identity fields joined with '|', as the outbox service keys it. */
export function expectedIdempotencyKey(e: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(
      [e.aggregateType, e.aggregateId, e.aggregateVersion, e.eventType, e.eventTypeVersion, e.payloadHash].join('|')
    )
    .digest('hex');
}

/** An active label already holding `code` in the sample-barcode namespace. */
export async function seedActiveSpecimenLabel(code: string): Promise<void> {
  const db = await getDb();
  await db.collection('labelIdentifiers').insertOne({
    labelIdentifierId: 'e2e-1499-' + code,
    encodedValue: code,
    namespaceRegistryId: 'legacy-sample-barcode',
    status: 'active',
    targetType: 'container',
    targetId: 'E2E-1499-NO-CONTAINER',
    createdAt: new Date(),
  });
}

/** Removes the seeded label and any label a successful create issued for these codes. */
export async function removeSpecimenLabels(codes: string[]): Promise<void> {
  const db = await getDb();
  await db.collection('labelIdentifiers').deleteMany({ encodedValue: { $in: codes } });
}

export async function countAbortedWrites(q: { linkedProject: string; barcode: string; boxId: string }) {
  const db = await getDb();
  return {
    samples: await db.collection('samples').countDocuments({ linkedProject: q.linkedProject }),
    movements: await db.collection('sample_movements').countDocuments({ barcode: q.barcode }),
    birthMovements: await db.collection('sample_movements').countDocuments({ barcode: q.barcode, type: 'create' }),
    custodyToBox: await db
      .collection('graph_projection_outbox')
      .countDocuments({ eventType: 'CUSTODY_EVENT_RECORDED', 'payload.to.boxId': q.boxId }),
    labels: await db.collection('labelIdentifiers').countDocuments({ encodedValue: q.barcode }),
  };
}

/** #1500: a consent's outbox events, in aggregateVersion order. */
export async function consentOutboxEvents(consentId: string) {
  const db = await getDb();
  return db
    .collection('graph_projection_outbox')
    .find({ aggregateType: 'EthicalConsent', aggregateId: consentId })
    .sort({ aggregateVersion: 1 })
    .toArray();
}

/** #1510 (RF019 AC6): a quarantine action's outbox events, in aggregateVersion order. */
export async function quarantineActionOutboxEvents(quarantineActionId: string) {
  const db = await getDb();
  return db
    .collection('graph_projection_outbox')
    .find({ aggregateType: 'QuarantineAction', aggregateId: quarantineActionId })
    .sort({ aggregateVersion: 1 })
    .toArray();
}

/** #1500: the Neo4j projector's checkpoint for one partition (`<aggregateType>:<aggregateId>`). */
export async function projectionCheckpoint(partitionKey: string) {
  const db = await getDb();
  return db
    .collection<{ _id: string } & Record<string, unknown>>('graph_projection_checkpoints')
    .findOne({ _id: 'neo4j-canonical-projection:' + partitionKey });
}

/**
 * #1519 (RNF016 C2): drops the projector's checkpoint for one partition
 * (`<aggregateType>:<aggregateId>`), so a requeue of its events replays them
 * all: the projector state a rebuild from the outbox starts from.
 */
export async function deleteProjectionCheckpoint(partitionKey: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<{ _id: string }>('graph_projection_checkpoints')
    .deleteOne({ _id: 'neo4j-canonical-projection:' + partitionKey });
}

/**
 * #1500 (RF023 AC6, RNF019 C3): puts applied events back in the queue, the
 * at-least-once re-delivery a consumer must absorb. The same reset the
 * dead-letter requeue applies, plus projectedAt so the re-delivery shows.
 */
export async function requeueOutboxEvents(eventIds: string[]): Promise<void> {
  const db = await getDb();
  await db.collection('graph_projection_outbox').updateMany(
    { eventId: { $in: eventIds } },
    {
      $set: {
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: null,
        leaseUntil: null,
        projectedAt: null,
        processedAt: null,
        updatedAt: new Date(),
      },
    }
  );
}

/** #1500: polls until every event is PROJECTED with a projectedAt, or throws naming each one's last status. */
export async function waitForOutboxEventsProjected(
  eventIds: string[],
  { timeoutMs = 15_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const db = await getDb();
  const deadline = Date.now() + timeoutMs;
  let lastSeen: Record<string, string> = {};

  while (Date.now() < deadline) {
    const docs = await db
      .collection('graph_projection_outbox')
      .find({ eventId: { $in: eventIds } })
      .toArray();
    lastSeen = {};
    for (const id of eventIds) {
      const doc = docs.find((d) => d.eventId === id);
      lastSeen[id] = doc ? `${doc.status}${doc.projectedAt ? '' : ' (no projectedAt)'}` : 'no event found';
    }
    if (eventIds.every((id) => lastSeen[id] === 'PROJECTED')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `waitForOutboxEventsProjected: timed out after ${timeoutMs}ms waiting for events to be PROJECTED ` +
      `(last seen: ${eventIds.map((id) => `${id}=${lastSeen[id] ?? 'not read'}`).join(', ')})`
  );
}

/**
 * #1501 fixture for pipeline-continuity.spec.ts: an outbox event the real
 * projection worker leases and fails on every try. Its payload's
 * terminologyConceptId is an object whose own `toString` is a string, so the
 * projector's String() of it throws a TypeError before any Neo4j write: a
 * poison event, failed in data alone, with no test hook in the backend. Each
 * event gets its own aggregate, so the version-order check never defers it.
 */
export const OUTBOX_POISON_ERROR = 'Cannot convert object to primitive value';

export async function insertPoisonOutboxEvent(
  eventId: string,
  fields: Record<string, unknown> = {}
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db.collection('graph_projection_outbox').insertOne({
    eventId,
    eventType: 'TERMINOLOGY_CONCEPT_PROMOTED',
    eventTypeVersion: '1',
    aggregateType: 'E2EFixture1501',
    aggregateId: `${eventId}-aggregate`,
    aggregateVersion: 1,
    payload: { terminologyConceptId: { toString: 'e2e-1501-poison' } },
    schemaVersion: 1,
    occurredAt: now,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    projectedAt: null,
    processedAt: null,
    leaseUntil: null,
    nextAttemptAt: null,
    sourceService: 'e2e-1501',
    traceId: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
  });
}

export async function readOutboxEvent(eventId: string) {
  const db = await getDb();
  return db.collection('graph_projection_outbox').findOne({ eventId });
}

export async function deleteOutboxEvents(eventIds: string[]): Promise<void> {
  const db = await getDb();
  await db.collection('graph_projection_outbox').deleteMany({ eventId: { $in: eventIds } });
}
