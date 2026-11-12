import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const service = require('../../../src/services/physicalChain.service');

// #1314: a query-matching fake. Equality, `$or` and `$in` match the way Mongo
// does, so the overlap check reads the rows a real query would return.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some((branch) => matches(doc, branch));
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.includes(doc[key]);
    if (value && typeof value === 'object' && typeof value.$regex === 'string') return typeof doc[key] === 'string' && new RegExp(value.$regex).test(doc[key]);
    return doc[key] === value;
  });
}

function createFakeCollection() {
  const docs = [];
  const indexes = [];
  // Each write's options, so a case can read the session it carried.
  const writes = [];
  return {
    docs,
    indexes,
    writes,
    async createIndex(keys, options = {}) { indexes.push({ keys, options }); },
    async insertOne(doc, options) {
      writes.push({ op: 'insertOne', options });
      // The partial unique indexes: two open rows on one key are refused.
      for (const { keys, options } of indexes) {
        if (!options.unique) continue;
        const [field] = Object.keys(keys);
        const inScope = (row) => !options.partialFilterExpression || matches(row, options.partialFilterExpression);
        if (inScope(doc) && docs.some((row) => inScope(row) && row[field] === doc[field])) {
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }
      }
      docs.push({ ...doc });
      return { insertedId: docs.length };
    },
    async findOne(filter) { return docs.find((doc) => matches(doc, filter)) || null; },
    find(filter = {}) { return { toArray: async () => docs.filter((doc) => matches(doc, filter)) }; },
    async updateOne(filter, update, options) {
      writes.push({ op: 'updateOne', options });
      const doc = docs.find((row) => matches(row, filter));
      if (doc) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0 };
    },
  };
}

function createFakeDb() {
  const collections = {};
  return {
    collections,
    collection(name) {
      collections[name] = collections[name] || createFakeCollection();
      return collections[name];
    },
  };
}

async function expectRefusal(promise, code, statusCode) {
  await expect(promise).rejects.toMatchObject({ name: 'PhysicalChainError', code, statusCode });
}

const T = (iso) => new Date(`2026-10-0${iso}T00:00:00.000Z`);

