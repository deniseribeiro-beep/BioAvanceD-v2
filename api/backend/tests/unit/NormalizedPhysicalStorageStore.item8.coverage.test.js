import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const NormalizedPhysicalStorageStore = require('../../src/infrastructure/persistence/mongo/NormalizedPhysicalStorageStore');

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value) return value.$in.map(String).includes(String(doc[key]));
    }
    return String(doc[key]) === String(value);
  });
}

function makeCollection(initial = []) {
  const docs = initial.map((doc) => ({ ...doc }));
  return {
    docs,
    createIndex: vi.fn(async () => 'idx'),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matches(doc, filter)) || null),
    find: vi.fn((filter = {}) => ({
      toArray: vi.fn(async () => docs.filter((doc) => matches(doc, filter))),
    })),
    insertOne: vi.fn(async (doc) => {
      docs.push(doc);
      return { insertedId: doc._id || doc.specimenContainerAssignmentId || doc.containerPositionAssignmentId || doc.rackLocationAssignmentId || 'inserted' };
    }),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => matches(item, filter));
      const inserted = !doc && options.upsert;
      if (inserted) {
        doc = { ...filter };
        docs.push(doc);
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$setOnInsert || {}, update.$set || {});
      return inserted
        ? { matchedCount: 0, modifiedCount: 0, upsertedId: 'upserted', upsertedCount: 1 }
        : { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function makeDb(overrides = {}) {
  const collections = {
    containers: makeCollection(),
    storageRacks: makeCollection(),
    storagePositions: makeCollection(),
    specimenContainerAssignments: makeCollection(),
    containerPositionAssignments: makeCollection(),
    rackLocationAssignments: makeCollection(),
    storageBoxes: makeCollection(),
    ...overrides,
  };
  return {
    collections,
    collection: vi.fn((name) => {
      if (!collections[name]) collections[name] = makeCollection();
      return collections[name];
    }),
  };
}

describe('NormalizedPhysicalStorageStore item 8 canonical coverage', () => {
  it('resolves canonical location precedence equipment -> room -> facility -> box', async () => {
    const store = new NormalizedPhysicalStorageStore(makeDb());
    await expect(store.resolveStorageLocationId({ hierarchy: { equipmentId: 'EQ', roomId: 'ROOM', facilityId: 'FAC' }, boxId: 'BOX' })).resolves.toBe('EQ');
    await expect(store.resolveStorageLocationId({ hierarchy: { roomId: 'ROOM', facilityId: 'FAC' }, boxId: 'BOX' })).resolves.toBe('ROOM');
    await expect(store.resolveStorageLocationId({ hierarchy: { facilityId: 'FAC' }, boxId: 'BOX' })).resolves.toBe('FAC');
    await expect(store.resolveStorageLocationId({ hierarchy: {}, boxId: 42 })).resolves.toBe('42');
  });

  it('memoizes index creation, skips unsupported createIndex and retries after failure', async () => {
    const db = makeDb();
    db.collections.storageRacks.createIndex = undefined;
    const store = new NormalizedPhysicalStorageStore(db);
    const first = store.ensureIndexes();
    const memoized = store.indexesPromise;
    const second = store.ensureIndexes();
    expect(store.indexesPromise).toBe(memoized);
    await Promise.all([first, second]);
    expect(db.collections.containers.createIndex).toHaveBeenCalledTimes(1);

    const retryDb = makeDb();
    retryDb.collections.containers.createIndex
      .mockRejectedValueOnce(new Error('index failed'))
      .mockResolvedValue('idx');
    const retryStore = new NormalizedPhysicalStorageStore(retryDb);
    await expect(retryStore.ensureIndexes()).rejects.toThrow('index failed');
    expect(retryStore.indexesPromise).toBeNull();
    await expect(retryStore.ensureIndexes()).resolves.toBeUndefined();
  });

  it('reuses an existing specimen-container assignment', async () => {
    const existing = { specimenContainerAssignmentId: 'SCA-1', specimenId: 'SPEC-1', containerId: 'CONT-1', assignmentStatus: 'active' };
    const db = makeDb({ specimenContainerAssignments: makeCollection([existing]) });
    const store = new NormalizedPhysicalStorageStore(db);

    await expect(store.ensureContainerForSpecimen('SPEC-1', 'EVT', null)).resolves.toEqual(existing);
    expect(db.collections.containers.updateOne).not.toHaveBeenCalled();
  });

  it('creates a canonical container assignment when none exists', async () => {
    const db = makeDb();
    const store = new NormalizedPhysicalStorageStore(db);
    const result = await store.ensureContainerForSpecimen('SPEC-NEW', 'EVT-NEW', null);

    expect(result).toMatchObject({ specimenId: 'SPEC-NEW', containerId: 'container:SPEC-NEW', assignmentStatus: 'active', sourceEventId: 'EVT-NEW' });
    expect(db.collections.containers.updateOne).toHaveBeenCalled();
    expect(db.collections.specimenContainerAssignments.insertOne).toHaveBeenCalled();
  });

  it('creates rack/position/location assignment and reuses the same active rack location', async () => {
    const db = makeDb();
    const store = new NormalizedPhysicalStorageStore(db);
    const box = { _id: 'BOX-1', dimension: { rows: 9, cols: 10 } };

    const first = await store.ensureRackAndPosition({ box, positionCode: 'a1', hierarchy: { equipmentId: 'EQ-1' }, sourceEventId: 'EVT-1' }, null);
    expect(first.rack).toMatchObject({ storageRackId: 'BOX-1', rowCount: 9, columnCount: 10 });
    expect(first.position).toMatchObject({ storagePositionId: 'BOX-1:A1', positionCode: 'A1' });
    expect(first.rackLocationAssignment.storageLocationId).toBe('EQ-1');

    const insertCount = db.collections.rackLocationAssignments.insertOne.mock.calls.length;
    const second = await store.ensureRackAndPosition({ box, positionCode: 'A2', hierarchy: { equipmentId: 'EQ-1' }, sourceEventId: 'EVT-2' }, null);
    expect(second.rackLocationAssignment.rackLocationAssignmentId).toBe(first.rackLocationAssignment.rackLocationAssignmentId);
    expect(db.collections.rackLocationAssignments.insertOne).toHaveBeenCalledTimes(insertCount);
  });

  it('closes a changed rack-location assignment and supports boxes without dimensions', async () => {
    const existing = { rackLocationAssignmentId: 'RLA-OLD', storageRackId: 'BOX-2', storageLocationId: 'ROOM-OLD', assignmentStatus: 'active' };
    const db = makeDb({ rackLocationAssignments: makeCollection([existing]) });
    const store = new NormalizedPhysicalStorageStore(db);

    const result = await store.ensureRackAndPosition({
      box: { _id: 'BOX-2' },
      positionCode: 'B2',
      hierarchy: { roomId: 'ROOM-NEW' },
      sourceEventId: 'EVT',
    }, null);

    expect(db.collections.rackLocationAssignments.updateOne).toHaveBeenCalledWith(
      { rackLocationAssignmentId: 'RLA-OLD', assignmentStatus: 'active' },
      { $set: expect.objectContaining({ assignmentStatus: 'inactive' }) },
      { session: null }
    );
    expect(result.rack).toMatchObject({ rowCount: 0, columnCount: 0 });
    expect(result.rackLocationAssignment.storageLocationId).toBe('ROOM-NEW');
  });

  it('returns the active placement unchanged when already in the requested position', async () => {
    const db = makeDb({
      containerPositionAssignments: makeCollection([{
        containerPositionAssignmentId: 'CPA-SAME', containerId: 'CONT-1', storagePositionId: 'BOX-1:A1', assignmentStatus: 'active'
      }]),
    });
    const store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    vi.spyOn(store, 'ensureContainerForSpecimen').mockResolvedValue({ specimenContainerAssignmentId: 'SCA-1', containerId: 'CONT-1' });
    vi.spyOn(store, 'ensureRackAndPosition').mockResolvedValue({
      rack: { storageRackId: 'BOX-1' },
      position: { storagePositionId: 'BOX-1:A1', positionCode: 'A1' },
      rackLocationAssignment: { rackLocationAssignmentId: 'RLA-1' },
    });

    const result = await store.assignSpecimenPosition({ specimenId: 'SPEC-1', box: { _id: 'BOX-1' }, positionCode: 'A1', hierarchy: {}, sourceEventId: 'EVT' }, null);
    expect(result.containerPositionAssignment.containerPositionAssignmentId).toBe('CPA-SAME');
    expect(db.collections.containerPositionAssignments.insertOne).not.toHaveBeenCalled();
  });

  it('closes a different placement and frees the previous storage position', async () => {
    const db = makeDb({
      containerPositionAssignments: makeCollection([{
        containerPositionAssignmentId: 'CPA-OLD', containerId: 'CONT-2', storagePositionId: 'BOX-OLD:A1', assignmentStatus: 'active'
      }]),
    });
    const store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    vi.spyOn(store, 'ensureContainerForSpecimen').mockResolvedValue({ specimenContainerAssignmentId: 'SCA-2', containerId: 'CONT-2' });
    vi.spyOn(store, 'ensureRackAndPosition').mockResolvedValue({
      rack: { storageRackId: 'BOX-NEW' },
      position: { storagePositionId: 'BOX-NEW:B2', positionCode: 'B2' },
      rackLocationAssignment: { rackLocationAssignmentId: 'RLA-2' },
    });

    const result = await store.assignSpecimenPosition({ specimenId: 'SPEC-2', box: { _id: 'BOX-NEW' }, positionCode: 'B2', hierarchy: {}, sourceEventId: 'EVT' }, null);
    expect(db.collections.containerPositionAssignments.updateOne).toHaveBeenCalled();
    expect(db.collections.storagePositions.updateOne).toHaveBeenCalledWith(
      { storagePositionId: 'BOX-OLD:A1' },
      { $set: { status: 'available' } },
      { session: null }
    );
    expect(result.storagePosition.status).toBe('occupied');
  });

  it('creates a placement directly when no active container position exists', async () => {
    const db = makeDb();
    const store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    vi.spyOn(store, 'ensureContainerForSpecimen').mockResolvedValue({ specimenContainerAssignmentId: 'SCA-3', containerId: 'CONT-3' });
    vi.spyOn(store, 'ensureRackAndPosition').mockResolvedValue({
      rack: { storageRackId: 'BOX-3' },
      position: { storagePositionId: 'BOX-3:C3', positionCode: 'C3' },
      rackLocationAssignment: { rackLocationAssignmentId: 'RLA-3' },
    });

    const result = await store.assignSpecimenPosition({ specimenId: 'SPEC-3', box: { _id: 'BOX-3' }, positionCode: 'C3', hierarchy: {}, sourceEventId: 'EVT' }, null);
    expect(db.collections.containerPositionAssignments.updateOne).not.toHaveBeenCalled();
    expect(result.containerPositionAssignment.assignmentStatus).toBe('active');
  });

  it('returns null or releases active position/container assignments as appropriate', async () => {
    const db = makeDb({
      specimenContainerAssignments: makeCollection([{
        specimenContainerAssignmentId: 'SCA-REL', specimenId: 'SPEC-REL', containerId: 'CONT-REL', assignmentStatus: 'active'
      }]),
    });
    const store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    vi.spyOn(store, 'findCurrentBySpecimen')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ specimenId: 'SPEC-REL', containerPositionAssignmentId: 'CPA-REL', storagePositionId: 'BOX:A1' });

    await expect(store.releaseSpecimenPosition('NONE', null)).resolves.toBeNull();
    await expect(store.releaseSpecimenPosition('SPEC-REL', null)).resolves.toMatchObject({ assignmentStatus: 'inactive', removedAt: expect.any(Date) });

    await expect(store.releaseSpecimenContainer('NONE', null)).resolves.toBeNull();
    await expect(store.releaseSpecimenContainer('SPEC-REL', null)).resolves.toMatchObject({ assignmentStatus: 'inactive', unloadedAt: expect.any(Date) });
  });

  it('returns null at every incomplete canonical lineage hop', async () => {
    const cases = [
      {},
      { specimenContainerAssignments: [{ specimenId: 'SPEC-X', containerId: 'CONT-X', assignmentStatus: 'active' }] },
      {
        specimenContainerAssignments: [{ specimenId: 'SPEC-X', containerId: 'CONT-X', assignmentStatus: 'active' }],
        containerPositionAssignments: [{ containerId: 'CONT-X', storagePositionId: 'POS-X', assignmentStatus: 'active' }],
      },
      {
        specimenContainerAssignments: [{ specimenId: 'SPEC-X', containerId: 'CONT-X', assignmentStatus: 'active' }],
        containerPositionAssignments: [{ containerId: 'CONT-X', storagePositionId: 'POS-X', assignmentStatus: 'active' }],
        storagePositions: [{ storagePositionId: 'POS-X', storageRackId: 'RACK-X' }],
      },
    ];
    for (const item of cases) {
      const db = makeDb({
        specimenContainerAssignments: makeCollection(item.specimenContainerAssignments || []),
        containerPositionAssignments: makeCollection(item.containerPositionAssignments || []),
        storagePositions: makeCollection(item.storagePositions || []),
        storageRacks: makeCollection(item.storageRacks || []),
      });
      const store = new NormalizedPhysicalStorageStore(db);
      vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
      await expect(store.findCurrentBySpecimen('SPEC-X', null)).resolves.toBeNull();
    }
  });

  it('returns current location with optional rack/location/layout metadata absent and present', async () => {
    const db = makeDb({
      specimenContainerAssignments: makeCollection([{
        specimenContainerAssignmentId: 'SCA', specimenId: 'SPEC', containerId: 'CONT', assignmentStatus: 'active'
      }]),
      containerPositionAssignments: makeCollection([{
        containerPositionAssignmentId: 'CPA', containerId: 'CONT', storagePositionId: 'POS', assignmentStatus: 'active'
      }]),
      storagePositions: makeCollection([{ storagePositionId: 'POS', storageRackId: 'RACK', positionCode: 'D4' }]),
      storageRacks: makeCollection([{ storageRackId: 'RACK' }]),
    });
    const store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();

    const fallback = await store.findCurrentBySpecimen('SPEC', null);
    expect(fallback).toMatchObject({
      rackLocationAssignmentId: null, storageLocationId: null, boxId: 'RACK', unloadedAt: null, removedAt: null, sourceEventId: null
    });

    db.collections.rackLocationAssignments.docs.push({
      rackLocationAssignmentId: 'RLA', storageRackId: 'RACK', storageLocationId: 'FREEZER-1', assignmentStatus: 'active'
    });
    db.collections.storageBoxes.docs.push({ _id: 'BOX-LAYOUT', canonicalStorageRackId: 'RACK' });
    db.collections.specimenContainerAssignments.docs[0].unloadedAt = new Date();
    db.collections.specimenContainerAssignments.docs[0].sourceEventId = 'EVT';
    db.collections.containerPositionAssignments.docs[0].removedAt = new Date();

    const complete = await store.findCurrentBySpecimen('SPEC', null);
    expect(complete).toMatchObject({ rackLocationAssignmentId: 'RLA', storageLocationId: 'FREEZER-1', boxId: 'BOX-LAYOUT', sourceEventId: 'EVT' });
  });

  it('queries zero or multiple specimen identifiers', async () => {
    const store = new NormalizedPhysicalStorageStore(makeDb());
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    const current = vi.spyOn(store, 'findCurrentBySpecimen').mockImplementation(async (id) => ({ specimenId: String(id) }));

    expect((await store.findCurrentBySpecimens(undefined, null)).size).toBe(0);
    const result = await store.findCurrentBySpecimens(['S1', 'S2'], null);
    expect([...result.keys()]).toEqual(['S1', 'S2']);
    expect(current).toHaveBeenCalledTimes(2);
  });

  it('filters blank locations, handles empty intermediate sets and deduplicates specimen ids', async () => {
    let store = new NormalizedPhysicalStorageStore(makeDb());
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    await expect(store.findSpecimenIdsByLocation({ boxIds: [null, undefined, '', '   '] })).resolves.toEqual([]);

    let db = makeDb();
    store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    await expect(store.findSpecimenIdsByLocation({ boxIds: ['BOX-1'] })).resolves.toEqual([]);

    db = makeDb({ storagePositions: makeCollection([{ storagePositionId: 'BOX-2:A1', storageRackId: 'BOX-2', positionCode: 'A1' }]) });
    store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    await expect(store.findSpecimenIdsByLocation({ boxIds: ['BOX-2'] })).resolves.toEqual([]);

    const session = { id: 'sess' };
    db = makeDb({
      storagePositions: makeCollection([
        { storagePositionId: 'BOX-3:A1', storageRackId: 'BOX-3', positionCode: 'A1' },
        { storagePositionId: 'BOX-3:A2', storageRackId: 'BOX-3', positionCode: 'A2' },
      ]),
      containerPositionAssignments: makeCollection([
        { containerId: 'C1', storagePositionId: 'BOX-3:A1', assignmentStatus: 'active' },
        { containerId: 'C2', storagePositionId: 'BOX-3:A1', assignmentStatus: 'active' },
      ]),
      specimenContainerAssignments: makeCollection([
        { specimenId: 'SPEC-DUP', containerId: 'C1', assignmentStatus: 'active' },
        { specimenId: 'SPEC-DUP', containerId: 'C2', assignmentStatus: 'active' },
        { specimenId: '', containerId: 'C2', assignmentStatus: 'active' },
      ]),
    });
    store = new NormalizedPhysicalStorageStore(db);
    vi.spyOn(store, 'ensureIndexes').mockResolvedValue();
    await expect(store.findSpecimenIdsByLocation({ boxIds: ['BOX-3', 'BOX-3'], positionCode: 'A1', session })).resolves.toEqual(['SPEC-DUP']);
  });
});
