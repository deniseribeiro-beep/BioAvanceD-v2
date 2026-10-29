import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { backfillLocationsToStorage } = require('../../../src/services/location-storage-backfill.service');

// #1126: this service destructures ensureStorageContainerIndexes at require
// time, so a spy installed after load is never seen. Spy first, then reload.
const BACKFILL_SERVICE_PATH = require.resolve('../../../src/services/location-storage-backfill.service');
const storageIndexes = require('../../../src/utils/storageIndexes');

function reloadBackfillService() {
  delete require.cache[BACKFILL_SERVICE_PATH];
  return require(BACKFILL_SERVICE_PATH);
}

/**
 * Real query-matching fake — exact-match on scalar fields and `$in`, per this
 * repo's native-only "real backend" proof bar (this repo has no live-Mongo
 * tier). #1374: collections are created on demand, the client is a replica
 * set with sessions, and every write, index build and transaction is
 * recorded, in order, in one log.
 */
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
  let autoId = 1;
  return {
    name,
    docs,
    async createIndex(keys, options) { log.push({ collection: name, op: 'createIndex', options }); },
    async dropIndex() {},
    async insertOne(doc, options) {
      log.push({ collection: name, op: 'insertOne', options });
      const _id = doc._id || `${name}-${autoId++}`;
      docs.push({ _id, ...doc });
      return { insertedId: _id };
    },
    async updateOne(filter, update, options) {
      log.push({ collection: name, op: 'updateOne', options });
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
    async findOne(filter = {}) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
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
    collection(collectionName) {
      collections[collectionName] = collections[collectionName] || createFakeCollection(collectionName, log);
      return collections[collectionName];
    },
  };
  // The reader reads storageAssignments; the backfill must never write it.
  db.collection('storageAssignments');
  for (const [key, docs] of Object.entries(seed)) db.collection(key).docs.push(...docs);
  return db;
}

const CHAIN_COLLECTIONS = ['containers', 'specimenContainerAssignments', 'containerPositionAssignments', 'rackLocationAssignments', 'storageLocations'];
const chainWritesOf = (db) => db.log.filter((entry) => CHAIN_COLLECTIONS.includes(entry.collection) && entry.op !== 'createIndex');
const docsOf = (db, name) => db.collection(name).docs;

