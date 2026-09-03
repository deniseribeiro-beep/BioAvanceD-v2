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

// #1006: route -> requirePermission -> controller -> service integration
// coverage for the storage mutation routes (POST /allocate, POST /move,
// DELETE /release/:sampleId), against a db no test author fabricated
// methods onto. See db.factory.js's own comments for why that matters:
// #994 was 41 green unit tests certifying a dead endpoint because a mock
// invented a method the real driver doesn't have.

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function dbWithRbac(collections, accessType = 4) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections([{ userAccountId: 'qa-user-1', accessType }]),
  });
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const SAMPLE_ID = new ObjectId();
const BOX_ID = new ObjectId();
const TARGET_BOX_ID = new ObjectId();

// Three fixture hazards verified in db.factory.js's createCollectionMock:
// no `findOneAndUpdate` (the movement-id counter path needs one on
// `counters`) and no cursor `.next()` (the movement ledger's hash-chain
// read needs one on `sample_movements`). Any test whose request reaches
// the transaction's audit-append step needs both, or the call is a
// TypeError caught upstream and surfaced as a generic 500 that would look,
// to an unwary assertion, just like a legitimate rejection.
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

describe('POST /api/storage/allocate', () => {
  it('rejects accessType 1 with 403 -- the permission gate is server-side, not a frontend hide', async () => {
    const samples = createCollectionMock();
    const storageBoxes = createCollectionMock();
    app.locals.db = dbWithRbac({ samples, storageBoxes, ...ledgerCollections() }, 1);

    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ sampleId: SAMPLE_ID.toString(), boxId: BOX_ID.toString(), position: 'A1' });

    expect(res.status).toBe(403);
  });

  it('accessType 2 allocates successfully and really enters a transaction -- session opened once, ended once', async () => {
    const sample = { _id: SAMPLE_ID, barcode: 'BR-001', storageLocation: null };
    const box = { _id: BOX_ID, name: 'Box A1-01', dimension: { rows: 9, cols: 9 }, occupancyGrid: {} };
    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sample) });
    const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(box) });
    const storageAssignments = createCollectionMock();
    const db = dbWithRbac({ samples, storageBoxes, storageAssignments, ...ledgerCollections() }, 2);
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sampleId: SAMPLE_ID.toString(), boxId: BOX_ID.toString(), position: 'A1' });

    expect(res.status).toBe(201);
    expect(db.client.startSession).toHaveBeenCalledTimes(1);
    expect(db.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('carries the same transaction session on every write -- box update, sample update, assignment insert, movement insert', async () => {
    const sample = { _id: SAMPLE_ID, barcode: 'BR-001', storageLocation: null };
    const box = { _id: BOX_ID, name: 'Box A1-01', dimension: { rows: 9, cols: 9 }, occupancyGrid: {} };
    const boxUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const sampleUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const assignmentInsertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sample), updateOne: sampleUpdateOne });
    const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(box), updateOne: boxUpdateOne });
    const storageAssignments = createCollectionMock({ insertOne: assignmentInsertOne });
    const { sample_movements, counters } = ledgerCollections();
    const db = dbWithRbac({ samples, storageBoxes, storageAssignments, sample_movements, counters }, 2);
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sampleId: SAMPLE_ID.toString(), boxId: BOX_ID.toString(), position: 'A1' });

    expect(res.status).toBe(201);
    const session = db.session;
    expect(boxUpdateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ session }));
    expect(sampleUpdateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ session }));
    expect(assignmentInsertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session }));
    expect(sample_movements.insertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session }));
  });

  it('a box-update matchedCount:0 surfaces as 409, not 500 -- the occupancy-collision guard actually fires', async () => {
    const sample = { _id: SAMPLE_ID, barcode: 'BR-001', storageLocation: null };
    const box = { _id: BOX_ID, name: 'Box A1-01', dimension: { rows: 9, cols: 9 }, occupancyGrid: { A1: SAMPLE_ID } };
    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sample) });
    const storageBoxes = createCollectionMock({
      findOne: vi.fn().mockResolvedValue(box),
      // Hazard #3 from db.factory.js: updateOne defaults to matchedCount:1,
      // so the compare-and-set occupancy guard can't fire by default. A
      // green 201 there would only prove the route reached the write, not
      // that the guard works. Overriding it here is what actually exercises
      // the collision path.
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    });
    app.locals.db = dbWithRbac({ samples, storageBoxes, ...ledgerCollections() }, 2);

    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sampleId: SAMPLE_ID.toString(), boxId: BOX_ID.toString(), position: 'A1' });

    expect(res.status).toBe(409);
  });

  it('an infrastructure failure on the sample lookup surfaces as 500, not masked as a 400', async () => {
    const samples = createCollectionMock({ findOne: vi.fn().mockRejectedValue(new Error('driver exploded')) });
    app.locals.db = dbWithRbac({ samples, ...ledgerCollections() }, 2);

    const res = await request(app)
      .post('/api/storage/allocate')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sampleId: SAMPLE_ID.toString(), boxId: BOX_ID.toString(), position: 'A1' });

    expect(res.status).toBe(500);
  });
});

