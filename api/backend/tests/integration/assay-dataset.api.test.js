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

// #641 slice 1: Assay/Dataset are mounted via createMasterDataRouter
// (same factory Study/Protocol use) -- master-data.api.test.js already
// covers the shared router's own branches generically via
// /api/measurement-units. These tests only cover what's specific to this
// mount: the right model's validate() actually gates each POST.

const rbacCollectionsAdmin = buildRbacCollections([{ userAccountId: 'qa-1', accessType: 4 }]);
const rbacCollectionsTechnician = buildRbacCollections([{ userAccountId: 'qa-2', accessType: 2 }]);

function makeToken(userID, accessType) {
  return jwt.sign(
    { userID, accessType, roleName: accessType >= 3 ? 'Coordenador' : 'Tecnico', name: 'QA', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'sess-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'sess-1' });
}

beforeEach(() => { givenSession(); });
afterEach(() => { vi.restoreAllMocks(); });

const VALID_ASSAY_PAYLOAD = {
  studyId: 'study-1',
  specimenIds: ['specimen-1'],
  assayType: 'RNA sequencing',
  protocolId: 'protocol-1',
  operatorId: 'user-1',
  laboratoryId: 'org-1',
  assayDateTime: '2026-08-19T10:00:00.000Z',
  intendedUse: 'RNA-seq discovery',
};

const VALID_DATASET_PAYLOAD = {
  datasetTitle: 'RNA-seq cohort 2026',
  datasetVersion: '1.0.0',
  creators: [{ name: 'Dr. Silva', orcid: '0000-0000-0000-0001' }],
  license: 'CC-BY-4.0',
};

describe('GET /api/assays', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/assays');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ assays: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/assays').set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/assays', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_ASSAY_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when specimenIds is missing (AssayModel.validate)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { specimenIds, ...invalidPayload } = VALID_ASSAY_PAYLOAD;

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('specimenIds é obrigatório e deve ser um array não vazio');
  });

  it('creates an assay for a Coordenador+ role', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    // #664: validateAssayReferences now checks specimenIds/protocolId/
    // operatorId/laboratoryId resolve to real records before create.
    app.locals.db = createDbMock({
      assays: coll,
      samples: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: 'specimen-1' }) }),
      protocols: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ protocolId: 'protocol-1' }) }),
      users: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: 'user-1' }) }),
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_ASSAY_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.assayId).toBeTruthy();
    expect(res.body.data.specimenIds).toEqual(['specimen-1']);
  });

  it('#664: returns 404 when specimenIds does not resolve to a real sample', async () => {
    app.locals.db = createDbMock({
      protocols: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ protocolId: 'protocol-1' }) }),
      users: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: 'user-1' }) }),
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-1' }) }),
      ...rbacCollectionsAdmin,
    });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_ASSAY_PAYLOAD);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/specimenIds/);
  });
});

describe('GET /api/datasets', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/datasets');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ datasets: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/datasets').set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/datasets', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/datasets')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_DATASET_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when creators is missing (DatasetModel.validate)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { creators, ...invalidPayload } = VALID_DATASET_PAYLOAD;

    const res = await request(app)
      .post('/api/datasets')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('creators é obrigatório e deve ser um array não vazio');
  });

  it('creates a dataset for a Coordenador+ role, distributionFiles defaults empty', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439012' }) });
    app.locals.db = createDbMock({ datasets: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/datasets')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_DATASET_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.datasetId).toBeTruthy();
    expect(res.body.data.distributionFiles).toEqual([]);
  });
});

