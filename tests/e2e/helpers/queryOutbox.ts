import crypto from 'crypto';
import { MongoClient, Db } from 'mongodb';

/**
 * #1499 helper for sample-storage-lifecycle.spec.ts: reads a sample's outbox
 * events straight from the test stack's Mongo and recomputes their payload
 * hash and idempotency key the way the outbox service builds them, so the
 * spec can prove the event contract (RF023 AC1/AC2, RNF019 C2) and the
 * aggregate/event atomicity (RF023 AC3, RNF019 C1). Same URI and direct
 * connection as seedCustody.ts.
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
