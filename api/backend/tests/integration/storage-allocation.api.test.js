import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

function cloneBsonValue(value) {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString());
  if (value instanceof Date) return new Date(value.getTime());
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(cloneBsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneBsonValue(item)]));
  }
  return value;
}

function sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
}

function getPath(obj, path) {
  return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], obj);
}

function setPath(obj, path, value) {
  const keys = String(path).split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!cursor[keys[i]] || typeof cursor[keys[i]] !== 'object') cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

function unsetPath(obj, path) {
  const keys = String(path).split('.');
  const parent = keys.slice(0, -1).reduce((value, key) => value?.[key], obj);
  if (parent) delete parent[keys[keys.length - 1]];
}

function matchesCondition(actual, expected) {
  if (expected instanceof ObjectId || expected instanceof Date || expected instanceof RegExp || expected === null || typeof expected !== 'object') {
    if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
    return sameValue(actual, expected);
  }
  for (const [op, value] of Object.entries(expected)) {
    if (op === '$exists' && Boolean(actual !== undefined) !== Boolean(value)) return false;
    if (op === '$ne' && sameValue(actual, value)) return false;
    if (op === '$in' && !value.some((candidate) => sameValue(actual, candidate))) return false;
    if (op === '$lte' && !(actual <= value)) return false;
    if (op === '$gte' && !(actual >= value)) return false;
  }
  return true;
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((part) => matches(doc, part));
    if (key === '$and') return expected.every((part) => matches(doc, part));
    return matchesCondition(getPath(doc, key), expected);
  });
}

function createStatefulCollection(initial = []) {
  const docs = initial.map(cloneBsonValue);
  const cursorFor = (rows) => ({
    sort: vi.fn((criteria = {}) => {
      const [[field, direction = 1]] = Object.entries(criteria);
      const sorted = [...rows].sort((a, b) => {
        const av = getPath(a, field); const bv = getPath(b, field);
        return av === bv ? 0 : (av > bv ? direction : -direction);
      });
      return cursorFor(sorted);
    }),
    limit: vi.fn((n) => cursorFor(rows.slice(0, n))),
    skip: vi.fn((n) => cursorFor(rows.slice(n))),
    project: vi.fn(() => cursorFor(rows)),
    toArray: vi.fn().mockResolvedValue(rows),
    next: vi.fn().mockResolvedValue(rows[0] || null)
  });

  const collection = {
    docs,
    collectionName: 'stateful',
    createIndex: vi.fn().mockResolvedValue(null),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matches(doc, filter)) || null),
    find: vi.fn((filter = {}) => cursorFor(docs.filter((doc) => matches(doc, filter)))),
    countDocuments: vi.fn(async (filter = {}) => docs.filter((doc) => matches(doc, filter)).length),
    insertOne: vi.fn(async (doc) => {
      const stored = cloneBsonValue(doc);
      if (!stored._id) stored._id = new ObjectId();
      docs.push(stored);
      return { insertedId: stored._id };
    }),
    insertMany: vi.fn(async (rows) => {
      rows.forEach((row) => docs.push(cloneBsonValue(row)));
      return { insertedCount: rows.length };
    }),
    updateOne: vi.fn(async (filter, update, options = {}) => {
      let doc = docs.find((row) => matches(row, filter));
      let upserted = false;
      if (!doc && options.upsert) {
        doc = {};
        for (const [key, value] of Object.entries(filter)) {
          if (!key.startsWith('$') && (value === null || typeof value !== 'object' || value instanceof ObjectId)) setPath(doc, key, cloneBsonValue(value));
        }
        docs.push(doc);
        upserted = true;
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (upserted && update.$setOnInsert) Object.entries(update.$setOnInsert).forEach(([key, value]) => setPath(doc, key, cloneBsonValue(value)));
      if (update.$set) Object.entries(update.$set).forEach(([key, value]) => setPath(doc, key, cloneBsonValue(value)));
      if (update.$unset) Object.keys(update.$unset).forEach((key) => unsetPath(doc, key));
      if (update.$inc) Object.entries(update.$inc).forEach(([key, value]) => setPath(doc, key, Number(getPath(doc, key) || 0) + Number(value)));
      return { matchedCount: upserted ? 0 : 1, modifiedCount: 1, upsertedCount: upserted ? 1 : 0 };
    }),
    updateMany: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 })
  };
  return collection;
}

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

