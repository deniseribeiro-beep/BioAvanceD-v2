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

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function cursorOf(rows) {
  const cursor = {
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(rows),
  };
  return cursor;
}

function matchesDocument(doc, filter = {}) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc?.[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId)) {
      if ('$in' in expected) return expected.$in.some((value) => String(value) === String(actual));
      return false;
    }
    return String(actual) === String(expected);
  });
}

function statefulCollection(initialDocs = []) {
  const docs = initialDocs.map((doc) => ({ ...doc }));
  const collection = createCollectionMock();

  collection.findOne = vi.fn(async (filter = {}) => docs.find((doc) => matchesDocument(doc, filter)) || null);
  collection.insertOne = vi.fn(async (doc) => {
    docs.push(doc);
    return {
      insertedId: doc?._id || doc?.specimenContainerAssignmentId ||
        doc?.containerPositionAssignmentId || doc?.rackLocationAssignmentId || new ObjectId()
    };
  });
  collection.updateOne = vi.fn(async (filter = {}, update = {}, options = {}) => {
    let doc = docs.find((candidate) => matchesDocument(candidate, filter));
    if (!doc && options?.upsert) {
      doc = { ...filter, ...(update.$setOnInsert || {}) };
      docs.push(doc);
    }
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (update.$set) Object.assign(doc, update.$set);
    return { matchedCount: 1, modifiedCount: 1 };
  });
  collection.find = vi.fn((filter = {}) => cursorOf(docs.filter((doc) => matchesDocument(doc, filter))));
  collection.__docs = docs;
  return collection;
}

function ledgerCollections() {
  return {
    counters: createCollectionMock({
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'sample_movements', seq: 1 }),
    }),
    sample_movements: createCollectionMock({
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(null) }),
        }),
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    }),
  };
}

function buildAutoAllocationDb({ accessType = 2, boxFull = false, specimenMissing = false } = {}) {
  const specimenObjectId = new ObjectId();
  const boxId = new ObjectId();
  const specimen = specimenMissing ? null : {
    _id: specimenObjectId,
    specimenId: 'SP-1006-AUTO',
    participantId: 'PART-1006',
    barcode: 'BIO-1006-AUTO',
    specimenStatus: 'available',
  };
  const box = {
    _id: boxId,
    name: 'Box Auto',
    dimension: { rows: 1, cols: boxFull ? 1 : 2 },
    occupancyGrid: boxFull ? { A1: new ObjectId() } : {},
    currentOccupancy: boxFull ? 1 : 0,
    status: boxFull ? 'FULL' : 'ACTIVE',
    canonicalStorageRackId: String(boxId),
  };

  const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(specimen) });
  const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(box) });
  const storagePaths = createCollectionMock({
    findOne: vi.fn().mockResolvedValue({ boxId, rackId: 'rack-config', shelfId: 'shelf-config', freezerId: 'freezer-config' }),
  });
  const operationalFreezer = { _id: 'freezer-config', containerType: 'FREEZER', roomId: null, status: 'OPERATIONAL' };
  const storageContainers = createCollectionMock({
    findOne: vi.fn(async (query = {}) => {
      if (query?.status?.$ne === 'OPERATIONAL') return null;
      return operationalFreezer;
    }),
  });

  const containers = statefulCollection();
  const storageRacks = statefulCollection();
  const storagePositions = statefulCollection();
  const specimenContainerAssignments = statefulCollection();
  const containerPositionAssignments = statefulCollection();
  const rackLocationAssignments = statefulCollection();
  const graphProjectionOutbox = createCollectionMock();

  const activeConsent = {
    consentId: 'consent-1006',
    participantId: 'PART-1006',
    currentStateDerived: 'active',
    effectivePeriod: { start: new Date('2026-01-01T00:00:00Z'), end: null },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const consents = createCollectionMock({ find: vi.fn(() => cursorOf([activeConsent])) });
  const consentRevocations = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
  const consentAuthorizationDecisions = createCollectionMock();

  const collections = {
    samples,
    storageBoxes,
    storagePaths,
    storageContainers,
    containers,
    storageRacks,
    storagePositions,
    specimenContainerAssignments,
    containerPositionAssignments,
    rackLocationAssignments,
    graph_projection_outbox: graphProjectionOutbox,
    consents,
    consentRevocations,
    consentAuthorizationDecisions,
    ...ledgerCollections(),
    ...buildRbacCollections([{ userAccountId: 'qa-user-1', accessType }]),
  };

  const db = createDbMock(collections);
  return { db, specimenObjectId, boxId, collections };
}

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-auto-1006' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-auto-1006' });
});

afterEach(() => vi.restoreAllMocks());

describe('POST /api/storage/allocate/auto (#1006)', () => {
  it('enforces manageStorageAllocation server-side', async () => {
    const { db, specimenObjectId, boxId } = buildAutoAllocationDb({ accessType: 1 });
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/allocate/auto')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ specimenId: String(specimenObjectId), boxId: String(boxId) });

    expect(res.status).toBe(403);
    expect(db.client.startSession).not.toHaveBeenCalled();
  });

  it('returns 404 before transaction when the specimen does not exist', async () => {
    const { db, specimenObjectId, boxId } = buildAutoAllocationDb({ specimenMissing: true });
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/allocate/auto')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: String(specimenObjectId), boxId: String(boxId) });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('SAMPLE_NOT_FOUND');
    expect(db.client.startSession).not.toHaveBeenCalled();
  });

  it('returns 409 before transaction when the box has no free position', async () => {
    const { db, specimenObjectId, boxId } = buildAutoAllocationDb({ boxFull: true });
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/allocate/auto')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: String(specimenObjectId), boxId: String(boxId) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BOX_FULL');
    expect(db.client.startSession).not.toHaveBeenCalled();
  });

  it('uses one Mongo session for normalized placement, audit and graph outbox', async () => {
    const { db, specimenObjectId, boxId, collections } = buildAutoAllocationDb();
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/allocate/auto')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ specimenId: String(specimenObjectId), boxId: String(boxId) });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.currentStoragePlacement).toEqual(expect.objectContaining({
      specimenId: String(specimenObjectId),
      positionCode: 'A1'
    }));
    expect(res.body.projectionQueued).toBe(true);
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
    expect(db.session.endSession).toHaveBeenCalledTimes(1);

    const session = db.session;
    expect(collections.storageBoxes.updateOne).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ session })
    );
    expect(collections.containers.updateOne).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ session })
    );
    expect(collections.specimenContainerAssignments.insertOne).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ session })
    );
    expect(collections.containerPositionAssignments.insertOne).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ session })
    );
    expect(collections.rackLocationAssignments.insertOne).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ session })
    );
    expect(collections.sample_movements.insertOne).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ session })
    );
    expect(collections.graph_projection_outbox.updateOne).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ session })
    );
  });
});
