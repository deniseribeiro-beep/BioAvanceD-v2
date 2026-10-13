import { describe, it, expect, vi, beforeEach } from 'vitest';
const { ObjectId } = require('mongodb');
const StorageService = require('../../src/services/storageService');

// #994: this used to fabricate `getMongo: vi.fn()`, a mongosh method the
// native driver's Db does NOT have -- `typeof db.getMongo` is `undefined` on a
// real `MongoClient.db()`. storageService called it, so 41 green tests
// coexisted with an endpoint that threw a TypeError on every real deployment:
// the mock supplied the very method whose absence was the bug.
//
// The shape below is the one `server.js` actually builds -- `connectDB()`
// returns `client.db(mongoDb)`, whose transaction entry point is `db.client`
// (a MongoClient), never `db.getMongo()`. Do not add `getMongo` back.
function makeDb(overrides = {}) {
  return {
    // no listCollections -> getCollection() falls back to canonical name directly
    collection: vi.fn(),
    ...overrides
  };
}

describe('StorageService - pure/near-pure helpers', () => {
  let service;

  beforeEach(() => {
    service = new StorageService(makeDb());
  });

  describe('_normalizeObjectId', () => {
    it('passes through an existing ObjectId instance unchanged', () => {
      const id = new ObjectId();
      expect(service._normalizeObjectId(id)).toBe(id);
    });

    it('converts a valid ObjectId string into an ObjectId', () => {
      const idStr = new ObjectId().toString();
      const result = service._normalizeObjectId(idStr);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toString()).toBe(idStr);
    });

    it('passes through an invalid string unchanged', () => {
      const result = service._normalizeObjectId('not-a-valid-id');
      expect(result).toBe('not-a-valid-id');
    });
  });

  describe('_getAllValidPositions', () => {
    it('generates positions in row-major order for a 2x3 grid', () => {
      const positions = service._getAllValidPositions({ rows: 2, cols: 3 });
      expect(positions).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
    });
  });

  describe('_findFirstAvailablePosition', () => {
    it('returns null when box has 0 rows/cols', () => {
      expect(service._findFirstAvailablePosition({ dimension: { rows: 0, cols: 0 }, occupancyGrid: {} })).toBeNull();
    });

    it('returns null when box has undefined dimension', () => {
      expect(service._findFirstAvailablePosition({})).toBeNull();
    });

    it('returns null when box is fully occupied', () => {
      const box = {
        dimension: { rows: 1, cols: 2 },
        occupancyGrid: { A1: 'x', A2: 'y' }
      };
      expect(service._findFirstAvailablePosition(box)).toBeNull();
    });

    it('returns the correct first-available position in row-major order', () => {
      const box = {
        dimension: { rows: 2, cols: 2 },
        occupancyGrid: { A1: 'x', A2: 'y' } // B1, B2 free
      };
      expect(service._findFirstAvailablePosition(box)).toBe('B1');
    });

    it('works with a Map-based occupancyGrid too', () => {
      const box = {
        dimension: { rows: 1, cols: 2 },
        occupancyGrid: new Map([['A1', 'x']])
      };
      expect(service._findFirstAvailablePosition(box)).toBe('A2');
    });
  });
});