const SAMPLE_ID = new ObjectId();
const SOURCE_BOX_ID = new ObjectId();
const TARGET_BOX_ID = new ObjectId();
const PARTICIPANT_ID = 'participant-storage-v2';

function activeConsentCollections() {
  const now = new Date();
  return {
    consents: createStatefulCollection([{
      consentId: 'consent-storage-v2',
      participantId: PARTICIPANT_ID,
      currentStateDerived: 'active',
      effectivePeriod: { start: new Date(now.getTime() - 86400000), end: null },
      createdAt: now
    }]),
    consentPermissions: createStatefulCollection(),
    consentRevocations: createStatefulCollection(),
    consentAuthorizationDecisions: createStatefulCollection()
  };
}

function movementCollections() {
  return {
    counters: createCollectionMock({ findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'sample_movements', seq: 1 }) }),
    sample_movements: createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(null) }) })
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() })
    })
  };
}

function canonicalSeed(boxId = SOURCE_BOX_ID, positionCode = 'A1') {
  const specimenId = String(SAMPLE_ID);
  const rackId = String(boxId);
  const containerId = `container:${specimenId}`;
  const positionId = `${rackId}:${positionCode}`;
  return {
    containers: [{ containerId, status: 'active', emptyStatus: 'occupied' }],
    specimenContainerAssignments: [{
      specimenContainerAssignmentId: 'sca-seeded', specimenId, containerId,
      loadedAt: new Date(), unloadedAt: null, assignmentStatus: 'active', sourceEventId: 'evt-seeded'
    }],
    containerPositionAssignments: [{
      containerPositionAssignmentId: 'cpa-seeded', containerId, storagePositionId: positionId,
      placedAt: new Date(), removedAt: null, assignmentStatus: 'active'
    }],
    storagePositions: [{ storagePositionId: positionId, storageRackId: rackId, positionCode, status: 'occupied' }],
    storageRacks: [{ storageRackId: rackId, rowCount: 2, columnCount: 2, status: 'active' }],
    rackLocationAssignments: [{
      rackLocationAssignmentId: 'rla-seeded', storageRackId: rackId, storageLocationId: rackId,
      placedAt: new Date(), removedAt: null, assignmentStatus: 'active'
    }]
  };
}

function buildDb({ withPlacement = false, accessType = 2 } = {}) {
  const seeded = withPlacement ? canonicalSeed() : {
    containers: [], specimenContainerAssignments: [], containerPositionAssignments: [],
    storagePositions: [], storageRacks: [], rackLocationAssignments: []
  };
  const sourceBox = {
    _id: SOURCE_BOX_ID,
    name: 'Source Box',
    dimension: { rows: 2, cols: 2 },
    occupancyGrid: withPlacement ? { A1: SAMPLE_ID } : {},
    currentOccupancy: withPlacement ? 1 : 0,
    ...(withPlacement ? { canonicalStorageRackId: String(SOURCE_BOX_ID) } : {})
  };
  const targetBox = {
    _id: TARGET_BOX_ID,
    name: 'Target Box',
    dimension: { rows: 2, cols: 2 },
    occupancyGrid: {},
    currentOccupancy: 0
  };

  const collections = {
    samples: createStatefulCollection([{
      _id: SAMPLE_ID,
      specimenId: String(SAMPLE_ID),
      barcode: 'BC-STORAGE-V2',
      participantId: PARTICIPANT_ID,
      specimenStatus: 'available'
    }]),
    storageBoxes: createStatefulCollection([sourceBox, targetBox]),
    storageContainers: createStatefulCollection(),
    storagePaths: createStatefulCollection(),
    rooms: createStatefulCollection(),
    containers: createStatefulCollection(seeded.containers),
    specimenContainerAssignments: createStatefulCollection(seeded.specimenContainerAssignments),
    containerPositionAssignments: createStatefulCollection(seeded.containerPositionAssignments),
    storagePositions: createStatefulCollection(seeded.storagePositions),
    storageRacks: createStatefulCollection(seeded.storageRacks),
    rackLocationAssignments: createStatefulCollection(seeded.rackLocationAssignments),
    graph_projection_outbox: createStatefulCollection(),
    ...activeConsentCollections(),
    ...movementCollections(),
    ...buildRbacCollections([{ userAccountId: 'qa-user-1', accessType }])
  };
  const db = createDbMock(collections);
  return { db, collections };
}

