import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-secret-key';

const app = require('../../app');
const sessionService = require('../../src/services/session.service');
const logService = require('../../src/services/log.service');
const { createCollectionMock, createDbMock } = require('../factories/db.factory');
const { buildRbacCollections } = require('../factories/rbac.factory');

const TOKEN_USER_ID = 'qa-user-1';

function makeToken({ accessType = 4, roleName = 'Administrador' } = {}) {
  return jwt.sign(
    { userID: TOKEN_USER_ID, accessType, roleName, name: 'QA User', mfaVerified: true },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// #426: requireAuditReader now resolves admin status via
// UserRoleAssignment -> Role, not the accessType/roleName the JWT carries —
// `createDbMock` merged with `buildRbacCollections` grants
// `TOKEN_USER_ID` the assignment matching `accessType` so admin-gated tests
// keep exercising the real RBAC read path instead of a stubbed shortcut.
function dbForAccessType(accessType, extraCollections = {}) {
  const rbac = buildRbacCollections(accessType == null ? [] : [{ userAccountId: TOKEN_USER_ID, accessType }]);
  return createDbMock({ ...rbac, ...extraCollections });
}

function givenSession() {
  vi.spyOn(sessionService, 'verifySession').mockResolvedValue({ valid: true, session: { sessionID: 'session-1' } });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

// Mirrors the documented pattern from location.api.test.js: `authenticate`
// middleware short-circuits with its own 503 (different shape) before the
// route handler's own `if (!db)` branch ever runs when app.locals.db is
// falsy up front. To exercise the route's own guard we let auth pass with a
// real db, then flip app.locals.db to null as a side effect inside the
// mocked verifySession call.
function givenSessionThenDbDisappears() {
  vi.spyOn(sessionService, 'verifySession').mockImplementation(async () => {
    app.locals.db = null;
    return { valid: true, session: { sessionID: 'session-1' } };
  });
  vi.spyOn(sessionService, 'updateActivity').mockResolvedValue({ sessionID: 'session-1' });
}

describe('requireAuditReader (via GET /api/logs)', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/logs');
    expect(res.status).toBe(401);
  });

  it('allows a user with an active administrator role assignment through', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [], total: 0 });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken({ accessType: 4, roleName: 'Pesquisador' })}`);
    expect(res.status).toBe(200);
  });

  // #426/#429: admission is no longer decided by the JWT's roleName text --
  // only an active `administrator` or `auditor` role assignment grants
  // access, so a JWT merely *claiming* roleName "Admin"/"Administrador"
  // without a matching RBAC assignment is correctly denied.
  it('denies a user whose JWT claims roleName "Admin" but has no administrator role assignment', async () => {
    app.locals.db = dbForAccessType(1);
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken({ accessType: 1, roleName: 'Admin' })}`);
    expect(res.status).toBe(403);
  });

  it('denies a user whose JWT claims accented roleName "Administrador" but has no administrator role assignment', async () => {
    app.locals.db = dbForAccessType(1);
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken({ accessType: 1, roleName: 'Administrador' })}`);
    expect(res.status).toBe(403);
  });

  // #429: the `roleName` substring fallback is retired -- only a real
  // active `auditor` RBAC role assignment grants access now, regardless of
  // what the JWT's roleName claims.
  it('denies a roleName merely containing "auditor" as a substring with no dedicated RBAC role assignment', async () => {
    app.locals.db = dbForAccessType(1);
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken({ accessType: 1, roleName: 'Auditor Clínico' })}`);
    expect(res.status).toBe(403);
  });

  it('allows a user with an active auditor role assignment, without an administrator assignment', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [], total: 0 });
    app.locals.db = createDbMock(buildRbacCollections([{ userAccountId: TOKEN_USER_ID, roleCodes: ['auditor'] }]));
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken({ accessType: 1, roleName: 'Pesquisador' })}`);
    expect(res.status).toBe(200);
  });

  it('rejects a plain user role with exact 403 error shape', async () => {
    app.locals.db = dbForAccessType(1);
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken({ accessType: 1, roleName: 'Pesquisador' })}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Acesso negado',
      message: 'Apenas perfis Admin ou Auditor podem acessar trilhas de auditoria.',
    });
  });
});

describe('GET /api/logs', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns 503 when db disappears after auth (route-level guard)', async () => {
    givenSessionThenDbDisappears();
    const res = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Banco de dados não disponível' });
  });

  it('wraps logService.getLogs result in {success, data}', async () => {
    const fakeResult = { logs: [{ logId: 'l1' }], total: 1 };
    vi.spyOn(logService, 'getLogs').mockResolvedValue(fakeResult);
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs?severity=high')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: fakeResult });
    expect(logService.getLogs).toHaveBeenCalledWith(app.locals.db, expect.objectContaining({ severity: 'high' }));
  });
});

describe('GET /api/logs/all', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('forces limit:5000 and page:1 regardless of query params', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [], total: 0 });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs/all?limit=10&page=3&severity=low')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(logService.getLogs).toHaveBeenCalledWith(
      app.locals.db,
      expect.objectContaining({ limit: '10', page: 1, severity: 'low' })
    );
  });

  it('defaults limit to 5000 when none supplied', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [], total: 0 });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs/all')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(logService.getLogs).toHaveBeenCalledWith(app.locals.db, expect.objectContaining({ limit: 5000, page: 1 }));
  });
});

describe('POST /api/logs/query', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads filters from req.body, not query', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [], total: 0 });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .post('/api/logs/query?ignored=true')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ module: 'samples', severity: 'critical' });
    expect(res.status).toBe(200);
    expect(logService.getLogs).toHaveBeenCalledWith(app.locals.db, { module: 'samples', severity: 'critical' });
  });
});

// #1107: POST /api/logs/register was `authenticate`-only while every other
// route in this file carries requireAuditReader, and the handler passed
// `req.body` straight through to logService.createLog -- so any logged-in
// principal could forge an audit row with an arbitrary `userId`, a backdated
// `timestamp` and a spoofed `source`, sealed into the immutable Merkle chain
// by integrityCheckService#buildMerkleForDate. The route had a frontend
// binding (api.ts -> useLogs.ts) but ZERO live callers, and nothing in the
// canonical docs mandates a client-submitted audit event: RNF009's subject is
// "O sistema deve registrar", its AC#2 requires a pseudonymized actor and AC#3
// a sanitized payload, and every dict-02 AuditEvent row names "Backend Log.*"
// as its own evidence field. So the route was REMOVED rather than gated.
// These two pin the removal; the previous block asserted the hole as intended
// behaviour ("allows any authenticated user (no requireAuditReader)").
describe('POST /api/logs/register (removed by #1107)', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('is not routed for an authenticated non-privileged user, and writes nothing', async () => {
    const createLogSpy = vi.spyOn(logService, 'createLog');
    app.locals.db = createDbMock({});
    const res = await request(app)
      .post('/api/logs/register')
      .set('Authorization', `Bearer ${makeToken({ accessType: 1, roleName: 'Pesquisador' })}`)
      .send({ action: 'LOGIN', userId: 'some-other-user', source: 'worker' });
    expect(res.status).toBe(404);
    expect(createLogSpy).not.toHaveBeenCalled();
  });

  it('is not routed for an administrator either -- the surface is gone, not gated', async () => {
    const createLogSpy = vi.spyOn(logService, 'createLog');
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .post('/api/logs/register')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ action: 'LOGIN' });
    expect(res.status).toBe(404);
    expect(createLogSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/logs/export/csv', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects non-admin/non-auditor user', async () => {
    app.locals.db = dbForAccessType(2);
    const res = await request(app)
      .get('/api/logs/export/csv')
      .set('Authorization', `Bearer ${makeToken({ accessType: 2, roleName: 'Técnico' })}`);
    expect(res.status).toBe(403);
  });

  it('sets headers and returns CSV body with quote-escaping', async () => {
    const logs = [
      {
        timestamp: '2026-01-01T00:00:00Z',
        userName: 'Alice "Al" Smith',
        action: 'CREATE',
        entity: 'sample',
        result: 'success',
        severity: 'low',
        module: 'samples',
        ipSource: '127.0.0.1',
        message: 'ok',
      },
    ];
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs/export/csv')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename=logs_\d{4}-\d{2}-\d{2}\.csv$/);

    const lines = res.text.split('\n');
    expect(lines[0]).toBe('timestamp,userName,action,entity,result,severity,module,ipSource,message');
    // embedded quote should be doubled per buildCsv escape logic
    expect(lines[1]).toContain('"Alice ""Al"" Smith"');

    expect(logService.getLogs).toHaveBeenCalledWith(app.locals.db, expect.objectContaining({ limit: 10000, page: 1 }));
  });

  it('returns just the header row when there are no logs', async () => {
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs: [] });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs/export/csv')
      .set('Authorization', `Bearer ${makeToken()}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('timestamp,userName,action,entity,result,severity,module,ipSource,message');
  });
});