describe('StorageService.verifyBoxIntegrity', () => {
  let db;
  let boxesFindOne;
  let samplesFindOne;
  let service;

  beforeEach(() => {
    boxesFindOne = vi.fn();
    samplesFindOne = vi.fn();
    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return { findOne: boxesFindOne };
        if (name === 'samples') return { findOne: samplesFindOne };
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    service = new StorageService(db);
  });

  it('returns BOX_NOT_FOUND when box does not exist', async () => {
    boxesFindOne.mockResolvedValue(null);
    const result = await service.verifyBoxIntegrity(new ObjectId().toString());
    expect(result).toEqual({ valid: false, error: 'BOX_NOT_FOUND' });
  });

  it('pushes an error for an orphaned occupancyGrid entry (sample does not exist)', async () => {
    const boxId = new ObjectId();
    const missingSampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 1,
      occupancyGrid: new Map([['A1', missingSampleId]])
    });
    samplesFindOne.mockResolvedValue(null);

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Orfão/);
  });

  it('pushes an error for an inconsistent sample (points elsewhere)', async () => {
    const boxId = new ObjectId();
    const sampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 1,
      occupancyGrid: new Map([['A1', sampleId]])
    });
    samplesFindOne.mockResolvedValue({
      _id: sampleId,
      storageLocation: { boxId: new ObjectId().toString(), position: 'B2' }
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Inconsistência/);
  });

  it('pushes an error when currentOccupancy count mismatches actual occupancy', async () => {
    const boxId = new ObjectId();
    const sampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 5, // wrong, only 1 actual entry
      occupancyGrid: new Map([['A1', sampleId]])
    });
    samplesFindOne.mockResolvedValue({
      _id: sampleId,
      storageLocation: { boxId: boxId.toString(), position: 'A1' }
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.match(/Contagem incorreta/))).toBe(true);
  });

  it('returns valid:true with no errors for a fully consistent box', async () => {
    const boxId = new ObjectId();
    const sampleId = new ObjectId();
    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      currentOccupancy: 1,
      occupancyGrid: new Map([['A1', sampleId]])
    });
    samplesFindOne.mockResolvedValue({
      _id: sampleId,
      storageLocation: { boxId: boxId.toString(), position: 'A1' }
    });

    const result = await service.verifyBoxIntegrity(boxId.toString());
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('falls back to the raw boxId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    boxesFindOne.mockResolvedValue(null);
    const result = await service.verifyBoxIntegrity('some-box-id');
    expect(result).toEqual({ valid: false, error: 'BOX_NOT_FOUND' });
    isValidSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by the DB-write-path tests below (allocate/autoAssign/release)
// ---------------------------------------------------------------------------

function makeMovementsCollection() {
  const chain = {
    sort: vi.fn(function sort() { return chain; }),
    limit: vi.fn(function limit() { return chain; }),
    next: vi.fn().mockResolvedValue(null),
    toArray: vi.fn().mockResolvedValue([])
  };
  return {
    find: vi.fn(() => chain),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    createIndex: vi.fn().mockResolvedValue(true)
  };
}

function makeCountersCollection() {
  return {
    findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } })
  };
}

function makeSession() {
  return {
    withTransaction: vi.fn(async (fn) => { await fn(); }),
    endSession: vi.fn().mockResolvedValue(undefined)
  };
}

