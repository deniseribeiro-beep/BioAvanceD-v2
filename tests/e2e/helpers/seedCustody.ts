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

/** RF021 AC6: withdraws (or restores) the approval the custody rests on. */
export async function setApprovalStatus(approvalId: string, status: string): Promise<void> {
  const db = await getDb();
  await db.collection('collectionGovernanceApprovals').updateOne({ approvalId }, { $set: { status } });
}

export async function countScanEvents(specimenId: string): Promise<number> {
  const db = await getDb();
  return db.collection('scanEvents').countDocuments({ targetId: specimenId });
}

/** Removes every row the spec wrote, the assignments its routes created included. */
export async function cleanupCustodyFixture(fixture: CustodyFixture, containerIds: string[], rackIds: string[], labelValues: string[], deviceIds: string[], locationIds: string[] = []): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection('samples').deleteMany({ specimenId: fixture.specimenId }),
    db.collection('collections').deleteMany({ collectionId: fixture.collectionId }),
    db.collection('collectionGovernanceApprovals').deleteMany({ approvalId: fixture.approvalId }),
    db.collection('custodianshipAssignments').deleteMany({ specimenId: fixture.specimenId }),
    db.collection('specimenContainerAssignments').deleteMany({ specimenId: fixture.specimenId }),
    db.collection('scanEvents').deleteMany({ targetId: fixture.specimenId }),
    db.collection('containers').deleteMany({ containerId: { $in: containerIds } }),
    db.collection('containerPositionAssignments').deleteMany({ containerId: { $in: containerIds } }),
    db.collection('rackLocationAssignments').deleteMany({ storageRackId: { $in: rackIds } }),
    db.collection('labelIdentifiers').deleteMany({ encodedValue: { $in: labelValues } }),
    db.collection('devices').deleteMany({ deviceId: { $in: deviceIds } }),
    db.collection('deviceLifecycleEvents').deleteMany({ deviceId: { $in: deviceIds } }),
    db.collection('storageLocations').deleteMany({ storageLocationId: { $in: locationIds } }),
    db.collection('legalHolds').deleteMany({ targetEntityIds: fixture.specimenId }),
  ]);
}
