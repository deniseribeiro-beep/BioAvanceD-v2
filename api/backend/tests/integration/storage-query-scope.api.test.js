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
const { sampleOrganizationScopeClause } = require('../../src/services/sampleTenancy.service');

// #1211, the read half: the eight storage GETs described every
// organization's freezers, boxes and specimen positions to any authenticated
// caller. Same two scope keys as the mutations (storage-allocation.api.test.js):
// a specimen by its tenancy key (#1192), a box or freezer by its root freezer's
// Equipment. A single-record read out of scope answers 403 (#340's
// get-by-id precedent); the two list reads filter instead.

function makeToken(accessType = 2) {
  return jwt.sign(
    { userID: 'qa-user-1', accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Técnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function dbWithRbac(collections, accessType = 2) {
  return createDbMock({
    ...collections,
    ...buildRbacCollections([{ userAccountId: 'qa-user-1', accessType }]),
  });
}

beforeEach(() => {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
});
afterEach(() => { vi.restoreAllMocks(); });

// rbac.factory.js resolves a non-admin caller to 'test-org-default'.
const HOME_ORG = 'test-org-default';
const HOME_TREE = { freezerId: new ObjectId(), shelfId: new ObjectId(), rackId: new ObjectId() };
const FOREIGN_TREE = { freezerId: new ObjectId(), shelfId: new ObjectId(), rackId: new ObjectId() };
const SAMPLE_ID = new ObjectId();
const BOX_ID = new ObjectId();

function treeInOrg(organizationId, tree, equipmentID = 4201) {
  const byId = new Map([
    [String(tree.freezerId), { _id: tree.freezerId, name: 'UF', containerType: 'FREEZER', containerID: equipmentID, parent_id: null, deletedAt: null }],
    [String(tree.shelfId), { _id: tree.shelfId, containerType: 'SHELF', parent_id: tree.freezerId, deletedAt: null }],
    [String(tree.rackId), { _id: tree.rackId, containerType: 'RACK', parent_id: tree.shelfId, deletedAt: null }],
  ]);
  return {
    storageContainers: createCollectionMock({
      findOne: vi.fn().mockImplementation(async (filter) => (
        filter?._id instanceof ObjectId ? byId.get(String(filter._id)) || null : null
      )),
    }),
    equipment: createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), equipmentID, organizationId, deletedAt: null }),
    }),
  };
}

function boxUnder(tree) {
  return { _id: BOX_ID, name: 'Box', parent_id: tree.rackId, dimension: { rows: 9, cols: 9 }, occupancyGrid: {}, currentOccupancy: 0 };
}

async function get(path, accessType = 2) {
  return request(app).get(`/api/storage${path}`).set('Authorization', `Bearer ${makeToken(accessType)}`);
}

