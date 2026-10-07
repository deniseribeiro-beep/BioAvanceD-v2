import { MongoClient, Db } from 'mongodb';

/**
 * RF022 (#329) fixture: there's no API surface for the Foundation Data
 * Pipeline at all (api/backend/scripts/seed-essential-reference-data.js runs
 * as compose.test.yml's one-shot `foundation-bootstrap-test` job, before the
 * API, and the app never calls it) — so its evidence is read from the
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
 * `foundationDataRuns` (collections.js's CANONICAL_COLLECTIONS.foundationDataRuns,
 * #370) is the dedicated FoundationDataRun model — one document per full
 * Foundation Data Pipeline execution, written by
 * seed-essential-reference-data.js after every manifest entry completes.
 * Superseded `referenceSeedRuns`, which #366 had generalized as a stopgap
 * (one row per manifest entry, not per pipeline run).
 */
export async function countFoundationDataRuns(): Promise<number> {
  const db = await getDb();
  return db.collection('foundationDataRuns').countDocuments();
}

/**
 * RF022 AC1: the newest FoundationDataRun, for the dictionary release and
 * completeness verdict the bootstrap recorded on it.
 */
export async function latestFoundationDataRun(): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('foundationDataRuns').find({}).sort({ startedAt: -1 }).limit(1).next();
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

/**
 * #548: the generic countReferenceDatasetReleases()/countTerminologyConcepts()
 * checks above are satisfied by HPO alone (#367) and don't prove any specific
 * later source actually landed. This filters by datasetCode so a per-source
 * slice (MONDO here, more to follow per #549) has its own provable assertion
 * rather than riding on HPO's already-passing count.
 */
export async function countReferenceDatasetReleasesByDatasetCode(datasetCode: string): Promise<number> {
  const db = await getDb();
  return db.collection('referenceDatasetReleases').countDocuments({ datasetCode });
}

/**
 * #722: how many *active* releases a datasetCode has.
 *
 * Distinct from countReferenceDatasetReleasesByDatasetCode above, which
 * counts releases in any state. `activeCodeValidator.checkActiveCode` only
 * resolves a code against a release whose `releaseStatus` is `active`, so
 * "a release exists" and "a code will validate" are different questions --
 * and the second is the one an RF029 ingestion probe actually depends on.
 *
 * Used by pipeline-continuity.spec.ts's RF029 blocks to assert their own
 * precondition explicitly, rather than failing as `expected 'accepted',
 * received 'quarantined'` on a stack whose reference-data bootstrap chain
 * was never run -- which reads as a regression and was mistaken for one
 * during #674's verification.
 */
export async function countActiveReferenceDatasetReleasesByDatasetCode(datasetCode: string): Promise<number> {
  const db = await getDb();
  return db.collection('referenceDatasetReleases').countDocuments({ datasetCode, releaseStatus: 'active' });
}

/** Same rationale as countReferenceDatasetReleasesByDatasetCode, for concepts — filtered by systemUri since TerminologyConcept doesn't carry datasetCode directly (dict-02_DICIONARIO.md's logical key is systemUri+code+version). */
export async function countTerminologyConceptsBySystemUri(systemUri: string): Promise<number> {
  const db = await getDb();
  return db.collection('terminologyConcepts').countDocuments({ systemUri });
}

/**
 * RF022 AC9, RNF014 C7: the newest ReadinessReport the Foundation job wrote
 * for an environment. The API starts only when it is `ready`.
 */
export async function latestReadinessReport(environment = 'test'): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('readinessReports').find({ environment }).sort({ generatedAt: -1 }).limit(1).next();
}

/** RF022 AC2: the index names a collection carries, read from Mongo itself. */
export async function indexNamesOf(collection: string): Promise<string[]> {
  const db = await getDb();
  const indexes = await db.collection(collection).listIndexes().toArray();
  return indexes.map((index) => index.name as string);
}
