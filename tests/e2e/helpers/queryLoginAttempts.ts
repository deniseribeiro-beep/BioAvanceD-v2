import { MongoClient, Db } from 'mongodb';

/**
 * #1255: the source-address attempt store (ipAttempt.service.js) has no API
 * surface, by design -- it holds pre-authentication state about callers. The
 * specs read it from the same Mongo the stack uses, the pattern
 * queryFoundationData.ts and querySessions.ts already follow.
 *
 * The test backend trusts X-Forwarded-For from trusted-hop-test only (#1263),
 * so every API call the runner sends it directly shares one source address. The suite's own deliberate failures (wrong MFA
 * codes, old-password checks) therefore accumulate on one row, and
 * clearLoginAttempts() is called from global-setup so a re-run inside the
 * 30-minute window starts from zero instead of inheriting the last run's
 * count and blocking itself.
 */
const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';
const COLLECTION = 'login_ip_attempts';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  return client.db(mongoDbName);
}

export async function closeLoginAttemptsDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export type LoginAttemptRow = {
  _id: string;
  failures: number;
  accounts: string[];
  windowStart: Date;
  expiresAt: Date;
  blockedUntil: Date | null;
  blockReason: string | null;
  [key: string]: unknown;
};

export async function listLoginAttemptRows(): Promise<LoginAttemptRow[]> {
  const db = await getDb();
  return db.collection<LoginAttemptRow>(COLLECTION).find({}).toArray();
}

export async function listLoginAttemptIndexes(): Promise<Array<{ name: string; expireAfterSeconds?: number }>> {
  const db = await getDb();
  return (await db.collection(COLLECTION).indexes()) as Array<{ name: string; expireAfterSeconds?: number }>;
}

/**
 * #1263: audit rows from the `logs` collection, newest first. The unusual-
 * activity spec reads metadata.tracking.ip here, which GET /api/logs does not
 * promise to return, to prove the row names the address the trusted hop
 * forwarded.
 */
export async function findLogRows(filter: Record<string, unknown>): Promise<Array<Record<string, any>>> {
  const db = await getDb();
  return db.collection('logs').find(filter).sort({ timestamp: -1 }).limit(20).toArray();
}

export async function clearLoginAttempts(): Promise<number> {
  const db = await getDb();
  const result = await db.collection(COLLECTION).deleteMany({});
  return result.deletedCount ?? 0;
}