describe('POST /api/storage/move', () => {
  it('rejects accessType 1 with 403', async () => {
    app.locals.db = dbWithRbac({ ...ledgerCollections() }, 1);

    const res = await request(app)
      .post('/api/storage/move')
      .set('Authorization', `Bearer ${makeToken(1)}`)
      .send({ sampleId: SAMPLE_ID.toString(), targetBoxId: TARGET_BOX_ID.toString(), targetPosition: 'B2' });

    expect(res.status).toBe(403);
  });

  it('a body missing targetPosition is 400 and never opens a session -- the validation gate really is pre-transaction', async () => {
    const db = dbWithRbac({ ...ledgerCollections() }, 2);
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/move')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sampleId: SAMPLE_ID.toString(), targetBoxId: TARGET_BOX_ID.toString() });

    expect(res.status).toBe(400);
    expect(db.client.startSession).not.toHaveBeenCalled();
  });

  it('a valid move succeeds and the movement insert carries the transaction session', async () => {
    const sample = { _id: SAMPLE_ID, barcode: 'BR-001', storageLocation: { boxId: BOX_ID, position: 'A1' } };
    const targetBox = { _id: TARGET_BOX_ID, name: 'Box B', dimension: { rows: 9, cols: 9 }, occupancyGrid: {} };
    const openAssignment = { specimenId: String(SAMPLE_ID), boxId: BOX_ID, positionCode: 'A1', removedAt: null };

    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sample) });
    const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(targetBox) });
    const storageAssignments = createCollectionMock({ findOne: vi.fn().mockResolvedValue(openAssignment) });
    const { sample_movements, counters } = ledgerCollections();
    const db = dbWithRbac({ samples, storageBoxes, storageAssignments, sample_movements, counters }, 2);
    app.locals.db = db;

    const res = await request(app)
      .post('/api/storage/move')
      .set('Authorization', `Bearer ${makeToken(2)}`)
      .send({ sampleId: SAMPLE_ID.toString(), targetBoxId: TARGET_BOX_ID.toString(), targetPosition: 'B2' });

    expect(res.status).toBe(200);
    expect(sample_movements.insertOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ session: db.session }));
  });
});

describe('DELETE /api/storage/release/:sampleId', () => {
  it('rejects accessType 1 with 403', async () => {
    app.locals.db = dbWithRbac({ ...ledgerCollections() }, 1);

    const res = await request(app)
      .delete(`/api/storage/release/${SAMPLE_ID}`)
      .set('Authorization', `Bearer ${makeToken(1)}`);

    expect(res.status).toBe(403);
  });

  it('a sample with no open storage assignment is 400 and never opens a session', async () => {
    const sample = { _id: SAMPLE_ID, barcode: 'BR-001', storageLocation: { boxId: BOX_ID, position: 'A1' } };
    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sample) });
    // storageAssignments deliberately left at its default findOne (-> null):
    // no open StorageAssignment row for this specimen.
    const db = dbWithRbac({ samples, ...ledgerCollections() }, 2);
    app.locals.db = db;

    const res = await request(app)
      .delete(`/api/storage/release/${SAMPLE_ID}`)
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(400);
    expect(db.client.startSession).not.toHaveBeenCalled();
  });

  it('a valid release succeeds and the assignment-closing update carries the transaction session', async () => {
    const sample = { _id: SAMPLE_ID, barcode: 'BR-001', storageLocation: { boxId: BOX_ID, position: 'A1' } };
    const openAssignment = { specimenId: String(SAMPLE_ID), boxId: BOX_ID, positionCode: 'A1', removedAt: null };
    const assignmentUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const samples = createCollectionMock({ findOne: vi.fn().mockResolvedValue(sample) });
    const storageAssignments = createCollectionMock({ findOne: vi.fn().mockResolvedValue(openAssignment), updateOne: assignmentUpdateOne });
    const db = dbWithRbac({ samples, storageAssignments, ...ledgerCollections() }, 2);
    app.locals.db = db;

    const res = await request(app)
      .delete(`/api/storage/release/${SAMPLE_ID}`)
      .set('Authorization', `Bearer ${makeToken(2)}`);

    expect(res.status).toBe(200);
    expect(assignmentUpdateOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ session: db.session }));
  });
});