describe('StorageService.autoAssignSampleToBox', () => {
  let boxesFindOne;
  let boxesUpdateOne;
  let samplesFindOne;
  let samplesUpdateOne;
  let storageAssignmentsFindOne;
  let storageAssignmentsInsertOne;
  let storageAssignmentsUpdateOne;
  let movements;
  let counters;
  let db;
  let service;
  // #1312: the placement reaches the graph only as an outbox event.
  let graphProjection;

  beforeEach(() => {
    graphProjection = { appendStoragePositionEvent: vi.fn().mockResolvedValue({ eventId: 'evt-1' }) };
    boxesFindOne = vi.fn();
    boxesUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    samplesFindOne = vi.fn();
    samplesUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    // No open StorageAssignment by default (sample not currently allocated).
    storageAssignmentsFindOne = vi.fn().mockResolvedValue(null);
    // #1003: autoAssignSamplePosition now opens a StorageAssignment row
    // (insertOne; updateOne closes one) --
    // without these spies the existing cases below would go red on "insertOne
    // is not a function" rather than on anything this block actually tests.
    storageAssignmentsInsertOne = vi.fn().mockResolvedValue({ insertedId: 'stub' });
    storageAssignmentsUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    movements = makeMovementsCollection();
    // #988: appendImmutableAudit (now called inside the transaction) reads
    // 'counters' via MongoAuditRepository.generateMovementID.
    counters = makeCountersCollection();

    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'storageBoxes') return { findOne: boxesFindOne, updateOne: boxesUpdateOne };
        if (name === 'samples') return { findOne: samplesFindOne, updateOne: samplesUpdateOne };
        if (name === 'sample_movements') return movements;
        if (name === 'counters') return counters;
        if (name === 'storageAssignments') {
          return {
            findOne: storageAssignmentsFindOne,
            insertOne: storageAssignmentsInsertOne,
            updateOne: storageAssignmentsUpdateOne
          };
        }
        // #646 Wave 3 (RF017 AC#7): MongoStorageRepository#autoAssignSamplePosition
        // (called via storageRepository below) now checks checkLocationBlocked,
        // which queries these two -- no StoragePath/blocked ancestor by default,
        // matching every existing test in this block (none exercises AC#7 itself).
        if (name === 'storagePaths') return { findOne: vi.fn().mockResolvedValue(null) };
        if (name === 'storageContainers') return { findOne: vi.fn().mockResolvedValue(null) };
        throw new Error(`unexpected collection: ${name}`);
      }),
      // #994: this was `getMongo: vi.fn(() => ({ startSession: ... }))`, and it
      // is the single line that let 41 green tests coexist with an endpoint
      // that threw on every real deployment. `getMongo` is a MONGOSH method;
      // the native driver's Db does not have it, so the mock supplied the very
      // method whose absence was the bug.
      //
      // `client` is what a real `MongoClient.db()` exposes, and it is what
      // `utils/mongoTransaction.js` and `MongoStorageRepository.withTransaction`
      // both derive the session from (`db?.client || db?.s?.client`).
      client: { startSession: vi.fn(() => makeSession()) }
    });
    service = new StorageService(db, { graphProjection });
  });

  it('happy path: finds the first free position and allocates the specimen there', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: { A1: new ObjectId() }, // A1 occupied, A2 free
      currentOccupancy: 1
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      barcode: 'BC-9',
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.sampleLocation.position).toBe('A2');
    expect(result.graphPersisted).toBe(true);

    const boxUpdateCall = boxesUpdateOne.mock.calls[0];
    expect(boxUpdateCall[0][`occupancyGrid.A2`]).toEqual({ $exists: false });

    const sampleUpdateCall = samplesUpdateOne.mock.calls[0];
    // storageLocation defaults to a literal `null` on create (Sample.js) —
    // a dotted-path $set into it is rejected by real MongoDB, so
    // MongoStorageRepository.autoAssignSamplePosition replaces the whole
    // object on first allocation instead of setting nested paths (#592).
    expect(sampleUpdateCall[1].$set.storageLocation).toEqual({ boxId: expect.anything(), position: 'A2' });
    // #544: status is a retired legacy field (specimenStatus is the sole
    // source of truth since #408) — auto-assign must not write it.
    expect(sampleUpdateCall[1].$set['status']).toBeUndefined();
  });

  it('#479: reports the transaction-committed position, not the stale pre-transaction scan, when they diverge', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    // Pre-transaction scan sees only A1 occupied -> would pick A2.
    boxesFindOne.mockResolvedValueOnce({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: new ObjectId() },
      currentOccupancy: 1
    });
    // In-transaction re-scan finds A2 has since been taken by a concurrent
    // write -> the actually committed position is A3.
    boxesFindOne.mockResolvedValueOnce({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: new ObjectId(), A2: new ObjectId() },
      currentOccupancy: 2
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      barcode: 'BC-9',
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.sampleLocation.position).toBe('A3');
  });

  it('returns BOX_FULL when the box has no available position', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: { A1: new ObjectId() },
      currentOccupancy: 1
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_FULL');
    // Never reaches the write phase.
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('returns BOX_NOT_FOUND when the target box does not exist', async () => {
    boxesFindOne.mockResolvedValue(null);
    const result = await service.autoAssignSampleToBox(
      new ObjectId().toString(),
      new ObjectId().toString()
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
  });

  it('returns SAMPLE_NOT_FOUND when the specimen does not exist', async () => {
    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue(null);

    const result = await service.autoAssignSampleToBox(new ObjectId().toString(), new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
  });

  it('returns ALREADY_ALLOCATED on the pre-transaction check when the sample already has a StorageAssignment', async () => {
    boxesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId()
    });
    storageAssignmentsFindOne.mockResolvedValue({
      boxId: new ObjectId().toString(),
      positionCode: 'A1',
      removedAt: null
    });

    const result = await service.autoAssignSampleToBox(new ObjectId().toString(), new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ALREADY_ALLOCATED');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction and returns ALREADY_ALLOCATED if a concurrent write allocated the sample first', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 2 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    // Pre-check: not yet allocated. In-transaction fresh read: now allocated (race).
    samplesFindOne
      .mockResolvedValueOnce({ _id: specimenId, storageLocation: null })
      .mockResolvedValueOnce({
        _id: specimenId,
        storageLocation: { boxId: boxId.toString(), position: 'A1' }
      });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('ALREADY_ALLOCATED');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction and returns BOX_FULL if a concurrent write filled the box first', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    // Pre-check snapshot: one free slot. In-transaction fresh read: now full (race).
    boxesFindOne
      .mockResolvedValueOnce({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      })
      .mockResolvedValueOnce({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: { A1: new ObjectId() },
        currentOccupancy: 1
      });
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_FULL');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('returns STORAGE_COLLISION when the atomic box update reports no matched document (real collision)', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });
    boxesUpdateOne.mockResolvedValue({ matchedCount: 0 });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toMatch(/Colisão detectada/);
  });

  it('returns AUTO_ASSIGNMENT_ERROR when the sample update fails to match after allocation', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });
    samplesUpdateOne.mockResolvedValue({ matchedCount: 0 });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toMatch(/Falha ao atualizar/);
  });

  it('re-checks inside the transaction and returns BOX_NOT_FOUND if the box was deleted concurrently', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne
      .mockResolvedValueOnce({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      })
      .mockResolvedValueOnce(null); // in-transaction fresh read: box gone
    samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('BOX_NOT_FOUND');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('re-checks inside the transaction and returns SAMPLE_NOT_FOUND if the specimen was deleted concurrently', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne
      .mockResolvedValueOnce({ _id: specimenId, storageLocation: null })
      .mockResolvedValueOnce(null); // in-transaction fresh read: sample gone

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('#1312: appends STORAGE_POSITION_ASSIGNED to the outbox, never a Neo4j write, and reports graphPersisted:true', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.graphPersisted).toBe(true);
    expect(graphProjection.appendStoragePositionEvent).toHaveBeenCalledTimes(1);
    // #1313 (RF023 AC3): appended with the placement's own session.
    expect(graphProjection.appendStoragePositionEvent).toHaveBeenCalledWith(db, {
      specimenId: specimenId.toString(),
      boxId: boxId.toString(),
      position: 'A1',
      sourceService: 'storage-service'
    }, { session: expect.objectContaining({ withTransaction: expect.any(Function) }) });
  });

  it('#1004: the event carries the transaction-committed position when it diverges from the pre-scan', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();

    // Pre-transaction scan sees only A1 occupied -> would pick A2.
    boxesFindOne.mockResolvedValueOnce({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: new ObjectId() },
      currentOccupancy: 1
    });
    // In-transaction re-scan finds A2 has since been taken by a concurrent
    // write -> the actually committed position is A3.
    boxesFindOne.mockResolvedValueOnce({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 3 },
      occupancyGrid: { A1: new ObjectId(), A2: new ObjectId() },
      currentOccupancy: 2
    });
    samplesFindOne.mockResolvedValue({
      _id: specimenId,
      barcode: 'BC-9',
      storageLocation: null
    });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(result.success).toBe(true);
    expect(result.sampleLocation.position).toBe('A3');

    // The event names the committed slot, never the stale pre-transaction
    // scan's A2.
    expect(graphProjection.appendStoragePositionEvent.mock.calls[0][1].position).toBe('A3');
  });

  // #1313 (RF023 AC3): the append runs inside the placement's transaction, so
  // a failed append aborts the placement with it; no compensating write runs.
  it('appends inside the placement transaction, and a failed append surfaces with no compensating write', async () => {
    const boxId = new ObjectId();
    const specimenId = new ObjectId();
    const session = makeSession();
    let inTransaction = false;
    session.withTransaction = vi.fn(async (fn) => {
      inTransaction = true;
      try { await fn(); } finally { inTransaction = false; }
    });
    db.client = { ...db.client, startSession: vi.fn(() => session) };
    let appendedInTransaction = null;
    graphProjection.appendStoragePositionEvent.mockImplementation(async (_db, _payload, options) => {
      appendedInTransaction = inTransaction && options?.session === session;
      throw new Error('outbox unreachable');
    });
    service = new StorageService(db, { graphProjection });

    boxesFindOne.mockResolvedValue({
      _id: boxId,
      name: 'Box A',
      dimension: { rows: 1, cols: 1 },
      occupancyGrid: {},
      currentOccupancy: 0
    });
    samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

    const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

    expect(appendedInTransaction).toBe(true);
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
    expect(result.message).toBe('outbox unreachable');
    const unsets = [...boxesUpdateOne.mock.calls, ...samplesUpdateOne.mock.calls].filter((call) => call[1]?.$unset);
    expect(unsets).toHaveLength(0);
  });

  // #988 Part 1: same topology refusal MongoStorageRepository.withTransaction
  // gives allocate/move/release, applied narrowly to this raw-session path.
  describe('#988: standalone-deployment topology refusal', () => {
    it('refuses with the descriptive RF006 item 7 error on a positively-standalone topology, before opening a session', async () => {
      const boxId = new ObjectId();
      const specimenId = new ObjectId();
      const helloCommand = vi.fn().mockResolvedValue({ ismaster: true, maxBsonObjectSize: 16777216 });
      // #994: SPREAD, do not replace. A real MongoClient carries both db() and
      // startSession(); the transaction path now derives its session from
      // db.client.startSession, so clobbering the whole client here would
      // remove the very thing under test and fail for the wrong reason.
      db.client = { ...db.client, db: vi.fn((name) => (name === 'admin' ? { command: helloCommand } : undefined)) };

      const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

      expect(result.success).toBe(false);
      expect(result.error).toBe('AUTO_ASSIGNMENT_ERROR');
      expect(result.message).toMatch(/não é um replica set nem mongos/);
      expect(result.message).toMatch(/RF006 item 7/);
      // Refused before any box/sample lookup or session open.
      expect(boxesFindOne).not.toHaveBeenCalled();
      expect(samplesFindOne).not.toHaveBeenCalled();
      // #994: was expect(db.getMongo).not.toHaveBeenCalled(). getMongo no
      // longer exists on the mock or in the product, so that assertion could
      // only ever pass. This asserts the same intent against the real entry
      // point: no session was opened before the refusal.
      expect(db.client.startSession).not.toHaveBeenCalled();
    });

    it('does NOT refuse when the topology cannot be determined (hello throws) -- unknown proceeds, matching isKnownStandaloneDeployment\'s asymmetry', async () => {
      const boxId = new ObjectId();
      const specimenId = new ObjectId();
      const helloCommand = vi.fn().mockRejectedValue(new Error('not authorized on admin to execute command'));
      // #994: SPREAD, do not replace. A real MongoClient carries both db() and
      // startSession(); the transaction path now derives its session from
      // db.client.startSession, so clobbering the whole client here would
      // remove the very thing under test and fail for the wrong reason.
      db.client = { ...db.client, db: vi.fn((name) => (name === 'admin' ? { command: helloCommand } : undefined)) };

      boxesFindOne.mockResolvedValue({
        _id: boxId,
        name: 'Box A',
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      });
      samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

      const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

      expect(result.success).toBe(true);
      expect(result.sampleLocation.position).toBe('A1');
    });

    it('does NOT refuse when the topology is a replica set (setName present)', async () => {
      const boxId = new ObjectId();
      const specimenId = new ObjectId();
      const helloCommand = vi.fn().mockResolvedValue({ setName: 'rs0', ismaster: true });
      // #994: SPREAD, do not replace. A real MongoClient carries both db() and
      // startSession(); the transaction path now derives its session from
      // db.client.startSession, so clobbering the whole client here would
      // remove the very thing under test and fail for the wrong reason.
      db.client = { ...db.client, db: vi.fn((name) => (name === 'admin' ? { command: helloCommand } : undefined)) };

      boxesFindOne.mockResolvedValue({
        _id: boxId,
        name: 'Box A',
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      });
      samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

      const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

      expect(result.success).toBe(true);
      expect(result.sampleLocation.position).toBe('A1');
    });
  });

  // #988 Part 2: the missing audit row.
  describe('#988: audit row on auto-assignment', () => {
    it('appends an immutable audit row inside the transaction, with the auto-assign eventType and matching before/after', async () => {
      const boxId = new ObjectId();
      const specimenId = new ObjectId();

      const txSession = makeSession();
      // #994: was `db.getMongo = vi.fn(() => ({ startSession: ... }))`. The
      // transaction now comes from `db.client.startSession`, which is what a
      // real MongoClient exposes. storageRepository.withTransaction still ends
      // the session in its own finally, so the ordering assertion below (audit
      // write BEFORE endSession) still measures the same thing.
      db.client = { ...db.client, startSession: vi.fn(() => txSession) };
      service = new StorageService(db, { graphProjection });

      boxesFindOne.mockResolvedValue({
        _id: boxId,
        name: 'Box A',
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      });
      samplesFindOne.mockResolvedValue({ _id: specimenId, specimenId: 'SP-9', barcode: 'BC-9', storageLocation: null });

      const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

      expect(result.success).toBe(true);
      expect(movements.insertOne).toHaveBeenCalledTimes(1);

      const [auditRow, auditOptions] = movements.insertOne.mock.calls[0];
      expect(auditRow.type).toBe('auto_allocate');
      // #1220: keyed by the canonical specimenId, as the create path writes it;
      // the graph event keeps the _id.
      expect(auditRow.specimenId).toBe('SP-9');
      expect(graphProjection.appendStoragePositionEvent.mock.calls[0][1].specimenId).toBe(specimenId.toString());
      expect(auditRow.barcode).toBe('BC-9');
      expect(auditRow.previousState).toEqual({ storageLocation: null });
      expect(auditRow.newState).toEqual({
        storageLocation: { boxId: boxId.toString(), position: 'A1' }
      });
      expect(auditRow.responsible).toBe('SYSTEM');

      // Appended INSIDE the transaction: same session object every other
      // write in this transaction used (not a bare/no-session write), and
      // ordered before the session is ever ended.
      expect(auditOptions).toEqual({ session: txSession });
      expect(boxesUpdateOne.mock.calls[0][2]).toEqual({ session: txSession });
      expect(movements.insertOne.mock.invocationCallOrder[0])
        .toBeLessThan(txSession.endSession.mock.invocationCallOrder[0]);
    });

    it('#1220: a legacy sample without a specimenId keys its audit row by the _id', async () => {
      const boxId = new ObjectId();
      const specimenId = new ObjectId();

      boxesFindOne.mockResolvedValue({
        _id: boxId,
        name: 'Box A',
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: {},
        currentOccupancy: 0
      });
      samplesFindOne.mockResolvedValue({ _id: specimenId, barcode: 'BC-9', storageLocation: null });

      const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

      expect(result.success).toBe(true);
      expect(movements.insertOne.mock.calls[0][0].specimenId).toBe(specimenId.toString());
    });

    it('does not append an audit row when the auto-assignment fails before the transaction (e.g. BOX_FULL)', async () => {
      const boxId = new ObjectId();
      const specimenId = new ObjectId();

      boxesFindOne.mockResolvedValue({
        _id: boxId,
        dimension: { rows: 1, cols: 1 },
        occupancyGrid: { A1: new ObjectId() },
        currentOccupancy: 1
      });
      samplesFindOne.mockResolvedValue({ _id: specimenId, storageLocation: null });

      const result = await service.autoAssignSampleToBox(specimenId.toString(), boxId.toString());

      expect(result.success).toBe(false);
      expect(result.error).toBe('BOX_FULL');
      expect(movements.insertOne).not.toHaveBeenCalled();
    });
  });
});