// The topology location 801 resolves to, already materialized, so a case
// can seed chain rows against a known box id.
const T1 = new Date('2026-01-01T00:00:00.000Z');
const LOCATION_801 = { locationID: 801, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' };
const TOPOLOGY = {
  storageContainers: [
    { _id: 'F1', containerType: 'FREEZER', containerID: 5, name: 'Freezer 5', parent_id: null },
    { _id: 'S1', containerType: 'SHELF', name: 'SHELF 1', parent_id: 'F1' },
    { _id: 'R1', containerType: 'RACK', name: 'RACK 2', parent_id: 'S1' },
  ],
  storageBoxes: [{ _id: 'B1', name: 'Box 3', parent_id: 'R1' }],
};

function loadedOnChain(specimenId, storagePositionId) {
  const rows = {
    containers: [{ containerId: 'CT-1', containerType: 'cryogenic_vial', emptyStatus: 'filled' }],
    specimenContainerAssignments: [{ specimenContainerAssignmentId: 'SCA-1', specimenId, containerId: 'CT-1', loadedAt: T1, unloadedAt: null, assignmentStatus: 'active' }],
  };
  if (storagePositionId) {
    rows.containerPositionAssignments = [{ containerPositionAssignmentId: 'CPA-1', containerId: 'CT-1', storagePositionId, placedAt: T1, removedAt: null, assignmentStatus: 'active' }];
  }
  return rows;
}

describe('location-storage-backfill.service', () => {
  it('materializes the FREEZER->SHELF->RACK->BOX chain and places a Sample.locationID specimen on the physical chain, not in storageAssignments (#1374)', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 101, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
      equipment: [{ equipmentID: 5, equipmentDescription: 'Ultra-Freezer 05', organizationId: 'org-1', deletedAt: null }],
      organizations: [{ organizationId: 'org-1' }],
      samples: [{ _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 101, registeredAt: new Date('2026-01-01') }],
    });

    const { summary, locationIdToBoxId } = await backfillLocationsToStorage(db);

    expect(summary.freezersCreated).toBe(1);
    expect(summary.shelvesCreated).toBe(1);
    expect(summary.racksCreated).toBe(1);
    expect(summary.drawersCreated).toBe(0);
    expect(summary.boxesCreated).toBe(1);
    expect(summary.specimensPlaced).toBe(1);
    expect(summary.skipped).toEqual([]);

    const freezer = db.collections.storageContainers.docs.find((c) => c.containerType === 'FREEZER');
    const shelf = db.collections.storageContainers.docs.find((c) => c.containerType === 'SHELF');
    const rack = db.collections.storageContainers.docs.find((c) => c.containerType === 'RACK');
    const box = db.collections.storageBoxes.docs[0];

    expect(freezer.containerID).toBe(5);
    expect(freezer.parent_id).toBeNull();
    expect(shelf.parent_id).toBe(freezer._id);
    expect(rack.parent_id).toBe(shelf._id);
    expect(box.parent_id).toBe(rack._id);

    expect(locationIdToBoxId.get(101)).toBe(box._id);

    const loads = docsOf(db, 'specimenContainerAssignments').filter((row) => row.assignmentStatus === 'active');
    expect(loads).toHaveLength(1);
    expect(loads[0].specimenId).toBe('SPC-2026-0001');
    const positions = docsOf(db, 'containerPositionAssignments').filter((row) => row.assignmentStatus === 'active');
    expect(positions).toHaveLength(1);
    expect(positions[0].containerId).toBe(loads[0].containerId);
    expect(positions[0].storagePositionId).toBe(`${String(box._id)}:A01`);
    expect(new Date(positions[0].placedAt).toISOString()).toBe(new Date('2026-01-01').toISOString());
    // The freezer's Equipment names a stored organization: the rack is located.
    expect(docsOf(db, 'rackLocationAssignments').filter((row) => row.storageRackId === String(box._id))).toHaveLength(1);

    expect(db.collections.storageAssignments.docs).toHaveLength(0);
    expect(db.log.filter((entry) => entry.collection === 'storageAssignments')).toEqual([]);
  });

  it('#1374: with no organization the chain ends at the rack, and the placement still lands', async () => {
    const db = createFakeDb({
      locations: [{ ...LOCATION_801 }],
      samples: [{ _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 }],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(1);
    expect(docsOf(db, 'containerPositionAssignments')).toHaveLength(1);
    expect(docsOf(db, 'rackLocationAssignments')).toHaveLength(0);
    expect(docsOf(db, 'storageLocations')).toHaveLength(0);
    expect(db.collections.storageAssignments.docs).toHaveLength(0);
  });

  it('#1374: every chain write carries the session of the transaction it ran in', async () => {
    const db = createFakeDb({
      ...TOPOLOGY,
      locations: [{ ...LOCATION_801 }, { ...LOCATION_801, locationID: 802, wellPosition: 'B2' }],
      equipment: [{ equipmentID: 5, organizationId: 'org-1', deletedAt: null }],
      organizations: [{ organizationId: 'org-1' }],
      samples: [
        { _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 },
        { _id: 'sample-2', specimenId: 'SPC-2026-0002', locationID: 802, registeredAt: T1 },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(2);
    expect(db.sessions).toHaveLength(2);
    const writes = chainWritesOf(db);
    expect(writes.length).toBeGreaterThan(0);
    let open = null;
    for (const entry of db.log) {
      if (entry.op === 'transaction') open = entry.session;
      else if (writes.includes(entry)) expect(entry.options?.session).toBe(open);
    }
    expect(writes.every((entry) => entry.options?.session)).toBe(true);
  });

  it('#1374: every index is built before the first transaction', async () => {
    const db = createFakeDb({
      ...TOPOLOGY,
      locations: [{ ...LOCATION_801 }],
      samples: [{ _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 }],
    });

    await backfillLocationsToStorage(db);

    const firstTransaction = db.log.findIndex((entry) => entry.op === 'transaction');
    expect(firstTransaction).toBeGreaterThan(-1);
    const indexBuilds = db.log.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.op === 'createIndex');
    expect(indexBuilds.length).toBeGreaterThan(0);
    expect(indexBuilds.every(({ index }) => index < firstTransaction)).toBe(true);
  });

  it('routes the box through a DRAWER when the legacy location has one', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 202, equipmentID: 5, block: 1, rack: 2, drawer: 7, box: 3, wellPosition: 'B2' },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.drawersCreated).toBe(1);
    expect(summary.boxesCreated).toBe(1);

    const drawer = db.collections.storageContainers.docs.find((c) => c.containerType === 'DRAWER');
    const rack = db.collections.storageContainers.docs.find((c) => c.containerType === 'RACK');
    const box = db.collections.storageBoxes.docs[0];

    expect(drawer.parent_id).toBe(rack._id);
    expect(box.parent_id).toBe(drawer._id);
  });

  it('backfills a single synthetic SHELF per freezer when block is null, without inventing a "no shelf" branch', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 301, equipmentID: 9, block: null, rack: 1, drawer: null, box: 1, wellPosition: 'A1' },
        { locationID: 302, equipmentID: 9, block: null, rack: 1, drawer: null, box: 2, wellPosition: 'A2' },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.freezersCreated).toBe(1);
    expect(summary.shelvesCreated).toBe(1); // both locations share the synthetic SHELF
    expect(summary.racksCreated).toBe(1);
    expect(summary.boxesCreated).toBe(2);
  });

  it('reuses existing containers/boxes across distinct locations sharing the same tuple prefix (idempotent chain materialization)', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 401, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
        { locationID: 402, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A2' },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.freezersCreated).toBe(1);
    expect(summary.shelvesCreated).toBe(1);
    expect(summary.racksCreated).toBe(1);
    expect(summary.boxesCreated).toBe(1);
    expect(db.collections.storageBoxes.docs).toHaveLength(1);
  });

  it('skips a location missing equipmentID or rack rather than inventing a fallback, and records the skip', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 501, equipmentID: null, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
        { locationID: 502, equipmentID: 5, block: 1, rack: null, drawer: null, box: 3, wellPosition: 'A1' },
      ],
    });

    const { summary, locationIdToBoxId } = await backfillLocationsToStorage(db);

    expect(summary.boxesCreated).toBe(0);
    expect(summary.skipped).toHaveLength(2);
    expect(locationIdToBoxId.has(501)).toBe(false);
    expect(locationIdToBoxId.has(502)).toBe(false);
  });

  it('does not touch the `locations` collection (read-only)', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 601, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
    });
    const before = JSON.stringify(db.collections.locations.docs);

    await backfillLocationsToStorage(db);

    expect(JSON.stringify(db.collections.locations.docs)).toBe(before);
  });

  it('is safe to run twice: a second run writes nothing and counts the specimen as already placed (#1374)', async () => {
    const db = createFakeDb({
      locations: [
        { locationID: 701, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
      samples: [{ _id: 'sample-7', specimenId: 'SPC-2026-0007', locationID: 701, registeredAt: new Date('2026-01-01') }],
    });

    await backfillLocationsToStorage(db);
    const logLength = db.log.length;
    const secondRun = await backfillLocationsToStorage(db);

    expect(db.log.slice(logLength).filter((entry) => entry.op !== 'createIndex')).toEqual([]);
    expect(secondRun.summary.specimensPlaced).toBe(0);
    expect(secondRun.summary.alreadyPlaced).toBe(1);
    expect(docsOf(db, 'containerPositionAssignments')).toHaveLength(1);
    expect(db.collections.storageAssignments.docs).toHaveLength(0);
  });

  it('#1374: a specimen loaded on the chain with no open position was released there, and a stale locationID does not place it again', async () => {
    const db = createFakeDb({
      ...TOPOLOGY,
      ...loadedOnChain('SPC-2026-0001', null),
      locations: [{ ...LOCATION_801 }],
      samples: [{ _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 }],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(0);
    expect(summary.skipped).toEqual([{ locationID: 801, specimenId: 'SPC-2026-0001', reason: 'released on the chain' }]);
    expect(chainWritesOf(db)).toEqual([]);
    expect(db.log.filter((entry) => entry.op === 'transaction')).toEqual([]);
  });

  it("#1374: a specimen with an open legacy row at the same box and position is placed on the chain from the row's placedAt", async () => {
    const legacyPlacedAt = new Date('2025-06-01T00:00:00.000Z');
    const legacyRow = { storageAssignmentId: 'sa-1', specimenId: 'sample-1', boxId: 'B1', positionCode: 'A1', placedAt: legacyPlacedAt, removedAt: null };
    const db = createFakeDb({
      ...TOPOLOGY,
      storageAssignments: [legacyRow],
      locations: [{ ...LOCATION_801 }],
      samples: [{ _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 }],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(1);
    const [position] = docsOf(db, 'containerPositionAssignments');
    expect(position.storagePositionId).toBe('B1:A01');
    expect(new Date(position.placedAt).toISOString()).toBe(legacyPlacedAt.toISOString());
    expect(db.collections.storageAssignments.docs).toEqual([legacyRow]);
    expect(db.log.filter((entry) => entry.collection === 'storageAssignments')).toEqual([]);
  });

  it('#1374: a specimen the chain already places elsewhere is skipped with a reason, with no write', async () => {
    const db = createFakeDb({
      ...TOPOLOGY,
      ...loadedOnChain('SPC-2026-0001', 'B9:C03'),
      locations: [{ ...LOCATION_801 }],
      samples: [{ _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 }],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(0);
    expect(summary.alreadyPlaced).toBe(0);
    expect(summary.skipped).toEqual([{ locationID: 801, specimenId: 'SPC-2026-0001', reason: 'already placed at B9/C3' }]);
    expect(chainWritesOf(db)).toEqual([]);
  });

  it('#1374: a location with no wellPosition skips its samples with a reason', async () => {
    const db = createFakeDb({
      ...TOPOLOGY,
      locations: [{ ...LOCATION_801, wellPosition: null }, { ...LOCATION_801, locationID: 802, wellPosition: '  ' }],
      samples: [
        { _id: 'sample-1', specimenId: 'SPC-2026-0001', locationID: 801, registeredAt: T1 },
        { _id: 'sample-2', locationID: 802, registeredAt: T1 },
      ],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(0);
    expect(summary.skipped).toEqual([
      { locationID: 801, specimenId: 'SPC-2026-0001', reason: 'missing wellPosition' },
      { locationID: 802, specimenId: 'sample-2', reason: 'missing wellPosition' },
    ]);
    expect(chainWritesOf(db)).toEqual([]);
  });

  it('#1374: a sample with no specimenId is keyed on the chain by its _id', async () => {
    const db = createFakeDb({
      ...TOPOLOGY,
      locations: [{ ...LOCATION_801 }],
      samples: [{ _id: 'sample-1', locationID: 801, registeredAt: T1 }],
    });

    const { summary } = await backfillLocationsToStorage(db);

    expect(summary.specimensPlaced).toBe(1);
    expect(docsOf(db, 'specimenContainerAssignments').map((row) => row.specimenId)).toEqual(['sample-1']);
  });

  // #1070: this service is the ONLY thing in src/ that inserts into
  // `storageContainers` -- [ran it] every other reference across the eight
  // files touching that collection is a findOne/find/updateOne, and
  // storage.routes.js's PATCH /freezer/:id/room 404s rather than upserting.
  // So until this ran, the storage topology could not exist at all, and
  // `sample.service.js`, `intakeWizard.js`, `import-lgpd.service.js` and
  // `equipment-sensor-quarantine.service.js` all join on a freezer's
  // `containerID` that nothing had written.
  //
  // And it was reachable only through src/scripts/backfillLocationStorage.js,
  // which had no npm script, no compose service and no boot path -- the
  // #933 shape the mfa scripts were wired for, and the class this repo's
  // conventions name outright: a script under src/scripts/ that is neither
  // an npm script nor invoked by a boot path or compose service never runs
  // on any stack.
  //
  // Whether an API should be able to create a container at all is a
  // separate and larger question -- #1124.
  // #1126: the sibling half of the sensor.service.test.js case. Nothing
  // asserted this helper was ever CALLED, so deleting the call site left the
  // suite green -- #941's defect one level up, where a written and tested fix
  // is never reached. backfillLocationsToStorage is the only production path
  // to it, which is what makes one assertion sufficient here.
  it('#1126: ensures the storageContainers indexes on the write path', async () => {
    const ensureSpy = vi
      .spyOn(storageIndexes, 'ensureStorageContainerIndexes')
      .mockImplementation(() => {});
    const { backfillLocationsToStorage: freshBackfill } = reloadBackfillService();

    const db = createFakeDb({
      locations: [
        { locationID: 701, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
      samples: [],
    });

    await freshBackfill(db);

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy.mock.calls[0][0]).toBe(db.collections.storageContainers);

    ensureSpy.mockRestore();
  });

  // #1163: the same assertion for the storageBoxes helper, which #941's
  // lookup-index work added beside the one above and which was unpinned --
  // deleting its wiring line left the whole suite green, which is exactly
  // the recurrence #1126 was closed to prevent.
  it('#1163: ensures the storageBoxes indexes on the write path', async () => {
    const ensureSpy = vi
      .spyOn(storageIndexes, 'ensureStorageBoxIndexes')
      .mockImplementation(() => {});
    const { backfillLocationsToStorage: freshBackfill } = reloadBackfillService();

    const db = createFakeDb({
      locations: [
        { locationID: 702, equipmentID: 5, block: 1, rack: 2, drawer: null, box: 3, wellPosition: 'A1' },
      ],
      samples: [],
    });

    await freshBackfill(db);

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy.mock.calls[0][0]).toBe(db.collections.storageBoxes);

    ensureSpy.mockRestore();
  });

  it('#1070: is wired as an npm script pointing at its CLI wrapper (#933: unwired scripts never effectively run)', () => {
    const pkg = require('../../../package.json');

    expect(pkg.scripts['migrate:location-storage']).toBe('node src/scripts/backfillLocationStorage.js');
  });
});
