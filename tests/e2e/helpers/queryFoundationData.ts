import { MongoClient, Db } from 'mongodb';

/**
 * RF022 (#329) fixture: there's no API surface for the Foundation Data
 * Pipeline at all (api/backend/scripts/seed-essential-reference-data.js is a
 * manual CLI script, never invoked by the app or compose.test.yml) — so
 * proving the gap means reading the reference collections directly from the
 * same Mongo the test stack itself uses, the same pattern seedParticipant.ts
 * and queryNeo4j.ts already use for this reason.
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

/** Closes the shared Mongo connection — call once from a suite's afterAll. */
export async function closeFoundationDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/**
 * essential/manifest.js's three entries target these collections
 * (sampleTypes/terminologies via miabis-minimal/sprec-minimal). A one-shot
 * bootstrap coupled to the build would populate them before anything else
 * runs; today nothing does.
 */
export async function countEssentialReferenceDocs(): Promise<number> {
  const db = await getDb();
  const [sampleTypes, terminologies] = await Promise.all([
    db.collection('sampleTypes').countDocuments(),
    db.collection('terminologies').countDocuments(),
  ]);
  return sampleTypes + terminologies;
}

/**
 * `referenceSeedRuns` (collections.js's CANONICAL_COLLECTIONS.referenceSeedRuns)
 * is the manifest's own run-tracking target for the rcs-gov-1.0 entry — the
 * closest thing today to the target model's FoundationDataRun. It's only
 * ever written by manually running `npm run seed:essential`, never by an
 * idempotent job coupled to the build after healthchecks.
 */
export async function countReferenceSeedRuns(): Promise<number> {
  const db = await getDb();
  return db.collection('referenceSeedRuns').countDocuments();
}

/**
 * RF028 (#330) fixture: dict-08_MAIN_GAPS.md's "Reference data pipeline" row
 * names ReferenceDatasetRelease as the entity a Fase 2 importer must write
 * before any concept/relation load is considered valid (RF028 AC 1, 8) —
 * there is no model, collection, or importer for it anywhere in
 * api/backend/src today (grepped for ReferenceDatasetRelease/importer
 * controllers — only Fase 3 operational import.controller.js etc. exist).
 */
export async function countReferenceDatasetReleases(): Promise<number> {
  const db = await getDb();
  return db.collection('referenceDatasetReleases').countDocuments();
}

/**
 * RF028 AC 6: imported concepts (MONDO/HPO/ORPHA/etc., AC 2) must persist in
 * TerminologyConcept, linked to a release. Same gap as above — no collection
 * is ever written today, since no importer exists to write it.
 */
export async function countTerminologyConcepts(): Promise<number> {
  const db = await getDb();
  return db.collection('terminologyConcepts').countDocuments();
}
