import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { createMatchingCollection } = require('../factories/filter.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #1379: a freezer's room is a StorageLocation of type room (P1X-0099), and
// the assignment is the freezer location's parentLocationId (P1X-0102).
// storageContainers.roomId (ELM-0169, deprecated) and `rooms` are no longer
// read or written by this route.

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

const ROOM_ID = new ObjectId();
const FREEZER_ID = new ObjectId();
const EQUIPMENT_ID = 4201;

const FAKE_FREEZER = { _id: FREEZER_ID, name: 'Ultra-Freezer 01', containerType: 'FREEZER', containerID: EQUIPMENT_ID, parent_id: null, deletedAt: null };
const FAKE_SHELF = { _id: new ObjectId(), name: 'Shelf 1', containerType: 'SHELF', parent_id: FREEZER_ID, deletedAt: null };

function roomLocation(overrides = {}) {
  return {
    storageLocationId: 'loc-room-1',
    code: `legacy-room:${ROOM_ID}`,
    name: 'Sala 1',
    locationType: 'room',
    parentLocationId: null,
    organizationId: 'org-1',
    ...overrides,
  };
}

// The freezer's Equipment names org-1; organizationIdFor needs it stored.
function topology({ containers = [FAKE_FREEZER], storageLocations = [roomLocation()] } = {}) {
  return {
    storageContainers: createMatchingCollection(containers, { collectionName: 'storageContainers' }),
    equipment: createMatchingCollection([{ _id: new ObjectId(), equipmentID: EQUIPMENT_ID, organizationId: 'org-1', deletedAt: null }], { collectionName: 'equipment' }),
    organizations: createMatchingCollection([{ organizationId: 'org-1' }, { organizationId: 'org-2' }], { collectionName: 'organizations' }),
    storageLocations: createMatchingCollection(storageLocations, { collectionName: 'storageLocations' }),
  };
}

function freezerLocations(collections) {
  return collections.storageLocations.docs.filter((location) => location.locationType === 'freezer');
}

function patchRoom(body, freezerId = FREEZER_ID) {
  return request(app)
    .patch(`/api/storage/freezer/${freezerId}/room`)
    .set('Authorization', `Bearer ${makeToken(4)}`)
    .send(body);
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('PATCH /api/storage/freezer/:freezerId/room', () => {
  it('returns 404 when freezer does not exist', async () => {
    app.locals.db = dbWithRbac(topology({ containers: [] }), 4);

    const res = await patchRoom({ roomId: 'loc-room-1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('FREEZER_NOT_FOUND');
  });

  // #1022: the catch-all was the ONLY failure path in this router that did
  // not use 5xx -- it answered 400 with error INTERNAL_ERROR, which tells a
  // caller "you sent something wrong" and "the server broke" in the same
  // body. The route's own expected failures (FREEZER_NOT_FOUND 404,
  // NOT_A_FREEZER 400, ROOM_NOT_FOUND 404) are all handled above the catch,
  // so nothing legitimate reaches it -- only a genuine unhandled exception.
  // Same class #892 already fixed in this router for checkBoxIntegrity.
  it('#1022: an unhandled exception answers 500, not 400', async () => {
    const storageColl = createCollectionMock({
      findOne: vi.fn().mockRejectedValue(new Error('driver exploded')),
    });
    app.locals.db = dbWithRbac({ storageContainers: storageColl }, 4);

    const res = await patchRoom({ roomId: 'loc-room-1' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
    expect(res.body.success).toBe(false);
  });

  it('rejects a non-FREEZER container with 400', async () => {
    app.locals.db = dbWithRbac(topology({ containers: [FAKE_FREEZER, FAKE_SHELF] }), 4);

    const res = await patchRoom({ roomId: 'loc-room-1' }, FAKE_SHELF._id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NOT_A_FREEZER');
  });

  it('returns 404 ROOM_NOT_FOUND when roomId names no location', async () => {
    const collections = topology();
    app.locals.db = dbWithRbac(collections, 4);

    const res = await patchRoom({ roomId: 'loc-missing' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ROOM_NOT_FOUND');
    expect(freezerLocations(collections)).toEqual([]);
  });

  it('returns 404 ROOM_NOT_FOUND when roomId names a location that is not a room', async () => {
    const collections = topology({ storageLocations: [roomLocation({ storageLocationId: 'loc-shelf', locationType: 'shelf', code: 'legacy-storage-container:S9' })] });
    app.locals.db = dbWithRbac(collections, 4);

    const res = await patchRoom({ roomId: 'loc-shelf' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('ROOM_NOT_FOUND');
    expect(freezerLocations(collections)).toEqual([]);
  });

  it('returns 422 ROOM_OUT_OF_ORGANIZATION for another organization\'s room', async () => {
    const collections = topology({ storageLocations: [roomLocation({ organizationId: 'org-2' })] });
    app.locals.db = dbWithRbac(collections, 4);

    const res = await patchRoom({ roomId: 'loc-room-1' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('ROOM_OUT_OF_ORGANIZATION');
    expect(freezerLocations(collections)).toEqual([]);
  });

  it('assigns the room: the freezer location is created under the room location', async () => {
    const collections = topology();
    app.locals.db = dbWithRbac(collections, 4);

    const res = await patchRoom({ roomId: 'loc-room-1' });

    expect(res.status).toBe(200);
    const [freezerLocation] = freezerLocations(collections);
    expect(freezerLocation).toMatchObject({ parentLocationId: 'loc-room-1', organizationId: 'org-1' });
    expect(res.body.data).toEqual({ _id: String(FREEZER_ID), roomId: 'loc-room-1', storageLocationId: freezerLocation.storageLocationId });
    expect(collections.storageContainers.updateOne).not.toHaveBeenCalled();
  });

  it('resolves an old Room _id through its legacy-room code', async () => {
    const collections = topology();
    app.locals.db = dbWithRbac(collections, 4);

    const res = await patchRoom({ roomId: ROOM_ID.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.roomId).toBe('loc-room-1');
    expect(freezerLocations(collections)).toEqual([expect.objectContaining({ parentLocationId: 'loc-room-1' })]);
  });

  it('unassigns when the body omits roomId: the freezer location\'s parent becomes null', async () => {
    const collections = topology({
      storageLocations: [
        roomLocation(),
        { storageLocationId: 'loc-freezer-1', code: `legacy-storage-container:${FREEZER_ID}`, name: 'Ultra-Freezer 01', locationType: 'freezer', parentLocationId: 'loc-room-1', organizationId: 'org-1' },
      ],
    });
    app.locals.db = dbWithRbac(collections, 4);

    const res = await patchRoom({});

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ _id: String(FREEZER_ID), roomId: null, storageLocationId: 'loc-freezer-1' });
    expect(freezerLocations(collections)).toEqual([expect.objectContaining({ storageLocationId: 'loc-freezer-1', parentLocationId: null })]);
    expect(collections.storageContainers.updateOne).not.toHaveBeenCalled();
  });
});
