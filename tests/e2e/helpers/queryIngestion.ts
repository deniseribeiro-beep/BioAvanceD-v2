import { MongoClient, Db } from 'mongodb';

/**
 * RF029 (#669, #1318): POST /api/ingestion/records now persists through the
 * gateway, but its response names ids only, so — same no-API-surface-to-read-
 * back-through pattern queryFoundationData.ts already uses for RF022/RF028 —
 * this reads the collections the gateway and the route write
 * (ingestionQuarantineRecords, ingestionIdempotencyKeys, the entity stores,
 * graph_projection_outbox, logs) directly from the same Mongo the test stack
 * uses.
 */
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri);
    await client.connect();
  }
  return client.db(mongoDbName);
}

export async function closeIngestionDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export async function findIngestionQuarantineRecord(ingestionQuarantineRecordId: string): Promise<any> {
  const db = await getDb();
  return db.collection('ingestionQuarantineRecords').findOne({ ingestionQuarantineRecordId });
}

export async function countIngestionQuarantineRecordsByIdempotencyKey(idempotencyKey: string): Promise<number> {
  const db = await getDb();
  return db.collection('ingestionQuarantineRecords').countDocuments({ idempotencyKey });
}

export async function findIngestionIdempotencyKey(idempotencyKey: string, scope: string): Promise<any> {
  const db = await getDb();
  return db.collection('ingestionIdempotencyKeys').findOne({ idempotencyKey, scope });
}

export async function findIngestedRecord(collection: 'datasets' | 'workflowRuns', idField: string, id: string): Promise<any> {
  const db = await getDb();
  return db.collection(collection).findOne({ [idField]: id });
}

export async function countIngestedBySourceRecordId(
  collection: 'datasets' | 'workflowRuns' | 'ingestionQuarantineRecords',
  sourceRecordId: string
): Promise<number> {
  const db = await getDb();
  return db.collection(collection).countDocuments({ sourceRecordId });
}

export async function findOutboxEvents(aggregateId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('graph_projection_outbox').find({ aggregateId, eventType: 'INGESTION_RECORD_PERSISTED' }).toArray();
}

export async function findIngestionAuditRows(action: string, resourceId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('logs').find({ action, resourceId }).toArray();
}

export async function findCanonicalModelRelease(canonicalModelReleaseId: string): Promise<any> {
  const db = await getDb();
  return db.collection('canonicalModelReleases').findOne({ canonicalModelReleaseId });
}
