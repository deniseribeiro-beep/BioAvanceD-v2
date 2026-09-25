import { MongoClient, Db } from 'mongodb';

/**
 * #914 (RF014 AC#1, RNF021 AC#3): reads a user's session documents back out
 * of the test stack's Mongo. GET /api/auth/sessions exposes createdAt but not
 * refreshExpiresAt, which is the field that carries the absolute session cap,
 * so the cap can only be observed here. Same connection pattern as
 * queryFhirImport.ts.
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

export async function closeSessionsDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/** The user's most recently created session, or null. */
export async function findLatestSession(userID: string) {
  const db = await getDb();
  return db.collection('sessions').findOne({ userID: String(userID) }, { sort: { createdAt: -1 } });
}
