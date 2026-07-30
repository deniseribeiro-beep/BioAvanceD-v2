import { MongoClient, Db, ObjectId } from 'mongodb';

/**
 * RF011 (#324) fixture: reads back the FHIR import staging pipeline's
 * real Mongo state (import_batches/import_staging_records + the
 * committed patients/samples/audit_logs it writes into) — there's no API
 * to fetch a committed sample by specimenId or an audit_logs entry, so
 * this connects to the test stack's Mongo directly, same pattern as
 * seedParticipant.ts.
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

export async function closeFhirImportDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export async function findStagingRecordBySpecimenId(specimenId: string) {
  const db = await getDb();
  return db.collection('import_staging_records').findOne({ 'normalized.specimenId': specimenId });
}

export async function findCommittedSample(specimenId: string) {
  const db = await getDb();
  return db.collection('samples').findOne({ specimenId });
}

export async function findCommittedPatient(participantId: string) {
  const db = await getDb();
  return db.collection('patients').findOne({ participantId });
}

export async function findFhirImportAuditLogs(batchId: string) {
  const db = await getDb();
  // audit()'s batchId is stored as whatever type the caller passed —
  // commitBatch/sendConsents pass the real ObjectId, not its string form —
  // so query by ObjectId, not the hex string the API response serializes.
  return db
    .collection('audit_logs')
    .find({ module: 'FHIR_IMPORT', batchId: new ObjectId(batchId) })
    .toArray();
}

export async function removeFhirImportFixtures(specimenId: string, participantId: string): Promise<void> {
  const db = await getDb();
  await db.collection('samples').deleteMany({ specimenId });
  await db.collection('patients').deleteMany({ participantId });
  await db.collection('import_staging_records').deleteMany({ 'normalized.specimenId': specimenId });
}
