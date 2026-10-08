import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

const rbacCollections = buildRbacCollections([
  { userAccountId: 'qa-admin-1', accessType: 4 },
  { userAccountId: 'qa-user-1', accessType: 2 },
]);

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
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

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
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

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

  it('returns 400 when the request carries the retired hash/proof/root contract', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

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
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // #1307: a real chain in an in-memory store, through the route. Only the
  // head's signature and its anchoring evidence are faked.
  async function sealedChainDb(n) {
    const { createFakeDb } = require('../unit/foundation/helpers/fake-db');
    const auditV2Service = require('../../src/services/audit-v2.service');
    const auditTreeService = require('../../src/services/audit-tree.service');
    const store = createFakeDb();
    for (let i = 1; i <= n; i += 1) {
      await auditV2Service.ingestLogRecord({ _id: `rec-${i}`, action: `ACT-${i}`, userName: 'USR-0A1B2C3D' }, store);
    }
    const leaves = await auditV2Service.loadChain(store);
    await store.collection('audit_tree_heads').insertOne({
      _id: `th-${n}`, logId: 'audit-events', treeSize: n,
      rootHash: auditTreeService.buildTree(leaves.map((item) => item.canonicalLeaf)).rootHash,
      signature: 'sig', keyId: 'key-1', status: 'PENDING_TIMESTAMP',
      schemaVersion: 'audit.treehead.v1', previousTreeHeadHash: null, periodStart: null, periodEnd: null,
      createdAt: '2026-10-08T00:00:00.000Z', hashAlgorithm: 'SHA-256', merkleAlgorithm: 'RFC9162-STYLE', signatureAlgorithm: 'Ed25519',
    });
    await store.collection('audit_timestamp_tokens').insertOne({ logId: 'audit-events', treeSize: n, token: 'tk' });
    await store.collection('audit_witnesses').insertOne({ logId: 'audit-events', treeSize: n, receipt: 'r' });
    const names = ['audit_events', 'audit_events_archive', 'audit_tree_heads', 'audit_timestamp_tokens', 'audit_witnesses'];
    app.locals.db = createDbMock({ ...Object.fromEntries(names.map((name) => [name, store.collection(name)])), ...rbacCollections });
    return store.collection('audit_events').docs;
  }

  it('verifies a stored event by eventId and returns overallStatus VALID', async () => {
    const signingProvider = require('../../src/services/audit-signing.provider');
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: true });
    const events = await sealedChainDb(3);

    const res = await request(app)
      .post('/api/audit/verify')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ eventId: events[1].eventId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.overallStatus).toBe('VALID');
    expect(res.body.data.chainValid).toBe(true);
    expect(res.body.data.failures).toEqual([]);
  });

  it('returns overallStatus INVALID with failures when an event was rewritten after sealing', async () => {
    const signingProvider = require('../../src/services/audit-signing.provider');
    vi.spyOn(signingProvider, 'verify').mockReturnValue({ ok: false });
    const events = await sealedChainDb(3);
    events[0].result = 'failure';

    const res = await request(app)
      .post('/api/audit/verify')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ eventId: events[0].eventId });

    expect(res.status).toBe(200);
    expect(res.body.data.overallStatus).toBe('INVALID');
    expect(res.body.data.chainBrokenAt).toBe(1);
    // The sealed leaf (canonicalLeaf) is untouched, so inclusion and the root
    // still hold; the rewritten document no longer digests to its hash.
    expect(res.body.data.failures).toEqual(['eventIntegrity', 'chain', 'treeHeadSignature']);
  });

  it('returns 404 when the audit event is not found', async () => {
    const eventsColl = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = createDbMock({ audit_events: eventsColl, ...rbacCollections });

    const res = await request(app)
      .post('/api/audit/verify')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ eventId: 'missing' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
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
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

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
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

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
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

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

// #959: until this route existed the ONLY caller of createTreeHead was a bare
// setTimeout to 02:30 UTC inside the worker process, so no test run of any
// length could ever reach the sealing path -- and runOnce() seals YESTERDAY,
// a date a fresh run has no events for. These cases go through the real
// router, the real authenticate and the real requirePermission; only the job
// module is spied, so what they prove is REACHABILITY, which is the thing
// nothing tested.
describe('POST /api/audit/anchor (#959)', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/api/audit/anchor').send({ date: '2026-01-01' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-administrator: anchoring is manageSystem, not viewReports', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

    const res = await request(app)
      .post('/api/audit/anchor')
      .set('Authorization', `Bearer ${makeLowToken()}`)
      .send({ date: '2026-01-01' });
    expect(res.status).toBe(403);
  });

  it('returns 503 when db unavailable', async () => {
    app.locals.db = null;
    const res = await request(app)
      .post('/api/audit/anchor')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ date: '2026-01-01' });
    expect(res.status).toBe(503);
  });

  it('rejects a malformed date rather than silently sealing yesterday', async () => {
    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

    const res = await request(app)
      .post('/api/audit/anchor')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ date: '01/01/2026' });
    expect(res.status).toBe(400);
  });

  it('anchors the SUPPLIED date and reports anchorStatus, not the signed constant status', async () => {
    const job = require('../../src/workers/jobs/daily-merkle.job');
    const anchorDate = vi.spyOn(job, 'anchorDate').mockResolvedValue({
      _id: 'head-1', status: 'PENDING_TIMESTAMP', anchorStatus: 'ANCHORED', treeSize: 3,
    });

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

    const res = await request(app)
      .post('/api/audit/anchor')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ date: '2026-07-01' });

    expect(res.status).toBe(200);
    expect(anchorDate).toHaveBeenCalledWith(expect.anything(), '2026-07-01');
    expect(res.body.data.anchorStatus).toBe('ANCHORED');
  });

  it('returns 422 when the date has no anchorable audit events', async () => {
    const job = require('../../src/workers/jobs/daily-merkle.job');
    vi.spyOn(job, 'anchorDate').mockResolvedValue(null);

    const coll = createCollectionMock();
    app.locals.db = createDbMock({ auditLogs: coll, ...rbacCollections });

    const res = await request(app)
      .post('/api/audit/anchor')
      .set('Authorization', `Bearer ${makeToken(4)}`)
      .send({ date: '2026-07-02' });
    expect(res.status).toBe(422);
  });
});
