import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// ImagingStudy (dict ELM-0353/0354, #721) is mounted via
// createMasterDataRouter, as OmicsRun is; master-data.api.test.js covers the
// shared router's own branches. These tests cover what is specific to this
// mount: ImagingStudyModel.validate() gates each POST.

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

const VALID_IMAGING_STUDY_PAYLOAD = {
  dicomStudyUid: '1.2.840.113619.2.55.3.604688119.969',
  series: [{ uid: '1.2.840.113619.2.55.3.604688119.970', modality: 'CT', numberOfInstances: 1 }],
};

describe('GET /api/imaging-studies', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/imaging-studies');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ imagingStudies: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/imaging-studies').set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/imaging-studies', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/imaging-studies')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_IMAGING_STUDY_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 naming series when series is empty (ELM-0354, 1..*)', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ imagingStudies: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/imaging-studies')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ ...VALID_IMAGING_STUDY_PAYLOAD, series: [] });

    expect(res.status).toBe(422);
    expect(res.body.details).toEqual(['series é obrigatório para ImagingStudy (1..*)']);
    expect(coll.insertOne).not.toHaveBeenCalled();
  });

  it('creates an imaging study for a Coordenador+ role (ELM-0353/0354)', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ imagingStudies: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/imaging-studies')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_IMAGING_STUDY_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.imagingStudyId).toBeTruthy();
    expect(res.body.data.dicomStudyUid).toBe(VALID_IMAGING_STUDY_PAYLOAD.dicomStudyUid);
    expect(res.body.data.series).toEqual(VALID_IMAGING_STUDY_PAYLOAD.series);
  });
});
