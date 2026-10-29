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

/** #1005: names of the indexes on `sessions`, to prove the lookup indexes are built live. */
export async function listSessionIndexNames(): Promise<string[]> {
  const db = await getDb();
  const indexes = await db.collection('sessions').indexes();
  return indexes.map((index) => String(index.name));
}

/**
 * The user's most recently created session, or null. #1330: sessions are
 * stored under userAccountId and sessionStartedAt (dict-02 Session).
 */
export async function findLatestSession(userID: string) {
  const db = await getDb();
  const owner = String(userID);
  return db.collection('sessions').findOne(
    { userAccountId: owner },
    { sort: { sessionStartedAt: -1 } }
  );
}

/**
 * #1251: back-dates a user's passwordChangedAt, so passwordRules.expirationDays
 * can be exercised on a live login. No API sets the field to a past date.
 */
export async function setPasswordChangedAt(userID: string, date: Date): Promise<void> {
  const { ObjectId } = await import('mongodb');
  const db = await getDb();
  const result = await db.collection('users').updateOne({ _id: new ObjectId(userID) }, { $set: { passwordChangedAt: date } });
  if (result.matchedCount !== 1) {
    throw new Error(`setPasswordChangedAt: no user ${userID}`);
  }
}
