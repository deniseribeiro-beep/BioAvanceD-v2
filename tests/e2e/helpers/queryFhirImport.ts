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

/**
 * RNF031 C8 (FHIR is the boundary): the sorted names of the test stack's
 * collections whose name contains "fhir". The runtime reading of the
 * store-name rule fhir-boundary.arch.test.js reads in source, so it also
 * sees a name a model derives only at run time.
 */
export async function listFhirNamedCollections(): Promise<string[]> {
  const collections = await (await getDb()).listCollections({}, { nameOnly: true }).toArray();
  return collections
    .map((collection) => collection.name)
    .filter((name) => /fhir/i.test(name))
    .sort();
}

/**
 * #787 (RNF011 AC#4): the LGPD sample import's quarantine, which writes
 * into the same two collections as the FHIR path above. Reads the batch and
 * its rejected rows back out of Mongo, so an e2e spec can prove the rows
 * actually survived the HTTP response rather than trusting the response's
 * own stagingBatchId.
 */
export async function findLgpdQuarantineBatch(batchId: string) {
  const db = await getDb();
  return db.collection('import_batches').findOne({ _id: new ObjectId(batchId) });
}

export async function findLgpdQuarantinedRows(batchId: string) {
  const db = await getDb();
  return db
    .collection('import_staging_records')
    .find({ batchId: new ObjectId(batchId) })
    .sort({ rowNumber: 1 })
    .toArray();
}

// #794: seeds a batch of the OTHER import type, so a test can assert that the
// LGPD batch route refuses it. Both importers share `import_batches`, so a
// reader that filters on `_id` alone serves whichever batch it is handed --
// see #799 for that same leak in the FHIR direction.
export async function seedForeignImportBatch(): Promise<string> {
  const db = await getDb();
  const now = new Date();
  const result = await db.collection('import_batches').insertOne({
    type: 'FHIR_BUNDLE',
    source: 'FHIR',
    status: 'STAGED',
    fileName: 'e2e-794-foreign-batch.json',
    counts: { total: 0, success: 0, errors: 0 },
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
  return String(result.insertedId);
}

export async function removeForeignImportBatch(batchId: string): Promise<void> {
  const db = await getDb();
  await db.collection('import_batches').deleteOne({ _id: new ObjectId(batchId) });
}

// #1191: `normalized` (which holds specimenId) is sealed at rest, so a
// query on 'normalized.specimenId' matches nothing. Staged records are found
// by their batch instead; the fields a test asserts on (status, errors) stay
// readable without the key.
export async function findStagingRecordsByBatch(batchId: string) {
  const db = await getDb();
  return db.collection('import_staging_records').find({ batchId: new ObjectId(batchId) }).toArray();
}

export async function findCommittedSample(specimenId: string) {
  const db = await getDb();
  return db.collection('samples').findOne({ specimenId });
}

export async function findCommittedPatient(participantId: string) {
  const db = await getDb();
  return db.collection('patients').findOne({ participantId });
}

// RF005/RNF007 (#571/#575): patientName is civil identity — commitBatch
// never writes it onto the canonical Patient document; its sole write
// target is this segregated collection. It is ciphertext-only there (#1104),
// so this raw row carries no plaintext name -- read it back decrypted through
// the API's re-identification endpoint.
export async function findCommittedParticipantIdentity(participantId: string) {
  const db = await getDb();
  return db.collection('participantIdentities').findOne({ participantId });
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

export async function removeFhirImportFixtures(
  specimenId: string,
  participantId: string,
  batchId?: string
): Promise<void> {
  const db = await getDb();
  await db.collection('samples').deleteMany({ specimenId });
  await db.collection('patients').deleteMany({ participantId });
  await db.collection('participantIdentities').deleteMany({ participantId });
  // #1191: by batch, since 'normalized.specimenId' is sealed at rest.
  if (batchId) {
    await db.collection('import_staging_records').deleteMany({ batchId: new ObjectId(batchId) });
  }
}