describe('physicalChain.service (#1314, RF016 AC1/AC3, RF017 AC2-AC4)', () => {
  it('creates an empty container, and a load makes it occupied and an unload empty again', async () => {
    const db = createFakeDb();
    const container = await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    expect(container.emptyStatus).toBe('empty');

    const loaded = await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) });
    expect(loaded.assignmentStatus).toBe('active');
    expect(db.collections.containers.docs[0].emptyStatus).toBe('occupied');

    const unloaded = await service.unloadSpecimen(db, loaded.specimenContainerAssignmentId, T(2));
    expect(unloaded).toMatchObject({ assignmentStatus: 'ended', unloadedAt: T(2) });
    expect(db.collections.specimenContainerAssignments.docs[0]).toMatchObject({ assignmentStatus: 'ended', unloadedAt: T(2) });
    expect(db.collections.containers.docs[0].emptyStatus).toBe('empty');
  });

  it('refuses a duplicate container id, and a container without its type (1..1)', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await expectRefusal(service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' }), 'CONTAINER_EXISTS', 409);
    await expectRefusal(service.createContainer(db, { containerId: 'CT-2' }), 'VALIDATION_ERROR', 422);
  });

  it('RF017 AC4: refuses a second container for a specimen over an overlapping interval, the history included', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await service.createContainer(db, { containerId: 'CT-2', containerType: 'cryovial' });
    const first = await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) });

    await expectRefusal(
      service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-2', sourceEventId: 'evt-2', loadedAt: T(3) }),
      'ASSIGNMENT_OVERLAP', 409,
    );

    await service.unloadSpecimen(db, first.specimenContainerAssignmentId, T(5));
    // A back-dated load inside the closed interval [T1, T5) still overlaps it.
    await expectRefusal(
      service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-2', sourceEventId: 'evt-3', loadedAt: T(3), unloadedAt: T(4) }),
      'ASSIGNMENT_OVERLAP', 409,
    );
    // Half-open: a load at the unload instant does not overlap.
    const next = await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-2', sourceEventId: 'evt-4', loadedAt: T(5) });
    expect(next.containerId).toBe('CT-2');
  });

  it('a concurrent open load the check could not see meets the partial unique index as the same overlap', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) });
    const assignments = db.collections.specimenContainerAssignments;
    expect(assignments.indexes).toContainEqual({
      keys: { specimenId: 1 }, options: { unique: true, name: 'uniq_open_specimen', partialFilterExpression: { assignmentStatus: 'active' } },
    });

    // The writer reads before the other's insert lands: hide the open row from find.
    const find = assignments.find;
    assignments.find = () => ({ toArray: async () => [] });
    await expectRefusal(
      service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-2', loadedAt: T(2) }),
      'ASSIGNMENT_OVERLAP', 409,
    );
    assignments.find = find;
  });

  it('refuses a load into a container that does not exist, and an unload of an ended or unknown assignment', async () => {
    const db = createFakeDb();
    await expectRefusal(
      service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-404', sourceEventId: 'evt-1' }),
      'CONTAINER_NOT_FOUND', 404,
    );
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    const loaded = await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) });
    await service.unloadSpecimen(db, loaded.specimenContainerAssignmentId, T(2));
    await expectRefusal(service.unloadSpecimen(db, loaded.specimenContainerAssignmentId, T(3)), 'ASSIGNMENT_ENDED', 409);
    await expectRefusal(service.unloadSpecimen(db, 'nope'), 'ASSIGNMENT_NOT_FOUND', 404);
  });

  it('RULE-030: one container per position and one position per container over an interval', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await service.createContainer(db, { containerId: 'CT-2', containerType: 'cryovial' });
    const placed = await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:A01', placedAt: T(1) });

    await expectRefusal(
      service.placeContainer(db, { containerId: 'CT-2', storagePositionId: 'rack-96-001:A01', placedAt: T(2) }),
      'ASSIGNMENT_OVERLAP', 409,
    );
    await expectRefusal(
      service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:A02', placedAt: T(2) }),
      'ASSIGNMENT_OVERLAP', 409,
    );

    await service.removeContainer(db, placed.containerPositionAssignmentId, T(3));
    // A back-dated stay inside CT-1's closed [T1, T3) at A01 still overlaps it.
    await expectRefusal(
      service.placeContainer(db, { containerId: 'CT-2', storagePositionId: 'rack-96-001:A01', placedAt: T(2), removedAt: new Date('2026-10-02T12:00:00.000Z') }),
      'ASSIGNMENT_OVERLAP', 409,
    );
    const moved = await service.placeContainer(db, { containerId: 'CT-2', storagePositionId: 'rack-96-001:A01', placedAt: T(3) });
    expect(moved.storagePositionId).toBe('rack-96-001:A01');
  });

  it("#1532 (RF016 AC2): with requirePreparedPosition, places only at one of the rack's prepared StoragePosition rows", async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    db.collection('storagePositions').docs.push({ storagePositionId: 'rack-96-001:A01', storageRackId: 'rack-96-001', positionCode: 'A01' });
    const options = { requirePreparedPosition: true };

    const outside = service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:Z99', placedAt: T(1) }, options);
    await expectRefusal(outside, 'POSITION_NOT_IN_GRID', 422);
    await expect(outside).rejects.toThrow('rack-96-001:Z99');
    await expectRefusal(
      service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-never:A01', placedAt: T(1) }, options),
      'POSITION_NOT_IN_GRID', 422,
    );
    expect(db.collections.containerPositionAssignments.docs).toEqual([]);

    await expect(
      service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:A01', placedAt: T(1) }, options),
    ).resolves.toMatchObject({ containerId: 'CT-1', storagePositionId: 'rack-96-001:A01', assignmentStatus: 'active' });
  });

  it('#1532: without requirePreparedPosition (the legacy box path) a position needs no prepared row', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await expect(
      service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'box-1:A01', placedAt: T(1) }),
    ).resolves.toMatchObject({ storagePositionId: 'box-1:A01' });
  });

  it('records a historical interval given its end as closed, so the key can still take its open assignment', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    const history = await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:A01', placedAt: T(1), removedAt: T(2) });
    expect(history.assignmentStatus).toBe('ended');

    const current = await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:A02', placedAt: T(2) });
    expect(current.assignmentStatus).toBe('active');
  });

  it('RULE-035: a rack is in one location at a time', async () => {
    const db = createFakeDb();
    const located = await service.locateRack(db, { storageRackId: 'rack-96-001', storageLocationId: 'freezer-1', sourceEventId: 'evt-1', placedAt: T(1) });
    await expectRefusal(
      service.locateRack(db, { storageRackId: 'rack-96-001', storageLocationId: 'freezer-2', sourceEventId: 'evt-2', placedAt: T(2) }),
      'ASSIGNMENT_OVERLAP', 409,
    );
    await service.removeRack(db, located.rackLocationAssignmentId, T(2));
    await expect(
      service.locateRack(db, { storageRackId: 'rack-96-001', storageLocationId: 'freezer-2', sourceEventId: 'evt-2', placedAt: T(2) }),
    ).resolves.toMatchObject({ storageLocationId: 'freezer-2' });
  });

  it('RF016 AC3: resolves a specimen through container, position and rack at an instant', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(2) });
    await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-96-001:B03', placedAt: T(2) });
    const first = await service.locateRack(db, { storageRackId: 'rack-96-001', storageLocationId: 'freezer-1', sourceEventId: 'evt-2', placedAt: T(1) });
    await service.removeRack(db, first.rackLocationAssignmentId, T(4));
    await service.locateRack(db, { storageRackId: 'rack-96-001', storageLocationId: 'freezer-2', sourceEventId: 'evt-3', placedAt: T(4) });

    expect(await service.resolveSpecimenLocation(db, 'SPC-1', T(3))).toMatchObject({
      containerId: 'CT-1', storagePositionId: 'rack-96-001:B03', storageRackId: 'rack-96-001', storageLocationId: 'freezer-1',
    });
    expect((await service.resolveSpecimenLocation(db, 'SPC-1', T(5))).storageLocationId).toBe('freezer-2');
    expect(await service.resolveSpecimenLocation(db, 'SPC-1', T(1))).toMatchObject({
      containerId: null, storagePositionId: null, storageRackId: null, storageLocationId: null,
    });
  });
});

