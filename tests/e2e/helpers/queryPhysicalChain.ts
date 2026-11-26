import { MongoClient, Db, ObjectId } from 'mongodb';
import type { SeededStorageBox } from './seedParticipant';

/**
 * #1508 (RF016 AC3, RF017 AC3/AC4): reads the physical chain the legacy
 * storage routes write (allocate, move, auto-assign, release), straight from
 * the test stack's Mongo, the way seedCustody.ts connects (same URI, same
 * direct connection). The collection names are the backend's own physical
 * ones.
 *
 * The one write, setEquipmentOrganization, gives a seeded freezer's
 * equipment row the organization the legacy path resolves the rack's
 * StorageLocation from (P1X-0103); without it the chain ends at the rack.
 */

const mongoUri = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017?directConnection=true';
const mongoDbName = process.env.E2E_MONGO_DB || 'bioavanced_test';

const LOCATION_CODE_PREFIX = 'legacy-storage-container:';

let client: MongoClient | null = null;

async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
  }
  return client.db(mongoDbName);
}

export async function closeChainDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value as string | number | Date).toISOString();
}

/** Equipment.js carries organizationId as a model field, so the row stays model-valid. */
export async function setEquipmentOrganization(equipmentMongoId: string, organizationId: string): Promise<void> {
  const db = await getDb();
  await db.collection('equipment').updateOne({ _id: new ObjectId(equipmentMongoId) }, { $set: { organizationId } });
}

export type ChainLoadRow = {
  specimenContainerAssignmentId: string;
  containerId: string;
  assignmentStatus: string;
};

export type ChainPositionRow = {
  containerPositionAssignmentId: string;
  containerId: string;
  storagePositionId: string;
  assignmentStatus: string;
  placedAt: string;
  removedAt: string | null;
};

/** The specimen's container loads, and every position row of those containers, earliest placement first. */
export async function specimenChainRows(specimenId: string): Promise<{ loads: ChainLoadRow[]; positions: ChainPositionRow[] }> {
  const db = await getDb();
  const loadDocs = await db.collection('specimenContainerAssignments').find({ specimenId: String(specimenId) }).toArray();
  const loads = loadDocs.map((row) => ({
    specimenContainerAssignmentId: String(row.specimenContainerAssignmentId),
    containerId: String(row.containerId),
    assignmentStatus: String(row.assignmentStatus),
  }));
  const containerIds = loads.map((load) => load.containerId);
  const positionDocs = containerIds.length
    ? await db.collection('containerPositionAssignments').find({ containerId: { $in: containerIds } }).toArray()
    : [];
  const positions = positionDocs
    .map((row) => ({
      containerPositionAssignmentId: String(row.containerPositionAssignmentId),
      containerId: String(row.containerId),
      storagePositionId: String(row.storagePositionId),
      assignmentStatus: String(row.assignmentStatus),
      placedAt: iso(row.placedAt) as string,
      removedAt: iso(row.removedAt),
    }))
    .sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt));
  return { loads, positions };
}

export type RackLocationRow = {
  storageLocationId: string;
  assignmentStatus: string;
  placedAt: string | null;
  removedAt: string | null;
};

export async function rackLocationRows(storageRackId: string): Promise<RackLocationRow[]> {
  const db = await getDb();
  const rows = await db.collection('rackLocationAssignments').find({ storageRackId: String(storageRackId) }).toArray();
  return rows.map((row) => ({
    storageLocationId: String(row.storageLocationId),
    assignmentStatus: String(row.assignmentStatus),
    placedAt: iso(row.placedAt),
    removedAt: iso(row.removedAt),
  }));
}

export async function storageLocationById(storageLocationId: string): Promise<{ code: string; organizationId: string } | null> {
  const db = await getDb();
  const row = await db.collection('storageLocations').findOne({ storageLocationId: String(storageLocationId) });
  return row ? { code: String(row.code), organizationId: String(row.organizationId) } : null;
}

/** Legacy StorageAssignment rows keyed by any of the given specimen keys. */
export async function countStorageAssignments(keys: string[]): Promise<number> {
  const db = await getDb();
  return db.collection('storageAssignments').countDocuments({ specimenId: { $in: keys.map(String) } });
}

/** Removes the chain rows the legacy routes wrote for these specimens and boxes. */
export async function cleanupSpecimenChains(specimenIds: string[], boxes: SeededStorageBox[]): Promise<void> {
  const db = await getDb();
  const loads = await db.collection('specimenContainerAssignments').find({ specimenId: { $in: specimenIds.map(String) } }).toArray();
  const containerIds = [...new Set(loads.map((row) => String(row.containerId)))];
  const locationCodes = boxes.flatMap((box) => [box.freezerId, box.shelfId, box.rackId].map((id) => `${LOCATION_CODE_PREFIX}${id}`));
  await Promise.all([
    db.collection('specimenContainerAssignments').deleteMany({ specimenId: { $in: specimenIds.map(String) } }),
    db.collection('containers').deleteMany({ containerId: { $in: containerIds } }),
    db.collection('containerPositionAssignments').deleteMany({ containerId: { $in: containerIds } }),
    db.collection('rackLocationAssignments').deleteMany({ storageRackId: { $in: boxes.map((box) => box.boxId) } }),
    db.collection('storageLocations').deleteMany({ code: { $in: locationCodes } }),
  ]);
}