beforeEach(() => givenSession());
afterEach(() => vi.restoreAllMocks());

describe('storage transactional routes canonical v2 (#1006)', () => {
  it('keeps manageStorageAllocation enforced server-side', async () => {
    const { db } = buildDb({ accessType: 1 });
    app.locals.db = db;
    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ specimenId: String(SAMPLE_ID), boxId: String(SOURCE_BOX_ID), position: 'A1' });
    expect(res.status).toBe(403);
    expect(db.client.startSession).not.toHaveBeenCalled();
  });

  it('POST /allocate persists the normalized custody chain in one real mock transaction', async () => {
    const { db, collections } = buildDb();
    app.locals.db = db;
    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: String(SAMPLE_ID), boxId: String(SOURCE_BOX_ID), position: 'A1' });

    expect(res.status).toBe(201);
    expect(res.body.currentStoragePlacement).toMatchObject({ boxId: String(SOURCE_BOX_ID), positionCode: 'A1' });
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(db.session.endSession).toHaveBeenCalledTimes(1);
    expect(collections.specimenContainerAssignments.insertOne).toHaveBeenCalledWith(expect.anything(), { session: db.session });
    expect(collections.containerPositionAssignments.insertOne).toHaveBeenCalledWith(expect.anything(), { session: db.session });
    expect(collections.sample_movements.insertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session: db.session }));
  });

  it('POST /allocate/auto is integrated and returns the same canonical placement contract', async () => {
    const { db, collections } = buildDb();
    app.locals.db = db;
    const res = await request(app)
      .post('/api/storage/allocate/auto')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: String(SAMPLE_ID), boxId: String(SOURCE_BOX_ID) });

    expect(res.status).toBe(201);
    expect(res.body.currentStoragePlacement).toMatchObject({ boxId: String(SOURCE_BOX_ID), positionCode: 'A1' });
    expect(res.body.projectionQueued).toBe(true);
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(collections.specimenContainerAssignments.insertOne).toHaveBeenCalledWith(expect.anything(), { session: db.session });
    expect(collections.sample_movements.insertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session: db.session }));
  });

  it('POST /move closes the old normalized placement and creates the new placement atomically', async () => {
    const { db, collections } = buildDb({ withPlacement: true });
    app.locals.db = db;
    const res = await request(app)
      .post('/api/storage/move')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: String(SAMPLE_ID), targetBoxId: String(TARGET_BOX_ID), targetPosition: 'B2', reason: 'integration' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(collections.containerPositionAssignments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ containerPositionAssignmentId: 'cpa-seeded', assignmentStatus: 'active' }),
      expect.objectContaining({ $set: expect.objectContaining({ assignmentStatus: 'inactive' }) }),
      { session: db.session }
    );
    expect(collections.containerPositionAssignments.insertOne).toHaveBeenCalledWith(expect.anything(), { session: db.session });
    expect(collections.sample_movements.insertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session: db.session }));
  });

  it('DELETE /release/:specimenId closes the normalized placement and writes immutable audit in the same session', async () => {
    const { db, collections } = buildDb({ withPlacement: true });
    app.locals.db = db;
    const res = await request(app)
      .delete(`/api/storage/release/${SAMPLE_ID}`)
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(collections.containerPositionAssignments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ containerPositionAssignmentId: 'cpa-seeded', assignmentStatus: 'active' }),
      expect.objectContaining({ $set: expect.objectContaining({ assignmentStatus: 'inactive' }) }),
      { session: db.session }
    );
    expect(collections.sample_movements.insertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session: db.session }));
  });
});