describe('single-record storage reads are bounded by the caller organization (#1211)', () => {
  it('GET /sample/:sampleId refuses another organization\'s specimen', async () => {
    const samples = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: SAMPLE_ID, barcode: 'BR-9', collectionSite: 'org-other' }),
    });
    app.locals.db = dbWithRbac({ samples });

    const res = await get(`/sample/${SAMPLE_ID}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SAMPLE_OUT_OF_SCOPE');
  });

  // #1192: the tenancy key is organizationId; collectionSite is read only
  // while it is unset.
  it('GET /sample/:sampleId answers for a specimen whose organizationId is the caller\'s, collected elsewhere', async () => {
    const samples = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: SAMPLE_ID, barcode: 'BR-9', organizationId: HOME_ORG, collectionSite: 'org-other' }),
    });
    app.locals.db = dbWithRbac({ samples });

    const res = await get(`/sample/${SAMPLE_ID}`);

    expect(res.status).not.toBe(403);
    expect(res.body.error).not.toBe('SAMPLE_OUT_OF_SCOPE');
  });

  it('GET /sample/:sampleId refuses a specimen collected at the caller\'s site whose organizationId is another\'s', async () => {
    const samples = createCollectionMock({
      findOne: vi.fn().mockResolvedValue({ _id: SAMPLE_ID, barcode: 'BR-9', organizationId: 'org-other', collectionSite: HOME_ORG }),
    });
    app.locals.db = dbWithRbac({ samples });

    const res = await get(`/sample/${SAMPLE_ID}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SAMPLE_OUT_OF_SCOPE');
  });

  const boxRoutes = [
    ['GET /box/:boxId/available', `/box/${BOX_ID}/available`],
    ['GET /validate/:boxId/:position', `/validate/${BOX_ID}/A1`],
    ['GET /box/:boxId/integrity', `/box/${BOX_ID}/integrity`],
  ];
  for (const [label, path] of boxRoutes) {
    it(`${label} refuses a box in another organization's tree`, async () => {
      const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(boxUnder(FOREIGN_TREE)) });
      app.locals.db = dbWithRbac({ storageBoxes, ...treeInOrg('org-other', FOREIGN_TREE) });

      const res = await get(path);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('EQUIPMENT_OUT_OF_SCOPE');
    });
  }

  const freezerRoutes = [
    ['GET /freezer/:freezerId/stats', `/freezer/${FOREIGN_TREE.freezerId}/stats`],
    ['GET /freezer/:freezerId/tree', `/freezer/${FOREIGN_TREE.freezerId}/tree`],
  ];
  for (const [label, path] of freezerRoutes) {
    it(`${label} refuses a freezer on another organization's Equipment`, async () => {
      app.locals.db = dbWithRbac({ ...treeInOrg('org-other', FOREIGN_TREE) });

      const res = await get(path);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('EQUIPMENT_OUT_OF_SCOPE');
    });
  }

  it('GET /box/:boxId/available still answers for the caller\'s own box (control)', async () => {
    const storageBoxes = createCollectionMock({ findOne: vi.fn().mockResolvedValue(boxUnder(HOME_TREE)) });
    app.locals.db = dbWithRbac({ storageBoxes, ...treeInOrg(HOME_ORG, HOME_TREE) });

    const res = await get(`/box/${BOX_ID}/available`);

    expect(res.status).toBe(200);
  });

  it('GET /freezer/:freezerId/stats answers an Administrador for any organization (control)', async () => {
    app.locals.db = dbWithRbac({ ...treeInOrg('org-other', FOREIGN_TREE) }, 4);

    const res = await get(`/freezer/${FOREIGN_TREE.freezerId}/stats`, 4);

    expect(res.status).not.toBe(403);
  });
});

describe('storage list reads are filtered to the caller organization (#1211)', () => {
  it('GET /freezers lists only freezers bound to the caller organization\'s Equipment', async () => {
    const storageContainers = createCollectionMock();
    const equipment = createCollectionMock({
      find: vi.fn().mockImplementation(() => ({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ equipmentID: 4201 }]) }),
        toArray: vi.fn().mockResolvedValue([{ equipmentID: 4201 }]),
      })),
    });
    app.locals.db = dbWithRbac({ storageContainers, equipment });

    const res = await get('/freezers');

    expect(res.status).toBe(200);
    expect(equipment.find).toHaveBeenCalledWith(expect.objectContaining({ organizationId: { $in: [HOME_ORG] } }), expect.anything());
    const filter = storageContainers.find.mock.calls[0][0];
    expect(filter.containerType).toBe('FREEZER');
    expect(filter.containerID).toEqual({ $in: expect.arrayContaining([4201, '4201']) });
  });

  it('GET /freezers is unfiltered for an Administrador (control)', async () => {
    const storageContainers = createCollectionMock();
    app.locals.db = dbWithRbac({ storageContainers }, 4);

    const res = await get('/freezers', 4);

    expect(res.status).toBe(200);
    expect(storageContainers.find.mock.calls[0][0].containerID).toBeUndefined();
  });

  it('GET /samples/search only searches the caller organization\'s specimens', async () => {
    const samples = createCollectionMock();
    app.locals.db = dbWithRbac({ samples });

    const res = await get('/samples/search?q=BR-0');

    expect(res.status).toBe(200);
    expect(samples.find).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(samples.find.mock.calls[0][0])).toContain(
      JSON.stringify(sampleOrganizationScopeClause({ scope: 'organization', organizationIds: [HOME_ORG] })),
    );
  });
});
