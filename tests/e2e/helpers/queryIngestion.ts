import { MongoClient, Db } from 'mongodb';

/**
 * RF029 slice 1/6 (#669): the ingestion gateway foundation has no entity
 * route wired to it yet (that's #670-673), so — same no-API-surface-to-read-
 * back-through pattern queryFoundationData.ts already uses for RF022/RF028 —
 * this reads the collections the gateway itself writes
 * (ingestionQuarantineRecords, ingestionIdempotencyKeys) directly from the
 * same Mongo the test stack uses.
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
