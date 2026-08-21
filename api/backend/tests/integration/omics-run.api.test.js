import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

// RF027 slice 4/4 (#716): OmicsRun is mounted via createMasterDataRouter,
// same as WorkflowRun/OmicsQualification/Assay/Dataset --
// master-data.api.test.js already covers the shared router's own
// branches generically. These tests only cover what's specific to this
// mount: OmicsRunModel.validate() actually gates each POST.

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

const VALID_OMICS_RUN_PAYLOAD = {
  modality: 'genomics',
  referenceAssembly: 'GRCh38',
  fileLinks: [{ role: 'read', fileId: 'file-1' }],
};

describe('GET /api/omics-runs', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/omics-runs');
    expect(res.status).toBe(401);
  });

  it('returns list for authenticated user', async () => {
    const coll = createCollectionMock({
      find: vi.fn().mockReturnValue({ sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) }),
    });
    app.locals.db = createDbMock({ omicsRuns: coll, ...rbacCollectionsAdmin });

    const res = await request(app).get('/api/omics-runs').set('Authorization', `Bearer ${makeToken('qa-1', 4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/omics-runs', () => {
  it('returns 403 for a role below Coordenador', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsTechnician });

    const res = await request(app)
      .post('/api/omics-runs')
      .set('Authorization', `Bearer ${makeToken('qa-2', 2)}`)
      .send(VALID_OMICS_RUN_PAYLOAD);

    expect(res.status).toBe(403);
  });

  it('returns 422 when modality is out of enum (OmicsRunModel.validate, AC#5)', async () => {
    app.locals.db = createDbMock({ ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/omics-runs')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ ...VALID_OMICS_RUN_PAYLOAD, modality: 'astrology' });

    expect(res.status).toBe(422);
  });

  it('creates an omics run with a genomic reference for a Coordenador+ role (AC#5)', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439011' }) });
    app.locals.db = createDbMock({ omicsRuns: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/omics-runs')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send(VALID_OMICS_RUN_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.omicsRunId).toBeTruthy();
    expect(res.body.data.modality).toBe('genomics');
    expect(res.body.data.referenceAssembly).toBe('GRCh38');
  });

  it('creates a minimal omics run without referenceAssembly (AC#5 "quando aplicável")', async () => {
    const coll = createCollectionMock({ insertOne: vi.fn().mockResolvedValue({ insertedId: '507f1f77bcf86cd799439012' }) });
    app.locals.db = createDbMock({ omicsRuns: coll, ...rbacCollectionsAdmin });

    const res = await request(app)
      .post('/api/omics-runs')
      .set('Authorization', `Bearer ${makeToken('qa-1', 4)}`)
      .send({ modality: 'proteomics' });

    expect(res.status).toBe(201);
    expect(res.body.data.referenceAssembly).toBeNull();
  });
});