// A replica-set client: the probe answers with a set name, and the session
// the service opens itself is recorded.
function withTransactionalClient(db) {
  const opened = [];
  db.client = {
    db: () => ({ command: async () => ({ setName: 'rs0' }) }),
    startSession() {
      const session = { id: `own-${opened.length + 1}`, async withTransaction(fn) { await fn(); }, async endSession() {} };
      opened.push(session);
      return session;
    },
  };
  return opened;
}

function allWrites(db) {
  return Object.values(db.collections).flatMap((collection) => collection.writes);
}

describe('physicalChain.service: a caller\'s session (#1314)', () => {
  it('runs every write in the given session, and neither builds an index nor opens a transaction of its own', async () => {
    const db = createFakeDb();
    const opened = withTransactionalClient(db);
    const session = { id: 'caller' };

    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' }, { session });
    const loaded = await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) }, { session });
    const placed = await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-1:A01', placedAt: T(1) }, { session });
    const located = await service.locateRack(db, { storageRackId: 'rack-1', storageLocationId: 'freezer-1', sourceEventId: 'evt-2', placedAt: T(1) }, { session });
    await service.removeContainer(db, placed.containerPositionAssignmentId, T(2), { session });
    await service.removeRack(db, located.rackLocationAssignmentId, T(2), { session });
    await service.unloadSpecimen(db, loaded.specimenContainerAssignmentId, T(2), { session });

    const writes = allWrites(db);
    expect(writes).toHaveLength(9);
    expect(writes.filter((write) => write.options?.session !== session)).toEqual([]);
    expect(opened).toEqual([]);
    expect(Object.values(db.collections).flatMap((collection) => collection.indexes)).toEqual([]);
  });

  it('without a session still builds the indexes and opens its own transaction for each write', async () => {
    const db = createFakeDb();
    const opened = withTransactionalClient(db);

    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    const loaded = await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) });
    await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-1:A01', placedAt: T(1) });
    await service.unloadSpecimen(db, loaded.specimenContainerAssignmentId, T(2));

    expect(opened.map((session) => session.id)).toEqual(['own-1', 'own-2', 'own-3']);
    expect(db.collections.containers.writes[0].options).toBeUndefined();
    expect(db.collections.specimenContainerAssignments.writes.map((write) => write.options.session.id)).toEqual(['own-1', 'own-3']);
    expect(db.collections.containerPositionAssignments.writes[0].options.session.id).toBe('own-2');
    expect(db.collections.specimenContainerAssignments.indexes.map((index) => index.options.name)).toEqual(['uniq_open_specimen', undefined]);
  });

  it('reads the open specimen and position assignments in the given session', async () => {
    const db = createFakeDb();
    await service.createContainer(db, { containerId: 'CT-1', containerType: 'cryovial' });
    await service.loadSpecimen(db, { specimenId: 'SPC-1', containerId: 'CT-1', sourceEventId: 'evt-1', loadedAt: T(1) });
    await service.placeContainer(db, { containerId: 'CT-1', storagePositionId: 'rack-1:A01', placedAt: T(1) });
    const session = { id: 'caller' };
    const findOne = vi.spyOn(db.collections.specimenContainerAssignments, 'findOne');

    expect(await service.openSpecimenAssignment(db, 'SPC-1', session)).toMatchObject({ containerId: 'CT-1' });
    expect(findOne).toHaveBeenCalledWith({ specimenId: 'SPC-1', assignmentStatus: 'active' }, { session });
    expect(await service.openPositionAssignment(db, 'CT-1', session)).toMatchObject({ storagePositionId: 'rack-1:A01' });
    expect(await service.openSpecimenAssignment(db, 'SPC-404', session)).toBeNull();
  });
});

