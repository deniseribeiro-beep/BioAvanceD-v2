import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// ImagingDerivedData (dict ELM-0355/0356, #721) is mounted via
// createMasterDataRouter, as ImagingStudy is; master-data.api.test.js covers
// the shared router's own branches. These tests cover what is specific to
// this mount: ImagingDerivedDataModel.validate() gates each POST.

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

const VALID_IMAGING_DERIVED_DATA_PAYLOAD = {
  segmentationFile: 'file-seg-1',
  featureSet: [{ software: 'pyradiomics', features: [{ name: 'firstorder_Mean', value: 41.2 }], regionOfInterest: 'tumor' }],
};

describe('GET /api/imaging-derived-data', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/imaging-derived-data');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ imagingDerivedData: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/imaging-derived-data').set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/imaging-derived-data', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/imaging-derived-data')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_IMAGING_DERIVED_DATA_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 for an empty row, which fills neither ELM-0355 nor ELM-0356', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ imagingDerivedData: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/imaging-derived-data')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.details).toEqual(['ImagingDerivedData requer segmentationFile ou featureSet']);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('creates imaging-derived data for a Coordenador+ role (ELM-0355/0356)', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ imagingDerivedData: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/imaging-derived-data')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_IMAGING_DERIVED_DATA_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.imagingDerivedDataId).toBeTruthy();
    expect(res.body.data.segmentationFile).toBe(VALID_IMAGING_DERIVED_DATA_PAYLOAD.segmentationFile);
    expect(res.body.data.featureSet).toEqual(VALID_IMAGING_DERIVED_DATA_PAYLOAD.featureSet);
  });
});
