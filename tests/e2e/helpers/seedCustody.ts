import { MongoClient, Db } from 'mongodb';

/**
 * #1314/#1316 fixture for physical-chain.spec.ts: a specimen, its biobank
 * collection and an approval in force, written to the test stack's Mongo the
 * way seedParticipant.ts does (same URI, same direct connection).
 *
 * Deliberately reference stubs, like seedRawSpecimen: the custody service
 * reads the specimen's specimenId, collectionId and collectionSite, the
 * collection's regime and context, and the approval's collection, status
 * and effectivePeriod, and nothing else. A full sample would need the
 * participant, consent, sensor and storage tree the create route gates on,
 * none of which the chain or custody reads.
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

export async function closeCustodyDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export type CustodyFixture = { specimenId: string; collectionId: string; approvalId: string };

export async function seedCustodyFixture(suffix: string, collectionSite: string): Promise<CustodyFixture> {
  const db = await getDb();
  const fixture = {
    specimenId: `SPC-CHAIN-${suffix}`,
    collectionId: `COL-CHAIN-${suffix}`,
    approvalId: `APPR-CHAIN-${suffix}`,
  };
  await db.collection('samples').insertOne({
    specimenId: fixture.specimenId, collectionId: fixture.collectionId, collectionSite, createdAt: new Date(),
  });
  await db.collection('collections').insertOne({
    collectionId: fixture.collectionId, governanceRegime: 'biobank', governanceContext: {}, createdAt: new Date(),
  });
  await db.collection('collectionGovernanceApprovals').insertOne({
    approvalId: fixture.approvalId,
    collectionId: fixture.collectionId,
    status: 'active',
    effectivePeriod: { start: '2025-01-01T00:00:00.000Z', end: null },
    createdAt: new Date(),
  });
  return fixture;
}

/** #1509 (RF026 AC6): an ethics approval in force, named by the fixture collection's governanceContext; returns its id. */
export async function seedEthicsApproval(fixture: CustodyFixture): Promise<string> {
  const db = await getDb();
  const ethicsApprovalId = `${fixture.approvalId}-ETH`;
  await db.collection('collectionGovernanceApprovals').insertOne({
    approvalId: ethicsApprovalId,
    collectionId: fixture.collectionId,
    status: 'active',
    effectivePeriod: { start: '2025-01-01T00:00:00.000Z', end: null },
    createdAt: new Date(),
  });
  await db.collection('collections').updateOne(
    { collectionId: fixture.collectionId },
    { $set: { 'governanceContext.ethicsApprovalId': ethicsApprovalId } }
  );
  return ethicsApprovalId;
}

/** RF021 AC6: withdraws (or restores) the approval the custody rests on. */
export async function setApprovalStatus(approvalId: string, status: string): Promise<void> {
  const db = await getDb();
  await db.collection('collectionGovernanceApprovals').updateOne({ approvalId }, { $set: { status } });
}

export async function countScanEvents(specimenId: string): Promise<number> {
  const db = await getDb();
  return db.collection('scanEvents').countDocuments({ targetId: specimenId });
}

/** RF016 AC1: every Specimen row, so a flow can show it created none. */
export async function countSamples(): Promise<number> {
  const db = await getDb();
  return db.collection('samples').countDocuments({});
}

/** RF016 AC1: a container's content status and how many specimen assignments it ever held. */
export async function containerContent(containerId: string): Promise<{ emptyStatus: string | null; specimenAssignments: number }> {
  const db = await getDb();
  const container = await db.collection('containers').findOne({ containerId });
  const specimenAssignments = await db.collection('specimenContainerAssignments').countDocuments({ containerId });
  return { emptyStatus: container ? (container.emptyStatus ?? null) : null, specimenAssignments };
}

/**
 * RF016 AC5: a rack's linear code. No route issues a rack's label (the
 * container label route fixes the target to `container`), so the rack's
 * code_128 LabelIdentifier is written here, the way the specimen stub above is.
 */
export async function seedRackLabel(storageRackId: string, encodedValue: string, suffix: string): Promise<void> {
  const db = await getDb();
  await db.collection('labelIdentifiers').insertOne({
    labelIdentifierId: `LBL-RACK-${suffix}`,
    encodedValue,
    symbology: 'code_128',
    targetType: 'storage_rack',
    targetId: storageRackId,
    status: 'active',
    checksum: null,
    issuedAt: new Date(),
    issuedBy: 'e2e-seed',
    templateVersionId: 'tpl-chain',
    printBatchId: `batch-rack-${suffix}`,
    replacesIdentifierId: null,
    identifierOrigin: 'institution_applied',
    namespaceRegistryId: 'ns-chain',
    carrierPlacement: 'front',
    immutableAtSource: true,
  });
}

/** Removes every row the spec wrote, the assignments its routes created included. */
export async function cleanupCustodyFixture(fixture: CustodyFixture, containerIds: string[], rackIds: string[], labelValues: string[], deviceIds: string[], locationIds: string[] = []): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('samples').deleteMany({ specimenId: fixture.specimenId }),
    db.collection('collections').deleteMany({ collectionId: fixture.collectionId }),
    db.collection('collectionGovernanceApprovals').deleteMany({ approvalId: { $in: [fixture.approvalId, `${fixture.approvalId}-ETH`] } }),
    db.collection('custodianshipAssignments').deleteMany({ specimenId: fixture.specimenId }),
    db.collection('specimenContainerAssignments').deleteMany({ specimenId: fixture.specimenId }),
    db.collection('scanEvents').deleteMany({ targetId: fixture.specimenId }),
    db.collection('containers').deleteMany({ containerId: { $in: containerIds } }),
    db.collection('containerPositionAssignments').deleteMany({ containerId: { $in: containerIds } }),
    db.collection('rackLocationAssignments').deleteMany({ storageRackId: { $in: rackIds } }),
    db.collection('storageRacks').deleteMany({ storageRackId: { $in: rackIds } }),
    db.collection('storagePositions').deleteMany({ storageRackId: { $in: rackIds } }),
    db.collection('labelIdentifiers').deleteMany({ encodedValue: { $in: labelValues } }),
    db.collection('devices').deleteMany({ deviceId: { $in: deviceIds } }),
    db.collection('deviceLifecycleEvents').deleteMany({ deviceId: { $in: deviceIds } }),
    db.collection('storageLocations').deleteMany({ storageLocationId: { $in: locationIds } }),
    db.collection('legalHolds').deleteMany({ targetEntityIds: fixture.specimenId }),
    db.collection('telemetryExposureSummaries').deleteMany({ specimenId: fixture.specimenId }),
  ]);
}

/** #1392: the TelemetryExposureSummaries stored for a specimen, oldest window first. */
export async function findExposureSummaries(specimenId: string): Promise<any[]> {
  const db = await getDb();
  return db.collection('telemetryExposureSummaries').find({ specimenId }).sort({ windowStart: 1 }).toArray();
}