describe('StorageService.releaseSampleFromPosition', () => {
  let samplesFindOne;
  let samplesUpdateOne;
  let boxesUpdateOne;
  let storageAssignmentsFindOne;
  let movements;
  let db;
  let service;

  beforeEach(() => {
    samplesFindOne = vi.fn();
    samplesUpdateOne = vi.fn().mockResolvedValue({});
    boxesUpdateOne = vi.fn().mockResolvedValue({});
    // No open StorageAssignment by default (sample not currently allocated).
    storageAssignmentsFindOne = vi.fn().mockResolvedValue(null);
    movements = makeMovementsCollection();

    db = makeDb({
      collection: vi.fn((name) => {
        if (name === 'samples') return { findOne: samplesFindOne, updateOne: samplesUpdateOne };
        if (name === 'storageBoxes') return { updateOne: boxesUpdateOne };
        if (name === 'sample_movements') return movements;
        if (name === 'counters') return makeCountersCollection();
        if (name === 'storageAssignments') {
          return { updateOne: vi.fn().mockResolvedValue({}), findOne: storageAssignmentsFindOne };
        }
        throw new Error(`unexpected collection: ${name}`);
      })
    });
    service = new StorageService(db);
  });

  it('happy path: clears the box occupancy entry and the sample storageLocation', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-5',
      quantity: 2,
      unit: 'mL',
      // Internal Mongo-level snapshot the repository's own write path still
      // reads/writes directly (#507's own precedent) — storageService's read
      // now resolves boxId/position via the canonical storageAssignment below.
      storageLocation: { boxId, position: 'C3' }
    });
    storageAssignmentsFindOne.mockResolvedValue({ boxId, positionCode: 'C3', removedAt: null });

    const result = await service.releaseSampleFromPosition(sampleId);

    expect(result.success).toBe(true);
    expect(result.releasedFrom).toEqual({ specimenId: sampleId, boxId, position: 'C3' });

    const boxUpdateCall = boxesUpdateOne.mock.calls[0];
    expect(boxUpdateCall[1].$unset[`occupancyGrid.C3`]).toBe('');

    const sampleUpdateCall = samplesUpdateOne.mock.calls[0];
    expect(sampleUpdateCall[1].$unset).toHaveProperty('storageLocation');
  });

  // #1220: the custody ledger row is keyed by the canonical specimenId, as the
  // create path writes it; the release response keeps the _id.
  it('#1220: the audit row carries the canonical specimenId while the response keeps the _id', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      specimenId: 'SP-5',
      barcode: 'BC-5',
      storageLocation: { boxId, position: 'C3' }
    });
    storageAssignmentsFindOne.mockResolvedValue({ boxId, positionCode: 'C3', removedAt: null });

    const result = await service.releaseSampleFromPosition(sampleId);

    expect(result.success).toBe(true);
    expect(result.releasedFrom.specimenId).toBe(sampleId);
    expect(movements.insertOne.mock.calls[0][0].specimenId).toBe('SP-5');
  });

  it('#1220: a legacy sample without a specimenId keys its release audit row by the _id', async () => {
    const boxId = new ObjectId().toString();
    const sampleId = new ObjectId().toString();

    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(sampleId),
      barcode: 'BC-5',
      storageLocation: { boxId, position: 'C3' }
    });
    storageAssignmentsFindOne.mockResolvedValue({ boxId, positionCode: 'C3', removedAt: null });

    const result = await service.releaseSampleFromPosition(sampleId);

    expect(result.success).toBe(true);
    expect(movements.insertOne.mock.calls[0][0].specimenId).toBe(sampleId);
  });

  it('returns NO_STORAGE_LOCATION when the sample is not currently allocated anywhere', async () => {
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId()
    });

    const result = await service.releaseSampleFromPosition(new ObjectId().toString());

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_STORAGE_LOCATION');
    expect(boxesUpdateOne).not.toHaveBeenCalled();
  });

  it('returns SAMPLE_NOT_FOUND when the sample does not exist', async () => {
    samplesFindOne.mockResolvedValue(null);
    const result = await service.releaseSampleFromPosition(new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
  });

  it('returns RELEASE_ERROR when the box update rejects', async () => {
    const boxId = new ObjectId().toString();
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      storageLocation: { boxId, position: 'A1' }
    });
    storageAssignmentsFindOne.mockResolvedValue({ boxId, positionCode: 'A1', removedAt: null });
    boxesUpdateOne.mockRejectedValue(new Error('db down'));

    const result = await service.releaseSampleFromPosition(new ObjectId().toString());
    expect(result.success).toBe(false);
    expect(result.error).toBe('RELEASE_ERROR');
    expect(result.message).toBe('db down');
  });

  it('falls back to the raw specimenId when ObjectId.isValid throws while converting it', async () => {
    const isValidSpy = vi.spyOn(ObjectId, 'isValid').mockImplementationOnce(() => {
      throw new Error('isValid boom');
    });
    samplesFindOne.mockResolvedValue(null);

    const result = await service.releaseSampleFromPosition('some-specimen-id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('SAMPLE_NOT_FOUND');
    isValidSpy.mockRestore();
  });

  it('falls back to the raw storageAssignment.boxId when `new ObjectId()` throws on an unparseable value', async () => {
    samplesFindOne.mockResolvedValue({
      _id: new ObjectId(),
      barcode: 'BC-7',
      quantity: 1,
      storageLocation: { boxId: 'not-a-valid-object-id', position: 'A1' }
    });
    storageAssignmentsFindOne.mockResolvedValue({
      boxId: 'not-a-valid-object-id',
      positionCode: 'A1',
      removedAt: null
    });

    const result = await service.releaseSampleFromPosition(new ObjectId().toString());
    expect(result.success).toBe(true);
    expect(boxesUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'not-a-valid-object-id' }),
      expect.anything(),
      expect.anything()
    );
  });
});

describe('StorageService error-handling branches (generic catch clauses)', () => {
  it('verifyBoxIntegrity returns INTEGRITY_CHECK_ERROR when the query throws', async () => {
    const db = makeDb({
      collection: vi.fn(() => ({ findOne: vi.fn().mockRejectedValue(new Error('boom')) }))
    });
    const service = new StorageService(db);
    const result = await service.verifyBoxIntegrity(new ObjectId().toString());
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INTEGRITY_CHECK_ERROR');
    expect(result.message).toBe('boom');
  });
});
