import { MongoClient, Db, Timestamp } from 'mongodb';

/**
 * #1517 helper for interop-monitoring.spec.ts (RF015, RNF026): replays, in
 * write order, the writes one dispatched notification made to its own row
 * and the e-mail transport's compliance log, read from the test stack's Mongo
 * change stream (mongodb-test is a single-node replica set). The order shows
 * that the attempt is stored as `attempted` before the transport is touched.
 * Same URI and connection as seedSensor.ts.
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

export async function closeNotificationWritesDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/** The cluster's operation time now: replay starts here, so writes made after it are all read. */
export async function clusterTimeNow(): Promise<Timestamp> {
  const db = await getDb();
  const reply = await db.command({ ping: 1 });
  return (reply.operationTime ?? reply.$clusterTime?.clusterTime) as Timestamp;
}

export type NotificationWrite =
  | 'row-inserted'
  | 'attempt-recorded'
  | 'transport-attempted'
  | 'transport-sent'
  | 'attempt-result'
  | 'delivered';

/**
 * Labels each write since `since` to the notification `notificationId` and to
 * the compliance log of the rule e-mail whose subject is `subject`, in the
 * order the server applied them, until the row reads delivered.
 */
export async function notificationWriteOrder(
  since: Timestamp,
  notificationId: string,
  subject: string,
  timeoutMs = 15_000
): Promise<NotificationWrite[]> {
  const db = await getDb();
  const stream = db.watch(
    [{ $match: { 'ns.coll': { $in: ['notifications', 'notification_compliance_logs'] }, operationType: { $in: ['insert', 'update'] } } }],
    { startAtOperationTime: since }
  );
  const order: NotificationWrite[] = [];
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline && order[order.length - 1] !== 'delivered') {
      const change: any = await stream.tryNext();
      if (!change) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const label = labelOf(change, notificationId, subject);
      if (label) order.push(label);
    }
  } finally {
    await stream.close();
  }
  return order;
}

function labelOf(change: any, notificationId: string, subject: string): NotificationWrite | null {
  if (change.ns.coll === 'notification_compliance_logs') {
    const log = change.fullDocument;
    if (change.operationType !== 'insert' || log?.notificationType !== 'rule_notification' || log?.subject !== subject) return null;
    if (log.deliveryStatus === 'ATTEMPTED') return 'transport-attempted';
    return log.sentAt ? 'transport-sent' : null;
  }
  if (String(change.documentKey?._id) !== notificationId) return null;
  if (change.operationType === 'insert') return 'row-inserted';
  const updated = change.updateDescription?.updatedFields || {};
  if (updated.status === 'delivered') return 'delivered';
  // A whole-array $set can be reported as the array or as per-element paths
  // (attempts.0.result), so read the written values, not the field names.
  const written = JSON.stringify(updated);
  if (written.includes('"attempted"')) return 'attempt-recorded';
  if (written.includes('"success"')) return 'attempt-result';
  return null;
}
