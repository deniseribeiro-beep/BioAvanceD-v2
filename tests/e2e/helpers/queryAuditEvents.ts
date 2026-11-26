import { MongoClient, Db } from 'mongodb';

/**
 * #1307 (RF012 AC3/AC6): reads and rewrites audit_events in the test stack's
 * Mongo. A rewrite is the only way to show that verification detects
 * tampering, because no route alters an audit event. Same connection pattern
 * as querySessions.ts.
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

export async function closeAuditEventsDb(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = null;
  await closing.close();
}

/** Heal leftover RF012 tamper rows from a timed-out prior run. */
export async function restoreTamperedAuditResults(
  logId: string,
  restoredResult = 'success',
): Promise<number> {
  const db = await getDb();
  const result = await db
    .collection('audit_events')
    .updateMany({ logId, result: 'tampered' }, { $set: { result: restoredResult } });
  return result.modifiedCount;
}

/** The chain's newest events, newest first. */
export async function latestChainEvents(logId: string, limit: number) {
  const db = await getDb();
  return db.collection('audit_events').find({ logId }).sort({ sequenceNumber: -1 }).limit(limit).toArray();
}

/** Sets one top-level field of a stored event and returns its previous value. */
export async function rewriteEventField(eventId: string, field: string, value: unknown): Promise<unknown> {
  const db = await getDb();
  const before = await db.collection('audit_events').findOne({ eventId });
  if (!before) throw new Error(`queryAuditEvents: no audit event ${eventId}`);
  await db.collection('audit_events').updateOne({ eventId }, { $set: { [field]: value } });
  return before[field];
}
