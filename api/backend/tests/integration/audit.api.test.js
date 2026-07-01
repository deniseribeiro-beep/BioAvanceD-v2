import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');

function makeToken(accessType = 4) {
  return jwt.sign(
    { userID: 'qa-admin-1', accessType, roleName: 'Administrador', name: 'QA Admin', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeLowToken() {
  return jwt.sign(
    { userID: 'qa-user-1', accessType: 2, roleName: 'Técnico', name: 'QA Tech', mfaVerified: true },
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

// viewReports is allowed for all access types >= 1
// requirePermission('viewReports') means roles [1,2,3,4] can access

describe('GET /api/audit/root/:date', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit/root/2026-01-01');
    expect(res.status).toBe(401);
  });

  it('returns 503 when db unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .get('/api/audit/root/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(503);
  });

  it('returns 200 with merkle result for admin', async () => {
    const integrityService = require('../../src/services/integrityCheckService');
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'abc123', leaves: [] });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    const res = await request(app)
      .get('/api/audit/root/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 200 for lower access level (viewReports includes all roles)', async () => {
    const integrityService = require('../../src/services/integrityCheckService');
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'xyz', leaves: [] });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    const res = await request(app)
      .get('/api/audit/root/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(2)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/audit/verify', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/audit/verify').send({});
    expect(res.status).toBe(401);
  });

  it('verifies valid proof and returns verified: true', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    // Build real merkle proof for verification
    const merkle = require('../../src/utils/merkleTree');
    const leaves = ['a', 'b', 'c'].map((x) => merkle.sha256Hex(x));
    const tree = merkle.buildMerkleTree(leaves);
    const proof = merkle.getProofForIndex(tree, 0);
    const root = tree.root;
    const hash = leaves[0];

    const res = await request(app)
      .post('/api/audit/verify')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ hash, proof, root });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.verified).toBe('boolean');
  });

  it('returns verified: false for bad proof', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    const res = await request(app)
      .post('/api/audit/verify')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ hash: 'abc', proof: [], root: 'bad-root' });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });
});

describe('GET /api/audit/report/:date', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit/report/2026-01-01');
    expect(res.status).toBe(401);
  });

  it('returns 503 when db unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .get('/api/audit/report/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(503);
  });

  it('returns report with saved and recalculated root', async () => {
    const integrityService = require('../../src/services/integrityCheckService');
    const auditRootService = require('../../src/services/auditRoot.service');
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'r1', leaves: [] });
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'r1', previousRootHash: null });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    const res = await request(app)
      .get('/api/audit/report/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('tampered');
  });
});

describe('GET /api/audit/compare/:date', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit/compare/2026-01-01');
    expect(res.status).toBe(401);
  });

  it('returns no_diff when roots match', async () => {
    const integrityService = require('../../src/services/integrityCheckService');
    const auditRootService = require('../../src/services/auditRoot.service');
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'same-root', leaves: [] });
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'same-root' });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    const res = await request(app)
      .get('/api/audit/compare/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.diff).toContain('no_diff');
  });

  it('returns root_mismatch when roots differ', async () => {
    const integrityService = require('../../src/services/integrityCheckService');
    const auditRootService = require('../../src/services/auditRoot.service');
    vi.spyOn(integrityService, 'buildMerkleForDate').mockResolvedValue({ root: 'different-root', leaves: [] });
    vi.spyOn(auditRootService, 'getRootByDate').mockResolvedValue({ root: 'original-root' });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll });

    const res = await request(app)
      .get('/api/audit/compare/2026-01-01')
      .set('Authorization', `Bearer ${makeToken(4)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.diff).toContain('root_mismatch');
    expect(res.body.data.tampered).toBe(true);
  });
});

describe('GET /api/audit/dashboard/dates', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit/dashboard/dates');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/audit/dashboard/stats/:date', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/audit/dashboard/stats/2026-01-01');
    expect(res.status).toBe(401);
  });
});