describe('specimenIdsAtLocation (#1392)', () => {
  const FROM = T(3);
  const TO = T(5);

  // One specimen in one container at one position of one rack at one location.
  function seedChain(db, { specimenId = 'SPC-1', containerId = 'CT-1', storagePositionId = 'rack-1:A01', storageRackId = 'rack-1', storageLocationId = 'loc-1', sca = {}, cpa = {}, rla = {} } = {}) {
    db.collection('specimenContainerAssignments').docs.push({ specimenId, containerId, loadedAt: T(1), unloadedAt: null, ...sca });
    db.collection('containerPositionAssignments').docs.push({ containerId, storagePositionId, placedAt: T(1), removedAt: null, ...cpa });
    db.collection('rackLocationAssignments').docs.push({ storageRackId, storageLocationId, placedAt: T(1), removedAt: null, ...rla });
  }

  it('returns a specimen whose three intervals overlap the window at the location, and not at another', async () => {
    const db = createFakeDb();
    seedChain(db, { sca: { loadedAt: T(2) }, cpa: { placedAt: T(1), removedAt: T(4) }, rla: { placedAt: T(1) } });

    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual(['SPC-1']);
    expect(await service.specimenIdsAtLocation(db, 'loc-2', { from: FROM, to: TO })).toEqual([]);
  });

  it('reads each interval half-open and the window closed: removedAt === from is out, placedAt === to is in', async () => {
    const removed = createFakeDb();
    seedChain(removed, { cpa: { removedAt: FROM } });
    expect(await service.specimenIdsAtLocation(removed, 'loc-1', { from: FROM, to: TO })).toEqual([]);

    const placed = createFakeDb();
    seedChain(placed, { cpa: { placedAt: TO } });
    expect(await service.specimenIdsAtLocation(placed, 'loc-1', { from: FROM, to: TO })).toEqual(['SPC-1']);
  });

  it('from === to inside a piece returns it', async () => {
    const db = createFakeDb();
    seedChain(db);
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: T(4), to: T(4) })).toEqual(['SPC-1']);
  });

  it('a rack moved from loc-1 to loc-2 before from is not returned for loc-1', async () => {
    const db = createFakeDb();
    seedChain(db, { rla: { removedAt: T(2) } });
    db.collection('rackLocationAssignments').docs.push({ storageRackId: 'rack-1', storageLocationId: 'loc-2', placedAt: T(2), removedAt: null });

    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual([]);
    expect(await service.specimenIdsAtLocation(db, 'loc-2', { from: FROM, to: TO })).toEqual(['SPC-1']);
  });

  it('a specimen unloaded before from is not returned', async () => {
    const db = createFakeDb();
    seedChain(db, { sca: { unloadedAt: T(2) } });
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual([]);
  });

  it('rack-1 at loc-1 does not return a container at rack-10:A01', async () => {
    const db = createFakeDb();
    seedChain(db, { storagePositionId: 'rack-10:A01' });
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual([]);
  });

  it('rack.1 at loc-1 does not return a container at rackX1:A01', async () => {
    const db = createFakeDb();
    seedChain(db, { storageRackId: 'rack.1', storagePositionId: 'rackX1:A01' });
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual([]);
  });

  it('a position id without a separator adds nothing', async () => {
    const db = createFakeDb();
    seedChain(db, { storageRackId: 'rack-1', storagePositionId: 'rack-1' });
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual([]);
  });

  it('two pieces of one specimen return it once', async () => {
    const db = createFakeDb();
    seedChain(db, { cpa: { removedAt: T(4) } });
    db.collection('containerPositionAssignments').docs.push({ containerId: 'CT-1', storagePositionId: 'rack-1:B02', placedAt: T(4), removedAt: null });
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: TO })).toEqual(['SPC-1']);
  });

  it('an empty location or an invalid date returns [] and calls no find', async () => {
    const db = createFakeDb();
    seedChain(db);
    const finds = ['specimenContainerAssignments', 'containerPositionAssignments', 'rackLocationAssignments']
      .map((name) => vi.spyOn(db.collection(name), 'find'));

    expect(await service.specimenIdsAtLocation(db, '', { from: FROM, to: TO })).toEqual([]);
    expect(await service.specimenIdsAtLocation(db, null, { from: FROM, to: TO })).toEqual([]);
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: 'not-a-date', to: TO })).toEqual([]);
    expect(await service.specimenIdsAtLocation(db, 'loc-1', { from: FROM, to: undefined })).toEqual([]);
    for (const find of finds) expect(find).not.toHaveBeenCalled();
  });
});
