import { MongoClient, Db } from 'mongodb';

/**
 * #1457 (RNF009 C3, RNF020 C6, RNF007 C5): reads the stored audit trail back
 * out of the test stack's Mongo, so a spec can show that what the backend
 * kept for an action carries no password, token, secret or civil
 * identifier. `logs` is the primary trail the Logs screen and its export
 * read; `audit_events` is its hash-chained mirror, whose correlationId is the
 * serving request's X-Request-Id. Same connection pattern as
 * queryAuditEvents.ts.
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

export async function closeLogRedactionDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/** Every `logs` row written at or after `since`, newest first. */
export async function logRowsSince(since: Date) {
  const db = await getDb();
  return db.collection('logs').find({ timestamp: { $gte: since } }).sort({ timestamp: -1 }).limit(5000).toArray();
}

/** The `audit_events` mirror rows written while serving the given request ids. */
export async function auditEventsForRequests(requestIds: string[]) {
  const db = await getDb();
  return db.collection('audit_events').find({ correlationId: { $in: requestIds } }).toArray();
}
