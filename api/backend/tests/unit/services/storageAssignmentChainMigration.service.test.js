import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ObjectId } = require('mongodb');
const { migrateStorageAssignmentsToChain } = require('../../../src/services/storageAssignmentChainMigration.service');

// #1314: the query-matching fake of legacyPlacementChain.service.test.js,
// with `distinct` and a replica-set client. Every write, index build and
// transaction is recorded, in order, in one log.
function same(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') return String(a) === String(b);
  return false;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value === null) return doc[key] === null || doc[key] === undefined;
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.some((option) => same(doc[key], option));
    return same(doc[key], value);
  });
}

function createFakeCollection(name, log) {
  const docs = [];
  return {
    docs,
    async createIndex(keys, options) { log.push({ collection: name, op: 'createIndex', options }); },
    async insertOne(doc, options) {
      log.push({ collection: name, op: 'insertOne', options });
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    async updateOne(filter, update, options) {
      log.push({ collection: name, op: 'updateOne', options });
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    async deleteOne(filter, options) { log.push({ collection: name, op: 'deleteOne', options }); return { deletedCount: 0 }; },
    async deleteMany(filter, options) { log.push({ collection: name, op: 'deleteMany', options }); return { deletedCount: 0 }; },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
    async distinct(field) { return [...new Set(docs.map((doc) => doc[field]))]; },
  };
}

function createFakeDb(seed = {}) {
  const collections = {};
  const log = [];
  const sessions = [];
  const client = {
    db: () => ({ command: async () => ({ setName: 'rs0' }) }),
    startSession() {
      const session = {
        id: `session-${sessions.length + 1}`,
        async withTransaction(body) {
          log.push({ op: 'transaction', session });
          await body();
        },
        async endSession() {},
      };
      sessions.push(session);
      return session;
    },
  };
  const db = {
    client,
    collections,
    log,
    sessions,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection(name, log);
      return collections[name];
    },
  };
  for (const [name, docs] of Object.entries(seed)) db.collection(name).docs.push(...docs);
  return db;
}

const writesOf = (db) => db.log.filter((entry) => entry.op !== 'transaction' && entry.op !== 'createIndex');

// FREEZER -> SHELF -> RACK -> two boxes. The freezer's Equipment names org-1.
const BOX_1 = { _id: new ObjectId('64b000000000000000000001'), name: 'Caixa 1', parent_id: 'R1' };
const BOX_2 = { _id: new ObjectId('64b000000000000000000002'), name: 'Caixa 2', parent_id: 'R1' };
const SAMPLE_A = { _id: new ObjectId('64a000000000000000000001'), specimenId: 'SPC-2026-0001', primaryContainer: 'cryogenic_vial' };
const SAMPLE_B = { _id: new ObjectId('64a000000000000000000002'), specimenId: 'SPC-2026-0002', primaryContainer: 'cryogenic_vial' };
const T = (day) => new Date(`2026-10-0${day}T00:00:00.000Z`);

function seed(extraRows = []) {
  return {
    organizations: [{ organizationId: 'org-1' }],
    equipment: [{ equipmentID: 4201, organizationId: 'org-1', deletedAt: null }],
    storageContainers: [
      { _id: 'F1', containerType: 'FREEZER', containerID: 4201, name: 'Freezer 1', parent_id: null },
      { _id: 'S1', containerType: 'SHELF', name: 'Prateleira 1', parent_id: 'F1' },
      { _id: 'R1', containerType: 'RACK', name: 'Rack 1', parent_id: 'S1' },
    ],
    storageBoxes: [BOX_1, BOX_2],
    samples: [SAMPLE_A, SAMPLE_B],
    storageAssignments: [
      { storageAssignmentId: 'sa-1', specimenId: String(SAMPLE_A._id), boxId: String(BOX_1._id), positionCode: 'A1', placedAt: T(1), removedAt: T(3) },
      { storageAssignmentId: 'sa-2', specimenId: String(SAMPLE_A._id), boxId: String(BOX_2._id), positionCode: 'B2', placedAt: T(3), removedAt: null },
      { storageAssignmentId: 'sb-1', specimenId: String(SAMPLE_B._id), boxId: String(BOX_1._id), positionCode: 'C3', placedAt: T(2), removedAt: null },
      ...extraRows,
    ],
  };
}

const CHAIN_INDEXED = ['containers', 'specimenContainerAssignments', 'containerPositionAssignments', 'rackLocationAssignments', 'storageLocations'];

describe('storageAssignmentChainMigration.service (#1314)', () => {
  it('migrates every specimen with rows into the chain and never writes storageAssignments', async () => {
    const db = createFakeDb(seed());
    const rowsBefore = db.collections.storageAssignments.docs.map((row) => ({ ...row }));

    expect(await migrateStorageAssignmentsToChain(db)).toEqual({ specimensMigrated: 2, assignmentsDecomposed: 3, alreadyMigrated: 0, skipped: [] });

    expect(db.collections.specimenContainerAssignments.docs.map(({ specimenId, sourceEventId }) => ({ specimenId, sourceEventId }))).toEqual([
      { specimenId: 'SPC-2026-0001', sourceEventId: 'legacy-storage-assignment:sa-1' },
      { specimenId: 'SPC-2026-0002', sourceEventId: 'legacy-storage-assignment:sb-1' },
    ]);
    expect(db.collections.containerPositionAssignments.docs.map(({ storagePositionId, placedAt, removedAt }) => ({ storagePositionId, placedAt, removedAt }))).toEqual([
      { storagePositionId: '64b000000000000000000001:A01', placedAt: T(1), removedAt: T(3) },
      { storagePositionId: '64b000000000000000000002:B02', placedAt: T(3), removedAt: null },
      { storagePositionId: '64b000000000000000000001:C03', placedAt: T(2), removedAt: null },
    ]);
    expect(db.collections.rackLocationAssignments.docs.map(({ storageRackId }) => storageRackId)).toEqual([
      '64b000000000000000000001', '64b000000000000000000002',
    ]);
    expect(db.log.filter((entry) => entry.collection === 'storageAssignments')).toEqual([]);
    expect(db.collections.storageAssignments.docs).toEqual(rowsBefore);
  });

  it('a second run adopts nothing new and counts the specimens as already migrated', async () => {
    const db = createFakeDb(seed());
    await migrateStorageAssignmentsToChain(db);
    const writesAfterFirst = writesOf(db).length;

    expect(await migrateStorageAssignmentsToChain(db)).toEqual({ specimensMigrated: 0, assignmentsDecomposed: 0, alreadyMigrated: 2, skipped: [] });
    expect(writesOf(db)).toHaveLength(writesAfterFirst);
  });

  it('skips, with a reason, a row whose sample is missing and a row keyed by the canonical specimenId', async () => {
    const db = createFakeDb(seed([
      { storageAssignmentId: 'sg-1', specimenId: 'ghost-sample', boxId: String(BOX_2._id), positionCode: 'D4', placedAt: T(1), removedAt: null },
      { storageAssignmentId: 'sc-1', specimenId: 'SPC-2026-0002', boxId: String(BOX_2._id), positionCode: 'E5', placedAt: T(1), removedAt: null },
    ]));

    const summary = await migrateStorageAssignmentsToChain(db);

    expect(summary).toMatchObject({ specimensMigrated: 2, assignmentsDecomposed: 3, alreadyMigrated: 0 });
    expect(summary.skipped).toEqual([
      { specimenId: 'ghost-sample', reason: expect.stringContaining('not found') },
      { specimenId: 'SPC-2026-0002', reason: expect.stringContaining('canonical specimenId') },
    ]);
    expect(db.collections.containerPositionAssignments.docs.map(({ storagePositionId }) => storagePositionId))
      .not.toContain('64b000000000000000000002:D04');
  });

  it('dryRun writes nothing, opens no transaction, and reports what a run would adopt', async () => {
    const db = createFakeDb(seed());

    const planned = await migrateStorageAssignmentsToChain(db, { dryRun: true });

    expect(planned).toEqual({ specimensMigrated: 2, assignmentsDecomposed: 3, alreadyMigrated: 0, skipped: [] });
    expect(db.log).toEqual([]);
    expect(await migrateStorageAssignmentsToChain(db)).toEqual(planned);
    expect(await migrateStorageAssignmentsToChain(db, { dryRun: true })).toEqual({ specimensMigrated: 0, assignmentsDecomposed: 0, alreadyMigrated: 2, skipped: [] });
  });

  it('builds the chain indexes before the first transaction opens, and none after', async () => {
    const db = createFakeDb(seed());

    await migrateStorageAssignmentsToChain(db);

    const firstTransaction = db.log.findIndex((entry) => entry.op === 'transaction');
    const indexBuilds = db.log.map((entry, at) => ({ ...entry, at })).filter((entry) => entry.op === 'createIndex');
    expect(firstTransaction).toBeGreaterThan(0);
    expect([...new Set(indexBuilds.map((entry) => entry.collection))].sort()).toEqual([...CHAIN_INDEXED].sort());
    expect(indexBuilds.filter((entry) => entry.at > firstTransaction)).toEqual([]);
  });

  it('adopts each specimen in its own transaction, every chain write in the session of that transaction', async () => {
    const db = createFakeDb(seed());

    await migrateStorageAssignmentsToChain(db);

    expect(db.sessions).toHaveLength(2);
    expect(db.log.filter((entry) => entry.op === 'transaction').map((entry) => entry.session)).toEqual(db.sessions);
    const writes = writesOf(db);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.filter((entry) => !db.sessions.includes(entry.options?.session))).toEqual([]);
    // Each transaction's writes run between its own start and the next one's.
    let current = null;
    for (const entry of db.log) {
      if (entry.op === 'transaction') current = entry.session;
      else if (entry.op !== 'createIndex') expect(entry.options.session).toBe(current);
    }
  });
});
