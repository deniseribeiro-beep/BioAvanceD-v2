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
 * (sampleTypes/terminologies via miabis-minimal/sprec-minimal). The Phase 2
 * job populates them after Foundation and before the API (RF022 AC7).
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
 * RF022 AC7: the Phase 2 job (load-essential-references.js, the stack's
 * `essential-reference-bootstrap-test`) loads the essential set and records
 * one ReferenceImportRun per manifest entry. Newest first.
 */
export async function essentialReferenceImportRuns(): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('referenceImportRuns')
    .find({ initiatedBy: 'system:essential-reference-load' })
    .sort({ startedAt: -1 })
    .toArray();
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
 * #1304 (plano §4 F1.2): the CanonicalModelRelease and the
 * GovernanceInvariantCatalog the Foundation job registered for a release.
 */
export async function governanceRegistry(canonicalModelReleaseId: string): Promise<{
  release: Record<string, any> | null;
  catalogs: Record<string, any>[];
}> {
  const db = await getDb();
  const release = await db.collection('canonicalModelReleases').findOne({ canonicalModelReleaseId });
  const catalogs = await db.collection('governanceInvariantCatalogs').find({ canonicalModelReleaseId }).toArray();
  return { release, catalogs };
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
 * RF028/RNF032 (#1476): the reference release lifecycle's own records, read
 * from Mongo for the same reason as above: no route reads them back.
 */
export async function findReferenceRelease(referenceDatasetReleaseId: string): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('referenceDatasetReleases').findOne({ referenceDatasetReleaseId });
}

/** Every ReferenceImportRun of a release, any importMode (full, dry_run, rollback). */
export async function referenceImportRunsForRelease(referenceDatasetReleaseId: string): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('referenceImportRuns').find({ referenceDatasetReleaseId }).toArray();
}

/** The ReferenceImportIssues (the quarantine) one import run recorded. */
export async function referenceImportIssuesForRun(referenceImportRunId: string): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('referenceImportIssues').find({ referenceImportRunId }).toArray();
}

/** The staging rows one import run wrote, concepts and relations together. */
export async function countReferenceImportStagingForRun(referenceImportRunId: string): Promise<number> {
  const db = await getDb();
  return db.collection('referenceImportStaging').countDocuments({ referenceImportRunId });
}

/** The staging rows one import run wrote, as documents (entityType and candidate). */
export async function referenceImportStagingForRun(referenceImportRunId: string): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('referenceImportStaging').find({ referenceImportRunId }).toArray();
}

export async function findReferenceCoverageManifest(referenceCoverageManifestId: string): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('referenceCoverageManifests').findOne({ referenceCoverageManifestId });
}

export async function findDataQualityAssessment(dataQualityAssessmentId: string): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('dataQualityAssessments').findOne({ dataQualityAssessmentId });
}

export async function terminologyConceptsBySystemUri(systemUri: string): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('terminologyConcepts').find({ systemUri }).toArray();
}

export async function countTerminologyRelationsByRelease(referenceDatasetReleaseId: string): Promise<number> {
  const db = await getDb();
  return db.collection('terminologyRelations').countDocuments({ referenceDatasetReleaseId });
}

/** The audit log entry auditLogger wrote for an action on a resource, newest first. */
export async function findAuditLog(action: string, resourceId: string): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('logs').find({ action, resourceId }).sort({ createdAt: -1 }).limit(1).next();
}

/**
 * RF022 AC9, RNF014 C7: the newest ReadinessReport the Foundation job wrote
 * for an environment. The API starts only when it is `ready`.
 */
export async function latestReadinessReport(environment = 'test'): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('readinessReports').find({ environment }).sort({ generatedAt: -1 }).limit(1).next();
}

/**
 * RF019 AC1/AC4 (#1315): the InvariantViolations a refused configuration
 * candidate recorded, keyed by its release id. No route reads them.
 */
export async function invariantViolationsFor(correlationId: string): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('invariantViolations').find({ correlationId }).toArray();
}

/**
 * RF014 AC7, CFG-008 (#1487): the ConfigurationChangeEvents one configuration
 * release recorded, in the order they were written. No route reads them.
 */
export async function configurationChangeEventsFor(releaseId: string): Promise<Record<string, any>[]> {
  const db = await getDb();
  return db.collection('configurationChangeEvents').find({ releaseId }).sort({ _id: 1 }).toArray();
}

/**
 * RF014 AC3: one ConfigurationValidationRun, read by its id, with its four
 * gate results. No route reads a run back.
 */
export async function configurationValidationRunById(configurationValidationRunId: string): Promise<Record<string, any> | null> {
  const db = await getDb();
  return db.collection('configurationValidationRuns').findOne({ configurationValidationRunId });
}

/** RF022 AC2: the index names a collection carries, read from Mongo itself. */
export async function indexNamesOf(collection: string): Promise<string[]> {
  const db = await getDb();
  const indexes = await db.collection(collection).listIndexes().toArray();
  return indexes.map((index) => index.name as string);
}

/**
 * #1485: the foundation-runs test-support route runs the Foundation job
 * against an e2e_foundation_ scratch database on the same Mongo server,
 * never the stack's own; these read and seed that database.
 */
async function scratchDb(database: string): Promise<Db> {
  await getDb();
  return client!.db(database);
}
export async function insertScratchFoundationDataRun(database: string, run: Record<string, unknown>): Promise<void> {
  await (await scratchDb(database)).collection('foundationDataRuns').insertOne(run);
}
export async function scratchFoundationDataRun(database: string, foundationDataRunId: string): Promise<Record<string, any> | null> {
  return (await scratchDb(database)).collection('foundationDataRuns').findOne({ foundationDataRunId });
}
export async function countScratchFoundationEvidence(database: string): Promise<{ runs: number; reports: number }> {
  const db = await scratchDb(database);
  return { runs: await db.collection('foundationDataRuns').countDocuments(), reports: await db.collection('readinessReports').countDocuments() };
}
export async function setScratchGovernanceChecksum(database: string, collection: 'canonicalModelReleases' | 'governanceInvariantCatalogs', canonicalModelReleaseId: string, checksum: string): Promise<void> {
  await (await scratchDb(database)).collection(collection).updateOne({ canonicalModelReleaseId }, { $set: { checksum } });
}
export async function dropScratchFoundationDb(database: string): Promise<void> {
  await (await scratchDb(database)).dropDatabase();
}
