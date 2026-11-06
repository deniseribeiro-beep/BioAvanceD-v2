import { MongoClient, Db, ObjectId } from 'mongodb';

/**
 * #1456 (RNF020 AC2/AC3, RNF021 AC3): reads a user's stored credentials out
 * of the test stack's Mongo, and sets the stored inactivity timeout below the
 * API's 5-minute floor so idle expiry can be exercised in seconds. No route
 * returns passwordHash or mfaSecretCiphertext (UserModel.stripSecrets), so
 * how they are stored can only be observed here. Same connection pattern as
 * querySessions.ts.
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

export async function closeStoredCredentialsDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/** The stored user document, secrets included. */
export async function findStoredUser(userID: string) {
  const db = await getDb();
  return db.collection('users').findOne({ _id: new ObjectId(userID) });
}

/**
 * Sets security_config main's session.timeoutMinutes as stored, bypassing
 * the API's 5..480 range, and returns the previous stored value (undefined
 * when the key was absent). Passing undefined removes the key again.
 * createSession copies the value into each new session's inactivityTimeoutMs.
 */
export async function setStoredSessionTimeoutMinutes(minutes: number | undefined): Promise<number | undefined> {
  const db = await getDb();
  const configs = db.collection<{ _id: string; session?: { timeoutMinutes?: number } }>('security_config');
  const before = await configs.findOne({ _id: 'main' });
  if (!before) throw new Error('setStoredSessionTimeoutMinutes: no security_config main');
  if (minutes === undefined) {
    await configs.updateOne({ _id: 'main' }, { $unset: { 'session.timeoutMinutes': 1 } });
  } else {
    await configs.updateOne({ _id: 'main' }, { $set: { 'session.timeoutMinutes': minutes } });
  }
  return before.session?.timeoutMinutes;
}
