import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// #913: ReagentLot is mounted at /api/reagent-lots (app.js:311) via
// createMasterDataRouter (same factory Assay/Dataset/WorkflowRun use) --
// master-data.api.test.js already covers the shared router's own branches
// generically via /api/measurement-units. These tests only cover what's
// specific to this mount: the role gate resolving through real RBAC
// fixtures (not the null-hierarchy-level accident), ReagentLotModel.validate()
// actually gating each POST, and the 201 happy path. There is no
// validateReferences hook (like Dataset/WorkflowRun, unlike Assay). Before
// this file, /api/reagent-lots had zero integration coverage.

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

const VALID_REAGENT_LOT_PAYLOAD = {
  reagentName: 'RNA Extraction Kit',
  lotNumber: 'LOT-2026-001',
  manufacturer: 'Qiagen',
  catalogNumber: 'CAT-12345',
  expirationDate: '2027-08-19T00:00:00.000Z',
  storageCondition: '-20C',
};

describe('GET /api/reagent-lots', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/reagent-lots');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ reagentLots: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/reagent-lots').set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/reagent-lots', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/reagent-lots')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_REAGENT_LOT_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when reagentName is missing (ReagentLotModel.validate)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { reagentName, ...invalidPayload } = VALID_REAGENT_LOT_PAYLOAD;

    const res = await request(app)
      .post('/api/reagent-lots')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toContain('reagentName é obrigatório');
  });

  it('returns 422 when lotNumber is missing (ReagentLotModel.validate)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });
    const { lotNumber, ...invalidPayload } = VALID_REAGENT_LOT_PAYLOAD;

    const res = await request(app)
      .post('/api/reagent-lots')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(invalidPayload);

    expect(res.status).toBe(422);
    expect(res.body.details).toContain('lotNumber é obrigatório');
  });

  it('creates a reagent lot for a Coordenador+ role', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ reagentLots: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/reagent-lots')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_REAGENT_LOT_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reagentId).toBeTruthy();
    expect(res.body.data.reagentName).toBe('RNA Extraction Kit');
    expect(res.body.data.lotNumber).toBe('LOT-2026-001');
    expect(res.body.data.manufacturer).toBe('Qiagen');
  });
});