// #1182: the assay FILES were org-scoped on the parent's laboratoryId in
// #644, but the Assay record itself rode createMasterDataRouter with no
// organization scope at all -- a Coordenador scoped to one organization
// could list, read, edit or delete another organization's assay, and move
// their own out of reach by rewriting laboratoryId. accessType 3, since an
// Administrador (4) is global and bypasses org scope by design.
describe('#1182: /api/assays is scoped on laboratoryId', () => {
  const rbacCollectionsScoped = buildRbacCollections([{ userAccountId: 'qa-3', accessType: 3, organizationId: 'org-mine' }]);
  const MINE = { ...VALID_ASSAY_PAYLOAD, assayId: 'assay-mine', laboratoryId: 'org-mine' };
  const OTHER = { assayId: 'assay-other', laboratoryId: 'org-other', studyId: 'study-1' };
  const token = () => `Bearer ${makeToken('qa-3', 3)}`;

  it('filters the list to the caller organizations', async () => {
    const find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([MINE]) });
    app.locals.db = createDbMock({ assays: createCollectionMock({ find }), ...rbacCollectionsScoped });

    const res = await request(app).get('/api/assays').set('Authorization', token());

    expect(res.status).toBe(200);
    expect(find).toHaveBeenCalledWith({ laboratoryId: { $in: ['org-mine'] } });
  });

  it('refuses to read another organization assay', async () => {
    app.locals.db = createDbMock({ assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(OTHER) }), ...rbacCollectionsScoped });

    const res = await request(app).get('/api/assays/assay-other').set('Authorization', token());

    expect(res.status).toBe(403);
  });

  it('refuses to edit another organization assay', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(OTHER);
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(OTHER), findOneAndUpdate }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).put('/api/assays/assay-other').set('Authorization', token()).send({ intendedUse: 'x' });

    expect(res.status).toBe(403);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses a PUT that moves an in-scope assay to another laboratory', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(MINE);
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(MINE), findOneAndUpdate }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).put('/api/assays/assay-mine').set('Authorization', token()).send({ laboratoryId: 'org-other' });

    expect(res.status).toBe(403);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to delete another organization assay', async () => {
    const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(OTHER), deleteOne }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).delete('/api/assays/assay-other').set('Authorization', token());

    expect(res.status).toBe(403);
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it('stamps the caller organization on a create, ignoring the body laboratoryId', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' });
    app.locals.db = createDbMock({
      assays: createCollectionMock({ insertOne }),
      samples: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: 'specimen-1' }) }),
      protocols: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ protocolId: 'protocol-1' }) }),
      users: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ _id: 'user-1' }) }),
      organizations: createCollectionMock({ findOne: vi.fn().mockResolvedValue({ organizationId: 'org-any' }) }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app)
      .post('/api/assays')
      .set('Authorization', token())
      .send({ ...VALID_ASSAY_PAYLOAD, laboratoryId: 'org-other' });

    expect(res.status).toBe(201);
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ laboratoryId: 'org-mine' }));
  });

  it('CONTROL: reads an assay in the caller organization', async () => {
    app.locals.db = createDbMock({ assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(MINE) }), ...rbacCollectionsScoped });

    const res = await request(app).get('/api/assays/assay-mine').set('Authorization', token());

    expect(res.status).toBe(200);
  });

  it('CONTROL: edits an in-scope assay without naming laboratoryId', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue({ ...MINE, intendedUse: 'x' });
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(MINE), findOneAndUpdate }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).put('/api/assays/assay-mine').set('Authorization', token()).send({ intendedUse: 'x' });

    expect(res.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalled();
  });

  // #1221: PUT ran no reference check, so an edit could point an assay at
  // a specimen that does not exist, or put a raw _id back where create
  // stores the canonical specimenId (#1219).
  it('#1221: refuses a PUT whose specimenIds name no sample, and writes nothing', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(MINE);
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(MINE), findOneAndUpdate }),
      samples: createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).put('/api/assays/assay-mine').set('Authorization', token())
      .send({ specimenIds: ['does-not-exist'] });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/specimenIds: does-not-exist/);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('#1221: a PUT naming a specimen by its _id stores the canonical specimenId', async () => {
    const sample = { _id: new ObjectId(), specimenId: '3116768' };
    const findOneAndUpdate = vi.fn().mockResolvedValue(MINE);
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(MINE), findOneAndUpdate }),
      samples: createCollectionMock({
        findOne: vi.fn(async (filter = {}) => (
          (filter._id && String(filter._id) === String(sample._id)) || filter.specimenId === sample.specimenId ? sample : null
        )),
      }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).put('/api/assays/assay-mine').set('Authorization', token())
      .send({ specimenIds: [String(sample._id)] });

    expect(res.status).toBe(200);
    expect(findOneAndUpdate.mock.calls[0][1].$set.specimenIds).toEqual(['3116768']);
  });

  it('CONTROL: deletes an in-scope assay', async () => {
    const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    app.locals.db = createDbMock({
      assays: createCollectionMock({ findOne: vi.fn().mockResolvedValue(MINE), deleteOne }),
      ...rbacCollectionsScoped,
    });

    const res = await request(app).delete('/api/assays/assay-mine').set('Authorization', token());

    expect(res.status).toBe(200);
    expect(deleteOne).toHaveBeenCalled();
  });
});