describe('GET /api/logs/export/xlsx', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the same CSV-shaped bytes as the csv endpoint, with xlsx headers', async () => {
    const logs = [{ timestamp: '2026-01-01T00:00:00Z', userName: 'Bob', action: 'READ', entity: 'e', result: 'ok', severity: 'low', module: 'm', ipSource: '1.1.1.1', message: 'hi' }];
    vi.spyOn(logService, 'getLogs').mockResolvedValue({ logs });
    app.locals.db = dbForAccessType(4);
    const res = await request(app)
      .get('/api/logs/export/xlsx')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename=logs_\d{4}-\d{2}-\d{2}\.xlsx$/);

    // body is really CSV text encoded as bytes, not real xlsx binary
    expect(res.text).toBe('timestamp,userName,action,entity,result,severity,module,ipSource,message\n"2026-01-01T00:00:00.000Z","Bob","READ","e","ok","low","m","1.1.1.1","hi"');
  });
});

describe('GET /api/logs/:id', () => {
  beforeEach(() => { givenSession(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('finds a log by logId when id is not ObjectId-shaped', async () => {
    const log = { logId: 'my-log-id', action: 'X' };
    const findOne = vi.fn().mockResolvedValue(log);
    const coll = createCollectionMock({ findOne });
    app.locals.db = dbForAccessType(4, { logs: coll });

    const res = await request(app)
      .get('/api/logs/my-log-id')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: log });
    expect(findOne).toHaveBeenCalledWith({ logId: 'my-log-id' });
  });

  it('finds a log by _id when id is a valid ObjectId string', async () => {
    const objId = new ObjectId();
    const log = { _id: objId, action: 'Y' };
    const findOne = vi.fn().mockResolvedValue(log);
    const coll = createCollectionMock({ findOne });
    app.locals.db = dbForAccessType(4, { logs: coll });

    const res = await request(app)
      .get(`/api/logs/${objId.toString()}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(findOne).toHaveBeenCalledWith({ _id: expect.any(ObjectId) });
    expect(findOne.mock.calls[0][0]._id.toString()).toBe(objId.toString());
  });

  // Issue #72: an ObjectId-shaped id must fall back to a logId lookup when
  // no document has that _id, otherwise a log whose logId happens to be a
  // 24-hex-char string becomes permanently unreachable via GET /:id.
  it('falls back to logId lookup when id is ObjectId-shaped but no _id matches', async () => {
    const objIdLikeLogId = new ObjectId().toString();
    const log = { logId: objIdLikeLogId, action: 'Z' };
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(log);
    const coll = createCollectionMock({ findOne });
    app.locals.db = dbForAccessType(4, { logs: coll });

    const res = await request(app)
      .get(`/api/logs/${objIdLikeLogId}`)
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: log });
    expect(findOne).toHaveBeenCalledWith({ logId: objIdLikeLogId });
  });

  it('returns 404 when no log is found', async () => {
    const coll = createCollectionMock({ findOne: vi.fn().mockResolvedValue(null) });
    app.locals.db = dbForAccessType(4, { logs: coll });

    const res = await request(app)
      .get('/api/logs/nonexistent-id')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Log não encontrado' });
  });
});
