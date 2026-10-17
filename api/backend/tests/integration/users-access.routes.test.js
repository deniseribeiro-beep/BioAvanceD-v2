import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
const require2 = createRequire(import.meta.url);
const { buildRbacCollections } = require2('../factories/rbac.factory');
const { createCollectionMock } = require2('../factories/db.factory');

function matchesAssignmentQuery(doc, query = {}) {
  return Object.entries(query).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.includes(doc[key]);
    return doc[key] === cond;
  });
}

// #615: a mutable userRoleAssignments mock seeded with explicit
// scopeType/scopeId docs — buildRbacCollections' synthesized assignments
// don't set scopeType at all, so it can't exercise updateAssignmentScope's
// `doc.scopeType !== 'organization'` branch.
function queryableAssignmentsMock(docs) {
  return createCollectionMock({
    findOne: vi.fn(async (query = {}) => docs.find((d) => matchesAssignmentQuery(d, query)) || null),
    find: vi.fn((query = {}) => ({ toArray: vi.fn().mockResolvedValue(docs.filter((d) => matchesAssignmentQuery(d, query))) })),
    insertOne: vi.fn(async (doc) => { docs.push(doc); return { insertedId: doc.assignmentId }; }),
    updateOne: vi.fn(async (filter, update) => {
      const doc = docs.find((d) => matchesAssignmentQuery(d, filter));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    }),
  });
}

// #1017: this file used to declare vi.hoisted mocks for auth.service and
// auditLogger and register them with vi.mock at '../../../src/...'. That depth
// is one level too far -- this file sits at api/backend/tests/integration, so
// '../../../src' is `api/src`, which does not exist (`ls api/` is just
// `backend/`), and the require2 calls above already use the correct depth for
// their own targets. Vite resolved every one of those specifiers to null and
// vitest neither errored nor warned, so the mock registry was keyed on a path
// nothing matched and BOTH mocks were inert -- the real modules ran. The
// `await import` calls survived only because vitest retries a failed dynamic
// import as a root-relative URL, a retry it does NOT extend to vi.mock.
//
// Even at the correct depth vi.mock would not fix auditLogger: user.routes.js
// requires it lazily INSIDE its handlers (POST /register, PUT /:id, DELETE
// /:id), and vitest's mock registry is not consulted by the require the route
// actually executes. Hoisting that require was considered and rejected -- it is
// this repo's house style, at ~127 in-handler sites against 11 module-scope,
// and it is not cycle-driven.
//
// What works, and what auth.routes.test.js in this same directory already does:
// load through the SAME createRequire as the SUT and spy on the CJS module
// object. A lazy require returns the cached module.exports, so mutating it is
// observed at call time -- laziness is an advantage here, not the obstacle.
const auditLogger = require2('../../src/utils/auditLogger');
const authService = require2('../../src/services/auth.service');

// Required (not imported) so the routers and the spy targets share one module
// instance. Mixing `await import` (vitest module runner) with createRequire
// (native CJS cache) would give two auditLogger objects and the spies would
// silently miss again -- which is the failure this whole change is about.
const userRoutes = require2('../../src/interface/routes/user.routes.js');
const accessRoutes = require2('../../src/interface/routes/access.routes.js');

// Installed once, cleared per test below. auditLogger writes are stubbed out
// (the real ones emit AUDIT_TRAIL_WRITE_FAILURE against the mocked db, which
// is the stderr noise this suite has been printing on every run).
// authService.registerUser is spied WITHOUT an implementation: the real one
// has been running all along behind the inert mock, so replacing it now would
// change this suite's behaviour rather than restore it.
const auditSpies = {
  init: vi.spyOn(auditLogger, 'init').mockImplementation(() => {}),
  log: vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined),
  logCreate: vi.spyOn(auditLogger, 'logCreate').mockResolvedValue(undefined),
  logUpdate: vi.spyOn(auditLogger, 'logUpdate').mockResolvedValue(undefined),
  logDelete: vi.spyOn(auditLogger, 'logDelete').mockResolvedValue(undefined),
  logPermissionChange: vi.spyOn(auditLogger, 'logPermissionChange').mockResolvedValue(undefined),
};
const registerUserSpy = vi.spyOn(authService, 'registerUser');

function getHandler(router, method, path) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods?.[method]);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  return response;
}

// #1384: getHandler calls the handler with no middleware, so the scope
// requireOrganizationScope would attach is set here; global by default, as
// the Administrador callers below resolve.
function createRequest({ body = {}, params = {}, query = {}, user = { userID: '507f1f77bcf86cd799439011', accessType: 4, roleName: 'Administrador' }, organizationScope = { scope: 'global', organizationIds: [] } } = {}) {
  return {
    body,
    params,
    query,
    user,
    organizationScope,
    t: (key) => key,
    app: {
      locals: {
        db: null,
      },
    },
  };
}

describe('Users and Access routes', () => {
  let usersCollection;
  let accessCollection;
  let logsCollection;
  let organizationsCollection;
  let sessionsCollection;
  let db;

  beforeEach(() => {
    // #1017: cleared rather than re-spied, so the spy identity stays stable
    // across tests and repeated vi.spyOn calls cannot stack wrappers.
    Object.values(auditSpies).forEach((spy) => spy.mockClear());
    registerUserSpy.mockClear();

    usersCollection = {
      find: vi.fn(),
      findOne: vi.fn(),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'user-registered' }),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
    };

    accessCollection = {
      find: vi.fn(),
      findOne: vi.fn(),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
    };

    logsCollection = {
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'log-1' }),
    };

    // #617: organizationId is now validated against a real Organization at
    // write time — default resolves any lookup as found so pre-existing
    // tests passing a fabricated organizationId (e.g. 'org-old'/'org-new')
    // keep working; only the dedicated #617 tests override this to null.
    organizationsCollection = {
      find: vi.fn(),
      findOne: vi.fn().mockResolvedValue({ organizationId: 'default-org' }),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
      deleteOne: vi.fn(),
    };

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: '507f1f77bcf86cd799439012', accessType: 2 },
    ]);

    // #963: named and memoized, deliberately. The fallback below returns a
    // FRESH object per db.collection() call and has no updateMany, so a
    // session revoke would (a) throw a TypeError that
    // invalidateUserSessions' inner catch swallows into a logger.warn, and
    // (b) leave nothing for a test to assert against even once updateMany
    // existed. Both halves have to be fixed for a revoke to be provable here.
    sessionsCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      findOne: vi.fn(),
      insertOne: vi.fn(),
      updateOne: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteOne: vi.fn(),
    };

    db = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'access') return accessCollection;
        if (name === 'logs') return logsCollection;
        if (name === 'organizations') return organizationsCollection;
        if (name === 'sessions') return sessionsCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn(),
          insertOne: vi.fn(),
          updateOne: vi.fn(),
          deleteOne: vi.fn(),
        };
      }),
    };

    vi.clearAllMocks();
  });

  it('GET /api/users deve retornar lista sanitizada', async () => {
    const handler = getHandler(userRoutes, 'get', '/');
    usersCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: 'user-1',
          name: 'Administrador',
          email: 'admin@bioavanced.com.br',
          username: 'admin',
          password: 'secret',
          accessType: 4,
          status: 'active',
        },
      ]),
    });

    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data).toHaveLength(1);
    expect(res.payload.data[0].password).toBeUndefined();
    expect(res.payload.data[0].id).toBe('user-1');
  });

  // #1068: dict-02 P1X-0197 says of mfaSecretCiphertext: "Nunca retornar na API
  // de consulta." Every user read path destructured `password` and nothing else,
  // so the live TOTP seed rode out on all three. Anyone holding it can mint valid
  // second-factor codes indefinitely -- a full MFA bypass, not an info leak.
  //
  // #993 and #998 are the write-side siblings of this defect and are both closed;
  // the read side had never been looked at.
  describe('#1068: user read paths never return mfaSecretCiphertext', () => {
    const LEAKED_SECRET = 'M'.repeat(32);

    function seededUser(overrides = {}) {
      return {
        _id: 'user-1',
        name: 'Administrador',
        email: 'admin@bioavanced.com.br',
        username: 'admin',
        password: 'hashed',
        accessType: 4,
        status: 'active',
        mfaEnabled: true,
        // #1072: the row carries BOTH the live ciphertext field and the
        // pre-rename plaintext name, because UserModel.stripSecrets
        // deliberately strips both -- a stale row must not leak a raw seed.
        mfaSecretCiphertext: LEAKED_SECRET,
        mfaSecret: LEAKED_SECRET,
        // CONTROL: kept deliberately. It is not a credential, and the UI renders
        // it -- stripping the whole MFA block would be the wrong fix.
        mfaActivationDate: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    it('GET /api/users does not return mfaSecretCiphertext', async () => {
      const handler = getHandler(userRoutes, 'get', '/');
      usersCollection.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([seededUser()]) });
      const req = createRequest();
      req.app.locals.db = db;
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.payload)).not.toContain(LEAKED_SECRET);
      expect(res.payload.data[0]).not.toHaveProperty('mfaSecretCiphertext');
      expect(res.payload.data[0]).not.toHaveProperty('mfaSecret');
      expect(res.payload.data[0].password).toBeUndefined();
      // CONTROL: the non-credential MFA fields survive.
      expect(res.payload.data[0].mfaEnabled).toBe(true);
      expect(res.payload.data[0].mfaActivationDate).toBe('2026-01-01T00:00:00.000Z');
    });

    it('GET /api/users/:id does not return mfaSecretCiphertext', async () => {
      const handler = getHandler(userRoutes, 'get', '/:id');
      usersCollection.findOne.mockResolvedValue(seededUser());
      const req = createRequest({ params: { id: 'user-1' } });
      req.app.locals.db = db;
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.payload)).not.toContain(LEAKED_SECRET);
      expect(res.payload.data).not.toHaveProperty('mfaSecretCiphertext');
      expect(res.payload.data).not.toHaveProperty('mfaSecret');
      expect(res.payload.data.mfaEnabled).toBe(true);
    });
  });

  // #1330: user documents are stored under the dict-02 UserAccount names; the
  // API keeps its keys, and neither name of the hash or the history leaves.
  describe('#1330: user responses keep their keys whichever names the document is stored under', () => {
    const HASH = '$2a$10$' + 'h'.repeat(53);
    const OLD_HASH = '$2a$10$' + 'o'.repeat(53);
    const canonicalUser = () => ({
      _id: 'user-canonical',
      displayName: 'Conta Canônica',
      email: 'canonica@bioavanced.com.br',
      username: 'canonica',
      passwordHash: HASH,
      passwordHistoryHashes: [OLD_HASH],
      accountStatus: 'active',
      mfaEnabled: true,
      mfaSetupAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: '2026-02-01T00:00:00.000Z',
      forcePasswordReset: false,
      passwordResetTokenHash: 'digest',
      passwordResetExpiresAt: '2026-03-01T00:00:00.000Z',
    });

    function expectNoHashOrHistory(body) {
      for (const key of ['password', 'passwordHash', 'passwordHistory', 'passwordHistoryHashes', 'passwordResetTokenHash']) {
        expect(body).not.toHaveProperty(key);
      }
    }

    it('GET /api/users returns a canonical document under the API keys, with no hash or history', async () => {
      const handler = getHandler(userRoutes, 'get', '/');
      usersCollection.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([canonicalUser()]) });
      const req = createRequest();
      req.app.locals.db = db;
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const row = res.payload.data[0];
      expectNoHashOrHistory(row);
      expect(JSON.stringify(res.payload)).not.toContain(HASH);
      expect(JSON.stringify(res.payload)).not.toContain(OLD_HASH);
      expect(row).toMatchObject({
        name: 'Conta Canônica',
        status: 'Ativo',
        mfaActivationDate: '2026-01-01T00:00:00.000Z',
        lastLogin: '2026-02-01T00:00:00.000Z',
        forceReset: false,
        passwordResetExpires: '2026-03-01T00:00:00.000Z',
      });
      for (const canonical of ['displayName', 'accountStatus', 'mfaSetupAt', 'lastLoginAt', 'forcePasswordReset', 'passwordResetExpiresAt']) {
        expect(row).not.toHaveProperty(canonical);
      }
    });

    it('GET /api/users/:id and /:id/validate-status read a canonical document', async () => {
      usersCollection.findOne.mockResolvedValue({ ...canonicalUser(), accountStatus: 'blocked' });
      const byId = createResponse();
      const req = createRequest({ params: { id: 'user-canonical' } });
      req.app.locals.db = db;
      await getHandler(userRoutes, 'get', '/:id')(req, byId);
      expect(byId.statusCode).toBe(200);
      expectNoHashOrHistory(byId.payload.data);
      expect(byId.payload.data).toMatchObject({ name: 'Conta Canônica', status: 'Bloqueado' });

      const status = createResponse();
      await getHandler(userRoutes, 'get', '/:id/validate-status')(req, status);
      expect(status.payload.data).toEqual({ status: 'blocked' });
    });

    it('POST /api/users/register stores the canonical names only and answers with neither hash name', async () => {
      const handler = getHandler(userRoutes, 'post', '/register');
      const req = createRequest({
        body: { name: 'Nova Conta', email: 'nova-1330@example.com', username: 'nova1330', password: 'Senha@123-forte!', accessType: 2, status: 'Ativo' },
      });
      req.app.locals.db = db;
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(201);
      const stored = usersCollection.insertOne.mock.calls[0][0];
      expect(stored).toMatchObject({ displayName: 'Nova Conta', accountStatus: 'active', forcePasswordReset: false, lastLoginAt: null, passwordHistoryHashes: [] });
      expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
      for (const legacy of ['name', 'password', 'status', 'forceReset', 'lastLogin', 'passwordHistory', 'mfaActivationDate', 'passwordResetExpires']) {
        expect(stored).not.toHaveProperty(legacy);
      }
      expectNoHashOrHistory(res.payload.data);
      expect(JSON.stringify(res.payload)).not.toContain(stored.passwordHash);
      expect(JSON.stringify(res.payload)).not.toContain('Senha@123-forte!');
      expect(res.payload.data).toMatchObject({ name: 'Nova Conta', status: 'active', forceReset: false, lastLogin: null });
    });
  });

  it('POST /api/users/register deve normalizar status, telefone e organizationId', async () => {
    const handler = getHandler(userRoutes, 'post', '/register');
    const req = createRequest({
      body: {
        name: 'Novo Usuário',
        email: 'new@example.com',
        username: 'newuser',
        password: 'Senha@123-forte!',
        accessType: 2,
        status: 'Ativo',
        phone: '(11) 99876-5432',
        organizationId: '   ',
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
    expect(req.body.status).toBe('active');
    expect(req.body.phone).toBe('11998765432');
    expect(req.body.organizationId).toBeNull();
  });

  it('#617: POST /api/users/register rejeita organizationId que não resolve a uma Organization real', async () => {
    const handler = getHandler(userRoutes, 'post', '/register');
    organizationsCollection.findOne.mockResolvedValueOnce(null);
    const req = createRequest({
      body: {
        name: 'Novo Usuário',
        email: 'new@example.com',
        username: 'newuser',
        password: 'Senha@123-forte!',
        accessType: 2,
        organizationId: 'org-inexistente',
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(String(res.payload.message || '')).toContain('org-inexistente');
    expect(organizationsCollection.findOne).toHaveBeenCalledWith({ organizationId: 'org-inexistente' });
  });

  it('POST /api/users/register deve negar usuário sem permissão', async () => {
    const handler = getHandler(userRoutes, 'post', '/register');
    const req = createRequest({
      user: { userID: '507f1f77bcf86cd799439012', accessType: 2, roleName: 'Técnico' },
      body: {
        name: 'Novo Usuário',
        email: 'new@example.com',
        username: 'newuser',
        password: 'Senha@123-forte!',
        accessType: 2,
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
  });

  it('POST /api/users/:id/reset-mfa deve resetar MFA de usuário não-admin', async () => {
    // #426: o admin-gate agora resolve via UserRoleAssignment (o requester
    // '...011' já tem role administrator ativa no rbacCollections do
    // beforeEach) -- não é mais lido de volta de um findOne('users').
    const handler = getHandler(userRoutes, 'post', '/:id/reset-mfa');
    usersCollection.findOne
      .mockResolvedValueOnce({
        _id: 'user-target-1',
        accessType: 2,
        roleName: 'Técnico',
        mfaEnabled: true,
      });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: 'user-target-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalled();
  });

  // #933: these three guards had NO test. That is the finding, independent of
  // whether direction 2 (letting reset-mfa clear mfaLocked on an admin target)
  // is ever built: the refusals could have regressed at any point undetected,
  // and a change to them should have to be deliberate.
  //
  // Direction 2 IS now built. This assertion was originally "REFUSES an
  // administrator target, writing nothing" (400, no $set), pinned as CURRENT
  // behaviour with an explicit note that it was not an endorsement. It is
  // un-weakened here rather than deleted: the deliberate change it was
  // guarding has happened, so it now pins the narrowed refusal -- the secret
  // is still protected, the lock is not.
  it('#933: reset-mfa UNLOCKS an administrator target without touching the enrolment', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/reset-mfa');
    usersCollection.findOne.mockResolvedValueOnce({
      _id: '507f1f77bcf86cd799439011',
      accessType: 4, roleName: 'Administrador', mfaEnabled: true,
      mfaSecretCiphertext: 'SECRET-DO-NOT-CLEAR', mfaLocked: true, mfaFailedAttempts: 5,
    });

    const req = createRequest({ params: { id: '507f1f77bcf86cd799439011' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalledTimes(1);

    // The two halves the old refusal blocked together: the lock clears, the
    // enrolment does not move. Only the second was ever the sensitive one
    // (dict-02 P1X-0197 for the secret, P1X-0199/P1X-0200 for the counters).
    const $set = usersCollection.updateOne.mock.calls[0][1].$set;
    expect($set.mfaLocked).toBe(false);
    expect($set.mfaFailedAttempts).toBe(0);
    expect($set).not.toHaveProperty('mfaSecretCiphertext');
    expect($set).not.toHaveProperty('mfaEnabled');
  });

  it('#933: disable-mfa REFUSES a non-administrator caller', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/disable-mfa');

    const req = createRequest({
      params: { id: '507f1f77bcf86cd799439011' },
      user: { userID: '507f1f77bcf86cd799439012', accessType: 2, roleName: 'Técnico' },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    // This is the half that makes the all-admins-locked estate unrecoverable
    // in-app: the endpoint needs an admin who is already logged in, and the
    // mfaLocked gate is what prevents that.
    expect(res.statusCode).toBe(403);
  });

  it('#933: disable-mfa REFUSES a non-administrator target -- it is admin-to-admin only', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/disable-mfa');
    usersCollection.findOne.mockResolvedValueOnce({
      _id: '507f1f77bcf86cd799439012',
      accessType: 2, roleName: 'Técnico', mfaEnabled: true,
    });

    const req = createRequest({ params: { id: '507f1f77bcf86cd799439012' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    // The half #933's body omits: both directions are gated, so disable-mfa is
    // exactly the endpoint an all-admins-locked estate needs and exactly the
    // one it cannot reach.
    expect(res.statusCode).toBe(403);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  // #963 (RF003 AC#5, "Revogar sessões"): an admin resets MFA precisely
  // because they believe the second factor is compromised. Nothing on the
  // request path re-reads mfaEnabled -- the JWT still carries
  // mfaVerified:true and middleware/auth.js's only live-DB re-check reads
  // roleValidUntil and nothing else -- so without this the session the reset
  // was meant to kill survives, renewable indefinitely.
  it('POST /api/users/:id/reset-mfa revoga as sessões do alvo (#963)', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/reset-mfa');
    usersCollection.findOne.mockResolvedValueOnce({
      _id: 'user-target-1',
      accessType: 2,
      roleName: 'Técnico',
      mfaEnabled: true,
    });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: 'user-target-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Assert the FILTER's id value, not merely that updateMany ran. The
    // sessions collection keys its owner as a string (`Session.js` coerces
    // with String(data.userAccountId), fed from auth.service.js's
    // user._id.toString()), so revoking with a non-string id matches
    // nothing, throws nothing and still returns 200 -- a silent no-op.
    // #1330: the owner matches under userAccountId or the legacy userID.
    expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
      { $or: [{ userAccountId: 'user-target-1' }, { userID: 'user-target-1' }], isActive: true },
      expect.objectContaining({
        $set: expect.objectContaining({ isActive: false, isRevoked: true }),
      })
    );
  });

  // RF014 AC#4 (#648): admin-initiated -- flags the target user's account so
  // their next login requires setting a new password (auth.service.js's
  // processLogin gate). Same handler shape as reset-mfa above.
  it('POST /api/users/:id/force-password-reset deve marcar forceReset no usuário alvo', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/force-password-reset');
    usersCollection.findOne
      .mockResolvedValueOnce({
        _id: 'user-target-1',
        accessType: 2,
        roleName: 'Técnico',
        forceReset: false,
      });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: 'user-target-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // #1330: stored as forcePasswordReset; the legacy forceReset is removed.
    expect(usersCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ forcePasswordReset: true }),
        $unset: { forceReset: '' }
      })
    );
  });

  it('POST /api/users/:id/force-password-reset retorna 404 quando o usuário alvo não existe', async () => {
    const handler = getHandler(userRoutes, 'post', '/:id/force-password-reset');
    usersCollection.findOne.mockResolvedValueOnce(null);

    const req = createRequest({ params: { id: 'no-such-user' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  it('POST /api/users/:id/disable-mfa deve desativar MFA de admin', async () => {
    // #426: both the requester ('...011') and the target ('user-target-2')
    // need an active administrator UserRoleAssignment for this scenario --
    // the shared beforeEach rbacCollections only grants '...011', so this
    // test builds its own db with both.
    const handler = getHandler(userRoutes, 'post', '/:id/disable-mfa');
    usersCollection.findOne
      .mockResolvedValueOnce({
        _id: 'user-target-2',
        accessType: 4,
        roleName: 'Administrador',
        mfaEnabled: true,
      });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-2', accessType: 4 },
    ]);
    const dbWithTargetAdmin = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({ params: { id: 'user-target-2' } });
    req.app.locals.db = dbWithTargetAdmin;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(usersCollection.updateOne).toHaveBeenCalled();
  });

  // #427: PUT /:id stops dual-writing accessType/roleName onto the User
  // document — only used to resolve the UserRoleAssignment change (#421),
  // and the response's roleName is resolved from that assignment.
  it('PUT /api/users/:id nao persiste accessType/roleName e resolve roleName da RBAC assignment na resposta', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-3',
      name: 'Alvo',
      email: 'alvo@bioavanced.com.br',
      username: 'alvo',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser) // busca inicial (targetUser)
      .mockResolvedValueOnce({ ...targetUser, accessType: 4 }); // apos update
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-3', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-3' },
      body: { accessType: 4, roleName: 'Administrador' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('accessType');
    expect(setPayload).not.toHaveProperty('roleName');
    expect(res.payload.data.roleName).toBe('Administrador');
  });

  it('#617: PUT /api/users/:id rejeita organizationId que não resolve a uma Organization real', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-3b',
      name: 'Alvo Org Inválida',
      email: 'alvo-org-invalida@bioavanced.com.br',
      username: 'alvoorginvalida',
      status: 'active',
      accessType: 2,
    };
    usersCollection.findOne.mockResolvedValueOnce(targetUser);

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-3b', accessType: 2 },
    ]);
    const invalidOrgCollection = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'organizations') return invalidOrgCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-3b' },
      body: { organizationId: 'org-inexistente' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    expect(String(res.payload.message || '')).toContain('org-inexistente');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
  });

  // #429: PUT /:id's `auditorRole` flag grants/revokes the additive
  // `auditor` RBAC role via grantAdditionalRole/revokeAdditionalRole,
  // stacking alongside (not replacing) the user's accessType-derived role,
  // and is never persisted onto the User document.
  it('PUT /api/users/:id com auditorRole=true concede a role auditor sem persistir o campo no documento', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-4',
      name: 'Alvo Auditor',
      email: 'alvo-auditor@bioavanced.com.br',
      username: 'alvoauditor',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-4', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-4' },
      body: { auditorRole: true },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('auditorRole');
    expect(rbacCollections.userRoleAssignments.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ userAccountId: 'user-target-4', roleId: 'role-auditor', assignmentStatus: 'active' })
    );
  });

  // #615: accessType and organizationId change together -> changeUserRole's
  // revoke+re-grant must scope the new assignment to the new organizationId.
  it('PUT /api/users/:id com accessType e organizationId alterados escopa a nova assignment ao novo organizationId', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-5',
      name: 'Alvo Escopo',
      email: 'alvo-escopo@bioavanced.com.br',
      username: 'alvoescopo',
      status: 'active',
      accessType: 2,
      organizationId: 'org-old',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, accessType: 3, organizationId: 'org-new' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([]);
    const assignmentDocs = [
      { assignmentId: 'assign-5', userAccountId: 'user-target-5', roleId: 'role-technician', scopeType: 'organization', scopeId: 'org-old', assignmentStatus: 'active', validUntil: null },
      // #998: the CALLER's own assignment. This fixture never needed one --
      // nothing on this route resolved the caller's level until the #998 floor
      // landed, so an unassigned caller was indistinguishable from an
      // administrator. It now fails closed, which is correct for a privilege
      // gate and is why this line is a fixture completion rather than a
      // loosening: createRequest's default caller is the accessType-4
      // administrator, and this makes the mock say so.
      { assignmentId: 'assign-5-caller', userAccountId: '507f1f77bcf86cd799439011', roleId: 'role-administrator', scopeType: 'global', scopeId: null, assignmentStatus: 'active', validUntil: null },
    ];
    const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rbacCollections.roles;
        if (name === 'permissions') return rbacCollections.permissions;
        if (name === 'userRoleAssignments') return assignmentsMock;
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-5' },
      body: { accessType: 3, organizationId: 'org-new' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const newAssignment = assignmentDocs.find((a) => a.assignmentStatus === 'active' && a.roleId === 'role-coordinator');
    expect(newAssignment).toBeTruthy();
    expect(newAssignment.scopeType).toBe('organization');
    expect(newAssignment.scopeId).toBe('org-new');
    expect(assignmentDocs.find((a) => a.assignmentId === 'assign-5').assignmentStatus).toBe('revoked');
  });

  // #615: organizationId changes but accessType doesn't -> updateAssignmentScope
  // resyncs the existing assignment's scopeId in place, no revoke/re-grant.
  it('PUT /api/users/:id com apenas organizationId alterado atualiza o scopeId da assignment existente sem revogar', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-6',
      name: 'Alvo Org',
      email: 'alvo-org@bioavanced.com.br',
      username: 'alvoorg',
      status: 'active',
      accessType: 2,
      organizationId: 'org-old',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, organizationId: 'org-new' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([]);
    const assignmentDocs = [
      { assignmentId: 'assign-6', userAccountId: 'user-target-6', roleId: 'role-technician', scopeType: 'organization', scopeId: 'org-old', assignmentStatus: 'active', validUntil: null },
    ];
    const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rbacCollections.roles;
        if (name === 'permissions') return rbacCollections.permissions;
        if (name === 'userRoleAssignments') return assignmentsMock;
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-6' },
      body: { organizationId: 'org-new' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(assignmentDocs).toHaveLength(1); // no revoke/re-grant -- same assignment, updated in place
    const assignment = assignmentDocs[0];
    expect(assignment.assignmentId).toBe('assign-6');
    expect(assignment.assignmentStatus).toBe('active');
    expect(assignment.scopeId).toBe('org-new');
  });

  // #615: organizationId cleared to empty (route normalizes '' -> null) ->
  // scopeId goes null, the state #340/#341's resolver reads as 'unassigned'.
  it('PUT /api/users/:id com organizationId limpo zera o scopeId da assignment existente', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-7',
      name: 'Alvo Limpo',
      email: 'alvo-limpo@bioavanced.com.br',
      username: 'alvolimpo',
      status: 'active',
      accessType: 2,
      organizationId: 'org-old',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, organizationId: null });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([]);
    const assignmentDocs = [
      { assignmentId: 'assign-7', userAccountId: 'user-target-7', roleId: 'role-technician', scopeType: 'organization', scopeId: 'org-old', assignmentStatus: 'active', validUntil: null },
    ];
    const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (name === 'roles') return rbacCollections.roles;
        if (name === 'permissions') return rbacCollections.permissions;
        if (name === 'userRoleAssignments') return assignmentsMock;
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-7' },
      body: { organizationId: '' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(assignmentDocs[0].scopeId).toBeNull();
  });

  // #875: PUT /:id used to $set req.body directly, so any key on the
  // request body reached the driver untouched. This regression pins the
  // allowlist that closes the route's last mechanical #875 site -- an
  // injected key, a business-key spoof (userID) and an attempt to clear
  // the MFA lockout counter (mfaLocked) must all be dropped from $set,
  // while a legitimate field (name) still goes through.
  it('PUT /api/users/:id descarta chaves nao permitidas (injected/userID/mfaLocked) do $set', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-8',
      name: 'Alvo Original',
      email: 'alvo-injecao@bioavanced.com.br',
      username: 'alvoinjecao',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, name: 'Alvo Renomeado' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-8', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-8' },
      body: { name: 'Alvo Renomeado', injected: 'x', mfaLocked: false, userID: 999, failedLoginAttempts: 0, accountLockedUntil: null, anonId: 'USR-OTHER001' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    // #1330: the body's name is stored as displayName, and the legacy name
    // is removed.
    expect(setPayload.displayName).toBe('Alvo Renomeado');
    expect(usersCollection.updateOne.mock.calls[0][1].$unset).toEqual({ name: '' });
    expect(res.payload.data.name).toBe('Alvo Renomeado');
    expect(setPayload).not.toHaveProperty('injected');
    expect(setPayload).not.toHaveProperty('mfaLocked');
    expect(setPayload).not.toHaveProperty('userID');
    // #952: failedLoginAttempts became load-bearing (RF001 AC#2), so it was
    // removed from ALLOWED_USER_UPDATE_FIELDS -- leaving it there would let any
    // createUser holder clear a target's brute-force counter, and its expiry,
    // through a generic update. Same hazard the mfaLocked exclusion above exists
    // for; that one had a test and this one did not.
    expect(setPayload).not.toHaveProperty('failedLoginAttempts');
    expect(setPayload).not.toHaveProperty('accountLockedUntil');
    // #1275 follow-up: log reads now honour a stored anonId, so a caller who
    // could set it could make one user's audit rows read as another's.
    expect(setPayload).not.toHaveProperty('anonId');
    expect(Object.keys(setPayload).sort()).toEqual(['displayName', 'updatedAt']);
  });

  // #1013: PUT /api/users/:id used to hash and $set an inbound password under
  // createUser, with no reuse check, no history and a generic audit row. The
  // administrator's password set is POST /:id/set-password now, and a PUT
  // carrying one is refused rather than ignored, so a stale client cannot
  // believe it changed a password. #982's session revocation moved with it
  // (the set-password block below).
  it('#1013: PUT /api/users/:id refuses a password and writes nothing', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-9',
      name: 'Alvo Senha',
      email: 'alvo-senha@bioavanced.com.br',
      username: 'alvosenha',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-9', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-9' },
      body: { password: 'NovaSenh@2026-forte' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(String(res.payload.message)).toContain('set-password');
    expect(usersCollection.updateOne).not.toHaveBeenCalled();
    expect(sessionsCollection.updateMany).not.toHaveBeenCalled();
  });

  // #1013: the administrator's password set, with the bookkeeping the old PUT
  // path skipped. #982's revocation (RF003 AC#5) moved here with it.
  describe('#1013: POST /api/users/:id/set-password', () => {
    const bcrypt = require2('bcryptjs');

    function seedTarget(overrides = {}) {
      const targetUser = {
        _id: 'user-target-1013',
        name: 'Alvo 1013',
        email: 'alvo-1013@bioavanced.com.br',
        username: 'alvo1013',
        status: 'active',
        password: bcrypt.hashSync('Atual@2026x', 4),
        passwordHistory: [],
        ...overrides,
      };
      usersCollection.findOne.mockResolvedValue(targetUser);
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      return targetUser;
    }

    async function post(body) {
      const handler = getHandler(userRoutes, 'post', '/:id/set-password');
      const req = createRequest({ params: { id: 'user-target-1013' }, body });
      req.app.locals.db = db;
      const res = createResponse();
      await handler(req, res);
      return res;
    }

    it('sets the hash, keeps the old one in history, forces a change at next login and revokes sessions', async () => {
      const target = seedTarget();

      const res = await post({ password: 'NovaSenh@2026-forte' });

      expect(res.statusCode).toBe(200);
      expect(usersCollection.updateOne).toHaveBeenCalledTimes(1);
      // #1330: the legacy-named target is written under the canonical names,
      // its legacy history carried over, and the legacy names removed.
      const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
      expect(bcrypt.compareSync('NovaSenh@2026-forte', setPayload.passwordHash)).toBe(true);
      expect(setPayload.passwordHistoryHashes).toEqual([target.password]);
      expect(setPayload.passwordChangedAt).toBeInstanceOf(Date);
      expect(usersCollection.updateOne.mock.calls[0][1].$unset).toEqual({ password: '', passwordHistory: '', forceReset: '' });
      // The administrator knows this password; the owner must replace it.
      expect(setPayload.forcePasswordReset).toBe(true);
      expect(res.payload.data).toEqual({ forceReset: true });
      expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
        { $or: [{ userAccountId: 'user-target-1013' }, { userID: 'user-target-1013' }], isActive: true },
        expect.objectContaining({
          $set: expect.objectContaining({
            isRevoked: true,
            revocationReason: 'admin_action',
            revokedBy: '507f1f77bcf86cd799439011',
          }),
        })
      );
      expect(auditSpies.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'UPDATE',
        resourceType: 'User',
        message: expect.stringContaining('Senha definida por administrador'),
      }));
    });

    it('refuses a password in the target\'s recent history, writing nothing', async () => {
      seedTarget({ passwordHistory: [bcrypt.hashSync('Antiga@2025x-forte', 4)] });

      const res = await post({ password: 'Antiga@2025x-forte' });

      expect(res.statusCode).toBe(422);
      expect(String(res.payload.message)).toContain('Senha já utilizada recentemente');
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
      expect(sessionsCollection.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a password that fails the strength policy, writing nothing', async () => {
      seedTarget();

      const res = await post({ password: 'fraca' });

      expect(res.statusCode).toBe(422);
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown user', async () => {
      usersCollection.findOne.mockResolvedValue(null);

      const res = await post({ password: 'NovaSenh@2026-forte' });

      expect(res.statusCode).toBe(404);
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });
  });

  // #982: the mirror -- an update that carries no password must NOT revoke.
  // Without this, "revoke on every PUT" would pass the test above while
  // logging users out of every unrelated profile edit.
  it('#982: PUT /api/users/:id sem senha não revoga sessão alguma', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-10',
      name: 'Alvo Sem Senha',
      email: 'alvo-sem-senha@bioavanced.com.br',
      username: 'alvosemsenha',
      status: 'active',
      accessType: 2,
      roleName: 'Técnico',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce({ ...targetUser, name: 'Renomeado' });
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-10', accessType: 2 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-10' },
      body: { name: 'Renomeado' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(sessionsCollection.updateMany).not.toHaveBeenCalled();
  });

  // #1306 (RF001 AC4, RNF021 C2): PUT never revoked, so an inactivated or
  // re-roled user's live session kept working under the old state.
  describe('#1306: PUT /api/users/:id revokes sessions on inactivation and role change', () => {
    async function put(body, { status = 'active', accessType = 2 } = {}) {
      const handler = getHandler(userRoutes, 'put', '/:id');
      const targetUser = {
        _id: 'user-target-1306',
        name: 'Alvo 1306',
        email: 'alvo-1306@bioavanced.com.br',
        username: 'alvo1306',
        status,
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce({ ...targetUser, ...body });
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      const rbacCollections = buildRbacCollections([
        { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
        { userAccountId: 'user-target-1306', accessType },
      ]);
      const req = createRequest({ params: { id: 'user-target-1306' }, body });
      req.app.locals.db = {
        collection: vi.fn((name) => {
          if (name === 'users') return usersCollection;
          if (rbacCollections[name]) return rbacCollections[name];
          return db.collection(name);
        }),
      };
      const res = createResponse();
      await handler(req, res);
      return res;
    }

    const revokedAsAdminAction = () => expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
      { $or: [{ userAccountId: 'user-target-1306' }, { userID: 'user-target-1306' }], isActive: true },
      expect.objectContaining({
        $set: expect.objectContaining({ isRevoked: true, revocationReason: 'admin_action', revokedBy: '507f1f77bcf86cd799439011' }),
      })
    );

    it.each(['inactive', 'Inativo', 'blocked', 'suspended'])('status %s revokes the sessions', async (status) => {
      const res = await put({ status });
      expect(res.statusCode).toBe(200);
      revokedAsAdminAction();
    });

    it('a level change revokes the sessions', async () => {
      const res = await put({ accessType: 3 });
      expect(res.statusCode).toBe(200);
      revokedAsAdminAction();
    });

    it('CONTROL: an echoed unchanged status and level revoke nothing, nor does a reactivation', async () => {
      expect((await put({ status: 'active', accessType: 2 })).statusCode).toBe(200);
      expect((await put({ status: 'active' }, { status: 'inactive' })).statusCode).toBe(200);
      expect(sessionsCollection.updateMany).not.toHaveBeenCalled();
    });
  });

  // #993: mfaSecretCiphertext/mfaActivationDate sat on ALLOWED_USER_UPDATE_FIELDS, and
  // the admin branch above keeps whatever the caller sent when mfaEnabled is
  // explicitly true. So one PUT could set a target's password AND replace
  // their TOTP secret with one the caller generated -- a silent account
  // takeover, and the victim's next login fails against a secret they no
  // longer hold. The route only ever legitimately writes these two fields as
  // a server-set null (the disable-MFA clear); it must never carry a
  // caller-supplied value.
  it('#993: PUT /api/users/:id nunca aceita mfaSecretCiphertext do chamador, mesmo com mfaEnabled=true em alvo admin', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-11',
      name: 'Alvo Admin',
      email: 'alvo-admin@bioavanced.com.br',
      username: 'alvoadmin',
      status: 'active',
      accessType: 4,
      roleName: 'Administrador',
      mfaEnabled: true,
      mfaSecretCiphertext: 'SEGREDO-LEGITIMO-DO-ALVO',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-11', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-11' },
      body: {
        mfaEnabled: true,
        mfaSecretCiphertext: 'SEGREDO-DO-ATACANTE', mfaSecret: 'SEGREDO-DO-ATACANTE',
        mfaActivationDate: '2026-01-01T00:00:00.000Z',
      },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    // Assert the VALUE is absent, not merely that it differs -- writing the
    // attacker's string would be the takeover, and writing any other
    // caller-derived value would be the same defect wearing a new shape.
    expect(setPayload).not.toHaveProperty('mfaSecretCiphertext');
    expect(setPayload).not.toHaveProperty('mfaSecret');
    expect(setPayload).not.toHaveProperty('mfaActivationDate');
    expect(setPayload).not.toHaveProperty('mfaSetupAt');
    expect(JSON.stringify(setPayload)).not.toContain('SEGREDO-DO-ATACANTE');
  });

  // #993: the clear must survive, and #1021 moved WHICH write it is. When
  // this was written, disabling MFA on an already-admin target was the one
  // legitimate server-set write to these fields on this route. #1021 took
  // that away -- disabling now belongs to POST /:id/disable-mfa, which
  // preserves the secret -- so the surviving legitimate write is the
  // PROMOTION: a target being raised to Administrador does not keep an
  // enrolment made under its old role.
  //
  // Repointed rather than deleted, because the property #993 exists for is
  // unchanged: the clear is server-set, the caller's own mfaSecretCiphertext must never
  // reach $set, and a blanket removal from ALLOWED_USER_UPDATE_FIELDS would
  // still leave a stale secret behind an mfaEnabled:false flag.
  it('#993/#1021: a PROMOCAO a Administrador zera mfaSecretCiphertext/mfaActivationDate, e nunca grava o do chamador', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-12',
      name: 'Alvo A Promover',
      email: 'alvo-admin2@bioavanced.com.br',
      username: 'alvoadmin2',
      status: 'active',
      accessType: 3,
      roleName: 'Coordenador',
      mfaEnabled: true,
      mfaSecretCiphertext: 'SEGREDO-A-SER-LIMPO',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-12', accessType: 3 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-12' },
      body: { accessType: 4, mfaEnabled: true, mfaSecretCiphertext: 'SEGREDO-DO-ATACANTE', mfaSecret: 'SEGREDO-DO-ATACANTE' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.mfaEnabled).toBe(false);
    expect(setPayload.mfaSecretCiphertext).toBeNull();
    // #1330: stored as mfaSetupAt.
    expect(setPayload.mfaSetupAt).toBeNull();
    // #993's own point: the caller's value must not survive anywhere in the
    // write, not merely differ from it.
    expect(JSON.stringify(setPayload)).not.toContain('SEGREDO-DO-ATACANTE');
    // #914 / #1011: the destroyed enrolment is on the trail as an MFA row, not
    // only as a generic User update.
    const mfaRows = auditSpies.log.mock.calls.filter(([entry]) => entry && entry.action === 'MFA');
    expect(mfaRows).toHaveLength(1);
    expect(mfaRows[0][0]).toMatchObject({
      resourceId: 'user-target-12',
      severity: 'critical',
      payload: { operation: 'promotion_clear', enrolmentPreserved: false, secondFactorActive: false },
    });
  });

  // Recurrence of #1021 by a new path: isBecomingAdmin was computed from the
  // request alone, and NewUserPage echoes roleName on every save, so a plain
  // rename of an EXISTING Administrador counted as a promotion and destroyed
  // their MFA enrolment. A promotion is a change of level, as #1009 decided
  // for changeUserRole.
  it('an edit of an existing Administrador that echoes roleName keeps their MFA enrolment', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-admin-echo',
      name: 'Admin Existente',
      email: 'admin-existente@bioavanced.com.br',
      username: 'adminexistente',
      status: 'active',
      mfaEnabled: true,
      mfaSecretCiphertext: 'SEGREDO-DO-ADMIN',
      mfaActivationDate: new Date('2026-01-01T00:00:00.000Z'),
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-admin-echo', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-admin-echo' },
      body: { name: 'Admin Renomeado', roleName: 'Administrador', accessType: 4 },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('mfaEnabled');
    expect(setPayload).not.toHaveProperty('mfaSecretCiphertext');
    expect(setPayload).not.toHaveProperty('mfaActivationDate');
    expect(setPayload).not.toHaveProperty('mfaSetupAt');
    const mfaRows = auditSpies.log.mock.calls.filter(([entry]) => entry && entry.action === 'MFA');
    expect(mfaRows).toHaveLength(0);
  });

  // #1245 item 4: the level floor and changeUserRole read accessType through
  // Number(), so a JSON string '4' promotes -- ROLE_CODE_BY_ACCESS_TYPE['4']
  // resolves -- while isBecomingAdmin compared it with === 4 and missed it.
  // That promotion skipped #1011's confirmed enrolment clear and its
  // promotion_clear row.
  it("#1245: a promotion sent as accessType '4' (a string) is a promotion", async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-string-4',
      name: 'Alvo String',
      email: 'alvo-string@bioavanced.com.br',
      username: 'alvostring',
      status: 'active',
      mfaEnabled: true,
      mfaSecretCiphertext: 'SEGREDO-A-SER-LIMPO',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-string-4', accessType: 3 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({ params: { id: 'user-target-string-4' }, body: { accessType: '4' } });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload.mfaEnabled).toBe(false);
    expect(setPayload.mfaSecretCiphertext).toBeNull();
    const mfaRows = auditSpies.log.mock.calls.filter(([entry]) => entry && entry.action === 'MFA');
    expect(mfaRows).toHaveLength(1);
    expect(mfaRows[0][0].payload).toMatchObject({ operation: 'promotion_clear' });
  });

  it('#914/#1011: promoting a user with NO enrolment writes no MFA row -- there was nothing to clear', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-13',
      name: 'Alvo Sem MFA',
      email: 'alvo-sem-mfa@bioavanced.com.br',
      username: 'alvosemmfa',
      status: 'active',
      accessType: 3,
      roleName: 'Coordenador',
      mfaEnabled: false,
      mfaSecretCiphertext: null,
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-13', accessType: 3 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({ params: { id: 'user-target-13' }, body: { accessType: 4 } });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const mfaRows = auditSpies.log.mock.calls.filter(([entry]) => entry && entry.action === 'MFA');
    expect(mfaRows).toHaveLength(0);
  });

  // #1021: a PUT that merely OMITS mfaEnabled destroyed an Administrador's
  // second factor. The guard was `undefined || false`, so ANY partial-body
  // PUT against an admin target -- a `{name:'x'}` rename from a script --
  // set mfaEnabled:false and nulled the secret and activation date.
  //
  // Reachability, which is what made it worse than latent: `createUser` gates
  // this route and is granted to Coordenador as well as Administrador, and
  // the #998/#1009 hierarchy floor is wrapped in `if (requestedAccessType)`
  // so it fires only when the body carries accessType/roleName. A Coordenador
  // sending `{name:'x'}` at an admin skipped the floor entirely.
  //
  // Direction from #999's closing comment: delete mfaEnabled from the body up
  // front (the #993 shape), and narrow the clear branch's trigger from
  // `undefined || false` to the actual promotion. Disabling MFA now goes
  // through POST /:id/disable-mfa, which is permissioned, preserves the
  // secret for re-activation, and writes its own audit row -- and which the
  // operator UI already calls from a dedicated button.
  it('#1021: um PUT que OMITE mfaEnabled nao toca no MFA de um alvo Administrador', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-1021',
      name: 'Alvo Admin 1021',
      email: 'alvo1021@bioavanced.com.br',
      username: 'alvo1021',
      status: 'active',
      accessType: 4,
      roleName: 'Administrador',
      mfaEnabled: true,
      mfaSecretCiphertext: 'SEGREDO-QUE-DEVE-SOBREVIVER',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-1021', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-1021' },
      body: { name: 'Nome Novo' },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('mfaEnabled');
    expect(setPayload).not.toHaveProperty('mfaSecretCiphertext');
    expect(setPayload).not.toHaveProperty('mfaSecret');
    expect(setPayload).not.toHaveProperty('mfaActivationDate');
    expect(setPayload).not.toHaveProperty('mfaSetupAt');
    // CONTROL within the case: the rename it actually asked for still happens,
    // so this is not passing because the whole update was refused. Stored as
    // displayName (#1330).
    expect(setPayload.displayName).toBe('Nome Novo');
  });

  // #1021: an explicit `false` is no longer a disable either. The route stops
  // being an MFA-disable path entirely; POST /:id/disable-mfa is the one.
  it('#1021: um mfaEnabled:false explicito tambem nao desabilita mais por esta rota', async () => {
    const handler = getHandler(userRoutes, 'put', '/:id');
    const targetUser = {
      _id: 'user-target-1021b',
      name: 'Alvo Admin 1021b',
      email: 'alvo1021b@bioavanced.com.br',
      username: 'alvo1021b',
      status: 'active',
      accessType: 4,
      roleName: 'Administrador',
      mfaEnabled: true,
      mfaSecretCiphertext: 'SEGREDO-QUE-DEVE-SOBREVIVER',
    };
    usersCollection.findOne
      .mockResolvedValueOnce(targetUser)
      .mockResolvedValueOnce(targetUser);
    usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const rbacCollections = buildRbacCollections([
      { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
      { userAccountId: 'user-target-1021b', accessType: 4 },
    ]);
    const dbWithTarget = {
      collection: vi.fn((name) => {
        if (name === 'users') return usersCollection;
        if (rbacCollections[name]) return rbacCollections[name];
        return db.collection(name);
      }),
    };

    const req = createRequest({
      params: { id: 'user-target-1021b' },
      body: { mfaEnabled: false },
    });
    req.app.locals.db = dbWithTarget;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const setPayload = usersCollection.updateOne.mock.calls[0][1].$set;
    expect(setPayload).not.toHaveProperty('mfaEnabled');
    expect(setPayload).not.toHaveProperty('mfaSecretCiphertext');
    expect(setPayload).not.toHaveProperty('mfaSecret');
  });

  it('GET /api/access deve listar acessos', async () => {
    const handler = getHandler(accessRoutes, 'get', '/');
    accessCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: 'access-1',
          reportID: 1,
          reportType: 'Relatório',
          accessType: 1,
        },
      ]),
    });

    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.data).toHaveLength(1);
  });

  it('POST /api/access deve criar acesso válido', async () => {
    const handler = getHandler(accessRoutes, 'post', '/');
    accessCollection.insertOne.mockResolvedValue({ insertedId: 'access-2' });

    const req = createRequest({
      body: {
        reportID: 2,
        reportType: 'Relatório Clínico',
        accessType: 3,
      },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
    expect(accessCollection.insertOne).toHaveBeenCalled();
  });

  // #1202: dict v2.0.0 AccessGrant fields on the written grant.
  it('#1202: POST /api/access grava grantedBy do chamador e os campos canônicos, ignorando o corpo', async () => {
    const handler = getHandler(accessRoutes, 'post', '/');
    accessCollection.insertOne.mockResolvedValue({ insertedId: 'access-3' });

    const req = createRequest({
      body: { reportID: 7, reportType: 'Relatório', grantedBy: 'forged', grantStatus: 'revoked' },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    const written = accessCollection.insertOne.mock.calls[0][0];
    expect(written).toMatchObject({
      resourceType: 'report',
      resourceId: 7,
      grantedBy: '507f1f77bcf86cd799439011',
      grantStatus: 'active',
      revokedAt: null,
    });
  });

  // #1201: dict-02 AccessGrant names (P1X-0238, P1X-0239, P1X-0243) in
  // storage, the API's accessID/userId in the response.
  it('#1201: POST /api/access grava userAccountId, accessGrantId e permissionCodes e responde com userId e accessID', async () => {
    const handler = getHandler(accessRoutes, 'post', '/');
    accessCollection.insertOne.mockResolvedValue({ insertedId: 'access-4' });

    const req = createRequest({ body: { reportID: 8, reportType: 'equipment', userId: 'user-ext-1' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    const written = accessCollection.insertOne.mock.calls[0][0];
    expect(written).toMatchObject({ userAccountId: 'user-ext-1', permissionCodes: ['viewReports'] });
    expect(written.accessGrantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(written).not.toHaveProperty('userId');
    expect(written).not.toHaveProperty('accessID');

    expect(res.payload.data).toMatchObject({ _id: 'access-4', userId: 'user-ext-1', accessID: written.accessGrantId, permissionCodes: ['viewReports'] });
    expect(res.payload.data).not.toHaveProperty('userAccountId');
    expect(res.payload.data).not.toHaveProperty('accessGrantId');
  });

  // #1372: a report grant's permissionCodes is the server's.
  it('#1372: POST /api/access com permissionCodes [manageUsers] responde 422 e não grava nada', async () => {
    const handler = getHandler(accessRoutes, 'post', '/');

    const req = createRequest({ body: { reportID: 9, reportType: 'equipment', permissionCodes: ['manageUsers'] } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(accessCollection.insertOne).not.toHaveBeenCalled();
  });

  it('#1201: PUT /api/access/:id grava userId sob userAccountId e remove o nome antigo', async () => {
    const handler = getHandler(accessRoutes, 'put', '/:id');
    accessCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({ params: { id: '507f1f77bcf86cd799439099' }, body: { userId: 'user-ext-2' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const [, update] = accessCollection.updateOne.mock.calls[0];
    expect(update.$set.userAccountId).toBe('user-ext-2');
    expect(update.$set).not.toHaveProperty('userId');
    expect(update.$unset).toEqual({ userId: '' });
  });

  it('#1201: GET /api/access responde concessões canônicas e antigas com userId e accessID', async () => {
    const handler = getHandler(accessRoutes, 'get', '/');
    accessCollection.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: 'a-1', accessGrantId: 'g-1', userAccountId: 'u-1', reportID: 1, reportType: 'equipment' },
        { _id: 'a-2', accessID: 5, userId: 'u-2', reportID: 2, reportType: 'equipment' },
      ]),
    });

    const req = createRequest();
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.data).toEqual([
      { _id: 'a-1', accessID: 'g-1', userId: 'u-1', reportID: 1, reportType: 'equipment' },
      { _id: 'a-2', accessID: 5, userId: 'u-2', reportID: 2, reportType: 'equipment' },
    ]);
  });

  it('#1202: DELETE /api/access/:id revoga a concessão em vez de apagá-la', async () => {
    const handler = getHandler(accessRoutes, 'delete', '/:id');
    accessCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

    const req = createRequest({
      params: { id: '507f1f77bcf86cd799439099' },
      body: { revocationReason: '  fim do estudo  ' },
    });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(accessCollection.deleteOne).not.toHaveBeenCalled();
    const [filter, update] = accessCollection.updateOne.mock.calls[0];
    expect(filter.grantStatus).toEqual({ $ne: 'revoked' });
    expect(update.$set).toMatchObject({ grantStatus: 'revoked', revocationReason: 'fim do estudo' });
    expect(update.$set.revokedAt).toBeInstanceOf(Date);
  });

  it('#1202: DELETE /api/access/:id de uma concessão já revogada responde 404', async () => {
    const handler = getHandler(accessRoutes, 'delete', '/:id');
    accessCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

    const req = createRequest({ params: { id: '507f1f77bcf86cd799439099' } });
    req.app.locals.db = db;
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  // #998 (RF003, RNF008 AC#1): role assignment is Administrador-only.
  //
  // requirePermission('createUser') is the ONLY gate on the three routes that
  // can grant a role, and rbac-catalog-seed grants 'createUser' to the seeded
  // Coordenador as its first permission. Nothing in requirePermission, in the
  // handlers, or in rbac-assignment.service checked the CALLER's level against
  // the level being granted -- so every Coordenador in a default-seeded
  // deployment could make anyone, including themselves, an Administrador.
  //
  // RF003 (requisitos-index.md:37-50) names Administrador as the actor for
  // "gerenciar ... seus papéis" and AC#3 "Atribuir papel com vigência e escopo
  // institucional". RNF008 AC#1 is deny-by-default and AC#4 says the frontend
  // guard does not substitute for backend validation -- which is what
  // App.tsx's requiredRole was doing alone.
  //
  // The gate follows this repo's own precedent: the in-handler
  // isAdministrator(db, req.user.userID) check that POST /:id/disable-mfa
  // already uses, rather than a new permission code.
  describe('#998: only an Administrador may assign a role', () => {
    function callerCoordenador() {
      return { userID: '507f1f77bcf86cd799439013', accessType: 3, roleName: 'Coordenador' };
    }

    // Arrange block lifted from the #982 PUT test above rather than written
    // fresh: a thinner targetUser fails UserModel.validate and the route
    // answers 422 before it ever reaches the role logic, which reads as a
    // reproduction while measuring nothing.
    function seedTarget(id) {
      const targetUser = {
        _id: id,
        name: 'Alvo 998',
        email: 'alvo-998@bioavanced.com.br',
        username: 'alvo998',
        status: 'active',
        accessType: 2,
        roleName: 'Técnico',
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce(targetUser);
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      return targetUser;
    }

    function dbWith(callers) {
      const rbacCollections = buildRbacCollections(callers);
      return {
        collection: vi.fn((name) => {
          if (name === 'users') return usersCollection;
          if (rbacCollections[name]) return rbacCollections[name];
          return db.collection(name);
        }),
      };
    }

    it('refuses a Coordenador promoting a target to Administrador through PUT /:id', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998');

      const req = createRequest({
        params: { id: 'user-target-998' },
        body: { roleName: 'Administrador' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-998', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      // The role must not have been granted, not merely the response changed.
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('refuses a Coordenador creating an Administrador through POST /register', async () => {
      const handler = getHandler(userRoutes, 'post', '/register');

      const req = createRequest({
        body: { name: 'Novo', email: 'novo@b.c', username: 'novo', password: 'Str0ng!Pass-forte', roleName: 'Administrador' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([{ userAccountId: '507f1f77bcf86cd799439013', accessType: 3 }]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      // #1017: was `authServiceMock.registerUser`, which passed vacuously --
      // that mock was never installed, so the assertion held no matter what
      // the route did. Now a real spy on the module the route actually calls.
      //
      // #1057: the floor moved INTO registerUser, so the service is now
      // reached and refuses from inside. What has to hold is that no user
      // was written: the refusal comes before the insert.
      expect(registerUserSpy).toHaveBeenCalledTimes(1);
      expect(usersCollection.insertOne).not.toHaveBeenCalled();
    });

    // The negative halves. Without these the pair above cannot distinguish a
    // working caller check from a gate that refuses every role assignment, or
    // from one that refuses every PUT.
    it('still allows an Administrador to promote a target to Administrador', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998b');

      const req = createRequest({
        params: { id: 'user-target-998b' },
        body: { roleName: 'Administrador' },
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
        { userAccountId: 'user-target-998b', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
    });

    // What separated the #998 floor from an Administrador-only gate. This
    // comment said "if direction 2 later lands, this test is the one that
    // must flip", and #1008 (Denise, 2026-09-25) landed it: assigning a role
    // needs assignRole, seeded on the Administrador only. So a Coordenador is
    // now refused even at or below their own level, and nothing is written.
    it('#1008: refuses a Coordenador assigning a level even at or below their own', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998d');

      const req = createRequest({
        params: { id: 'user-target-998d' },
        body: { roleName: 'Coordenador' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-998d', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.payload.message).toMatch(/Administrador/);
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('still allows a Coordenador to edit a user without touching their role', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-998c');

      const req = createRequest({
        params: { id: 'user-target-998c' },
        body: { name: 'Alvo Renomeado' },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-998c', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(usersCollection.updateOne).toHaveBeenCalled();
    });

    // #1008: NewUserPage echoes the whole user back on every save, role and
    // validity dates included. The gate counts a CHANGE, so this plain rename
    // carrying the unchanged role, dates and auditor flag must still pass.
    // Without it the refusals below cannot tell a change check from a
    // presence check.
    it('#1008 CONTROL: a Coordenador rename echoing the unchanged role and validity back still succeeds', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      const target = seedTarget('user-target-1008a');
      target.roleValidUntil = new Date('2031-01-01T00:00:00.000Z');

      const req = createRequest({
        params: { id: 'user-target-1008a' },
        body: {
          name: 'Alvo Renomeado',
          roleName: 'Técnico',
          roleValidUntil: '2031-01-01T00:00:00.000Z',
          auditorRole: false,
        },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-1008a', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(usersCollection.updateOne).toHaveBeenCalled();
    });

    // middleware/auth.js enforces roleValidUntil, so re-dating a role is role
    // assignment (RF003 AC#3, "atribuir papel com vigência"). Pulling it into
    // the past would lock the target out.
    it('#1008: refuses a Coordenador changing the validity window of a role', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-1008b');

      const req = createRequest({
        params: { id: 'user-target-1008b' },
        body: { roleValidUntil: new Date(Date.now() - 1000).toISOString() },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-1008b', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('#1008: refuses a Coordenador granting the additive auditor role', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-1008c');

      const req = createRequest({
        params: { id: 'user-target-1008c' },
        body: { auditorRole: true },
        user: callerCoordenador(),
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439013', accessType: 3 },
        { userAccountId: 'user-target-1008c', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('#1008 CONTROL: an Administrador may change the validity window of a role', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTarget('user-target-1008d');

      const req = createRequest({
        params: { id: 'user-target-1008d' },
        body: { roleValidUntil: new Date(Date.now() + 3600 * 1000).toISOString() },
      });
      req.app.locals.db = dbWith([
        { userAccountId: '507f1f77bcf86cd799439011', accessType: 4 },
        { userAccountId: 'user-target-1008d', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(usersCollection.updateOne).toHaveBeenCalled();
    });
  });

  // #1008: the #998 floor covered granting above your own level, not
  // DELETING a user above it, so a Coordenador could delete an Administrador.
  describe('#1008: DELETE /:id hierarchy floor', () => {
    const COORD = { userID: '507f1f77bcf86cd799439013', accessType: 3, roleName: 'Coordenador' };

    function dbWithUsers(callers) {
      const rbacCollections = buildRbacCollections(callers);
      return {
        collection: vi.fn((name) => {
          if (name === 'users') return usersCollection;
          if (rbacCollections[name]) return rbacCollections[name];
          return db.collection(name);
        }),
      };
    }

    it('refuses a Coordenador deleting an Administrador, without deleting', async () => {
      const handler = getHandler(userRoutes, 'delete', '/:id');
      usersCollection.findOne.mockResolvedValueOnce({ _id: 'admin-target-1008', username: 'adm' });

      const req = createRequest({ params: { id: 'admin-target-1008' }, user: COORD });
      req.app.locals.db = dbWithUsers([
        { userAccountId: COORD.userID, accessType: 3 },
        { userAccountId: 'admin-target-1008', accessType: 4 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(403);
      expect(usersCollection.deleteOne).not.toHaveBeenCalled();
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
    });

    it('CONTROL: a Coordenador may still delete a user at or below their level', async () => {
      const handler = getHandler(userRoutes, 'delete', '/:id');
      usersCollection.findOne.mockResolvedValueOnce({ _id: 'tec-target-1008', username: 'tec' });
      usersCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1 });

      const req = createRequest({ params: { id: 'tec-target-1008' }, user: COORD });
      req.app.locals.db = dbWithUsers([
        { userAccountId: COORD.userID, accessType: 3 },
        { userAccountId: 'tec-target-1008', accessType: 2 },
      ]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      // #1306 (RF003 AC4, RNF022 C5): the delete is logical -- the account is
      // inactivated, never removed, and its sessions are revoked.
      expect(usersCollection.deleteOne).not.toHaveBeenCalled();
      // #1330: stored as accountStatus; the legacy status is removed.
      expect(usersCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'tec-target-1008' },
        { $set: expect.objectContaining({ accountStatus: 'inactive' }), $unset: { status: '' } }
      );
      expect(sessionsCollection.updateMany).toHaveBeenCalledWith(
        { $or: [{ userAccountId: 'tec-target-1008' }, { userID: 'tec-target-1008' }], isActive: true },
        expect.objectContaining({ $set: expect.objectContaining({ revocationReason: 'admin_action', revokedBy: COORD.userID }) })
      );
    });

    it('CONTROL: a missing target still answers 404', async () => {
      const handler = getHandler(userRoutes, 'delete', '/:id');
      usersCollection.findOne.mockResolvedValueOnce(null);

      const req = createRequest({ params: { id: 'nobody-1008' }, user: COORD });
      req.app.locals.db = dbWithUsers([{ userAccountId: COORD.userID, accessType: 3 }]);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(404);
      expect(usersCollection.updateOne).not.toHaveBeenCalled();
      expect(sessionsCollection.updateMany).not.toHaveBeenCalled();
    });
  });

  // #1009: the promotion guard compared `requestedAccessType` against
  // `targetUser.accessType` -- a field #427/#432 dropped from the User
  // document. It is `undefined` on every real user, so the comparison
  // degenerated to Boolean(requestedAccessType) and fired changeUserRole (a
  // revoke + re-grant pair, attributed to the editing admin) on every edit
  // that merely carried roleName back unchanged -- which NewUserPage does on
  // every save, since it seeds its form with {...editingUser}.
  //
  // The target fixture below deliberately OMITS `accessType`, unlike every
  // other block in this file. Supplying it is precisely what made the
  // existing tests unable to see this: the mock hands the route the field
  // whose absence IS the bug (same shape as #994's getMongo).
  describe('#1009: changeUserRole fires only on a real level change', () => {
    const CALLER_ID = '507f1f77bcf86cd799439011';

    function seedTargetWithoutAccessType(id) {
      // Lifted from #998's seedTarget so a thin document cannot fail
      // UserModel.validate and answer 422 before reaching the role logic --
      // minus the one field under test.
      const targetUser = {
        _id: id,
        name: 'Alvo 1009',
        email: 'alvo-1009@bioavanced.com.br',
        username: 'alvo1009',
        status: 'active',
        roleName: 'Técnico',
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce(targetUser);
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      return targetUser;
    }

    function assignmentsFor(targetId) {
      return [
        { assignmentId: 'assign-caller-1009', userAccountId: CALLER_ID, roleId: 'role-administrator', assignmentStatus: 'active', validUntil: null },
        { assignmentId: 'assign-target-1009', userAccountId: targetId, roleId: 'role-technician', assignmentStatus: 'active', validUntil: null },
      ];
    }

    function dbWithAssignments(assignmentDocs) {
      const rbacCollections = buildRbacCollections([]);
      const assignmentsMock = queryableAssignmentsMock(assignmentDocs);
      return {
        collection: vi.fn((name) => {
          if (name === 'users') return usersCollection;
          if (name === 'roles') return rbacCollections.roles;
          if (name === 'permissions') return rbacCollections.permissions;
          if (name === 'userRoleAssignments') return assignmentsMock;
          return db.collection(name);
        }),
      };
    }

    it('#1009: an edit that carries the SAME roleName back does not revoke or re-grant the assignment', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTargetWithoutAccessType('user-target-1009a');
      const assignmentDocs = assignmentsFor('user-target-1009a');

      const req = createRequest({
        params: { id: 'user-target-1009a' },
        body: { name: 'Renomeado', roleName: 'Técnico' },
      });
      req.app.locals.db = dbWithAssignments(assignmentDocs);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      // No spurious revoke + grant pair: the same assignment, untouched.
      expect(assignmentDocs).toHaveLength(2);
      const targetAssignment = assignmentDocs.find((d) => d.userAccountId === 'user-target-1009a');
      expect(targetAssignment.assignmentId).toBe('assign-target-1009');
      expect(targetAssignment.assignmentStatus).toBe('active');
      expect(targetAssignment.revokedBy).toBeUndefined();
      expect(targetAssignment.revocationReason).toBeUndefined();
      // #1017: this is the assertion the NOTE here used to say could not be
      // written. It can now -- the spy is on the CJS module object the lazily
      // required auditLogger resolves to. A plain rename is an UPDATE, not a
      // permission change, and nothing else in this suite distinguishes them.
      expect(auditSpies.logPermissionChange).not.toHaveBeenCalled();
      expect(auditSpies.logUpdate).toHaveBeenCalled();
    });

    it('#1009: an org-only edit on a target holding a role still re-scopes without revoking', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      const targetUser = {
        _id: 'user-target-1009d',
        name: 'Alvo 1009 Org',
        email: 'alvo-1009d@bioavanced.com.br',
        username: 'alvo1009d',
        status: 'active',
        organizationId: 'org-old',
      };
      usersCollection.findOne
        .mockResolvedValueOnce(targetUser)
        .mockResolvedValueOnce({ ...targetUser, organizationId: 'org-new' });
      usersCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      const assignmentDocs = assignmentsFor('user-target-1009d');
      assignmentDocs[1].scopeType = 'organization';
      assignmentDocs[1].scopeId = 'org-old';

      const req = createRequest({
        params: { id: 'user-target-1009d' },
        body: { organizationId: 'org-new', roleName: 'Técnico' },
      });
      req.app.locals.db = dbWithAssignments(assignmentDocs);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      // The issue body called this the trap: it feared tightening the guard
      // would stop org re-scoping. It does not -- updateAssignmentScope runs
      // unconditionally on any real organizationId change and never consulted
      // the guard. Before the fix this case ALSO fired changeUserRole, so the
      // scope landed on a brand-new assignment instead of the existing one.
      expect(assignmentDocs).toHaveLength(2);
      const targetAssignment = assignmentDocs.find((d) => d.userAccountId === 'user-target-1009d');
      expect(targetAssignment.assignmentId).toBe('assign-target-1009');
      expect(targetAssignment.assignmentStatus).toBe('active');
      expect(targetAssignment.scopeId).toBe('org-new');
    });

    // Control: expected behaviour is IDENTICAL before and after the fix, so
    // this must be green in the pre-fix run. A red one here would mean the
    // fixture is wrong (a 422 from UserModel.validate, or a missing caller
    // assignment tripping #998's floor) rather than the bug reproducing.
    it('#1009 control: a real level change still revokes the old assignment and grants the new one', async () => {
      const handler = getHandler(userRoutes, 'put', '/:id');
      seedTargetWithoutAccessType('user-target-1009c');
      const assignmentDocs = assignmentsFor('user-target-1009c');

      const req = createRequest({
        params: { id: 'user-target-1009c' },
        body: { roleName: 'Coordenador' },
      });
      req.app.locals.db = dbWithAssignments(assignmentDocs);
      const res = createResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const old = assignmentDocs.find((d) => d.assignmentId === 'assign-target-1009');
      expect(old.assignmentStatus).toBe('revoked');
      expect(old.revocationReason).toBe('role_changed');
      const granted = assignmentDocs.filter(
        (d) => d.userAccountId === 'user-target-1009c' && d.assignmentStatus === 'active'
      );
      expect(granted).toHaveLength(1);
      expect(granted[0].roleId).toBe('role-coordinator');

      // #1017 / #1009: `changes` is observable ONLY through logPermissionChange,
      // so this is the half of dca21428 that shipped unpinned. That fix changed
      // the comparison from the raw `targetUser.accessType` to the RESOLVED
      // level, and this target is seeded deliberately WITHOUT an accessType
      // field -- so pre-fix the row read { from: undefined, to: 3 } and post-fix
      // it reads { from: 2, to: 3 }, resolved from the role-technician
      // assignment. Nothing in this suite could tell those apart until now.
      expect(auditSpies.logPermissionChange).toHaveBeenCalledWith(
        expect.anything(),
        'user-target-1009c',
        expect.objectContaining({ accessType: { from: 2, to: 3 } })
      );
    });

    // #1240: the user form seeds itself from the list row and echoes every
    // field back, so the list has to say who holds `auditor`, and an echoed
    // flag equal to the current state is not a permission change -- the same
    // trap #1009 closed for roleName.
    describe('#1240: auditorRole is readable, and an echoed flag is not a change', () => {
      function auditorAssignmentsFor(targetId) {
        return [
          ...assignmentsFor(targetId),
          { assignmentId: 'assign-auditor-1240', userAccountId: targetId, roleId: 'role-auditor', assignmentStatus: 'active', validUntil: null },
        ];
      }

      it('GET /api/users reports auditorRole for each user', async () => {
        const handler = getHandler(userRoutes, 'get', '/');
        usersCollection.find.mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { _id: 'user-1240-holder', name: 'Holder', username: 'holder', status: 'active' },
            { _id: 'user-1240-plain', name: 'Plain', username: 'plain', status: 'active' },
          ]),
        });
        const assignmentDocs = [
          ...auditorAssignmentsFor('user-1240-holder'),
          { assignmentId: 'assign-plain-1240', userAccountId: 'user-1240-plain', roleId: 'role-technician', assignmentStatus: 'active', validUntil: null },
        ];
        const req = createRequest();
        req.app.locals.db = dbWithAssignments(assignmentDocs);
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        const byId = Object.fromEntries(res.payload.data.map((u) => [u.id, u]));
        expect(byId['user-1240-holder'].auditorRole).toBe(true);
        expect(byId['user-1240-plain'].auditorRole).toBe(false);
      });

      it('GET /api/users/:id reports auditorRole', async () => {
        const handler = getHandler(userRoutes, 'get', '/:id');
        usersCollection.findOne.mockResolvedValue({ _id: 'user-1240-one', name: 'One', username: 'one', status: 'active' });
        const req = createRequest({ params: { id: 'user-1240-one' } });
        req.app.locals.db = dbWithAssignments(auditorAssignmentsFor('user-1240-one'));
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.payload.data.auditorRole).toBe(true);
      });

      it('a rename echoing auditorRole=true for a holder writes no permission change', async () => {
        const handler = getHandler(userRoutes, 'put', '/:id');
        seedTargetWithoutAccessType('user-target-1240a');
        const assignmentDocs = auditorAssignmentsFor('user-target-1240a');

        const req = createRequest({
          params: { id: 'user-target-1240a' },
          body: { name: 'Renomeado', roleName: 'Técnico', auditorRole: true },
        });
        req.app.locals.db = dbWithAssignments(assignmentDocs);
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(assignmentDocs).toHaveLength(3);
        const auditor = assignmentDocs.find((d) => d.assignmentId === 'assign-auditor-1240');
        expect(auditor.assignmentStatus).toBe('active');
        expect(auditSpies.logPermissionChange).not.toHaveBeenCalled();
        expect(auditSpies.logUpdate).toHaveBeenCalled();
        expect(res.payload.data.auditorRole).toBe(true);
      });

      // changeUserRole revokes EVERY active assignment, auditor included, so
      // a level change that echoes auditorRole=true must re-grant it -- and
      // the audit row must not claim the auditor flag changed.
      it('a level change echoing auditorRole=true keeps the holder an auditor and logs only the level', async () => {
        const handler = getHandler(userRoutes, 'put', '/:id');
        seedTargetWithoutAccessType('user-target-1240b');
        const assignmentDocs = auditorAssignmentsFor('user-target-1240b');

        const req = createRequest({
          params: { id: 'user-target-1240b' },
          body: { roleName: 'Coordenador', auditorRole: true },
        });
        req.app.locals.db = dbWithAssignments(assignmentDocs);
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        const active = assignmentDocs
          .filter((d) => d.userAccountId === 'user-target-1240b' && d.assignmentStatus === 'active')
          .map((d) => d.roleId)
          .sort();
        expect(active).toEqual(['role-auditor', 'role-coordinator']);
        expect(auditSpies.logPermissionChange).toHaveBeenCalledTimes(1);
        const changes = auditSpies.logPermissionChange.mock.calls[0][2];
        expect(changes.accessType).toEqual({ from: 2, to: 3 });
        expect(changes).not.toHaveProperty('auditorRole');
      });

      // Control: identical before and after the fix.
      it('control: granting auditorRole to a non-holder grants it and logs the change', async () => {
        const handler = getHandler(userRoutes, 'put', '/:id');
        seedTargetWithoutAccessType('user-target-1240c');
        const assignmentDocs = assignmentsFor('user-target-1240c');

        const req = createRequest({
          params: { id: 'user-target-1240c' },
          body: { roleName: 'Técnico', auditorRole: true },
        });
        req.app.locals.db = dbWithAssignments(assignmentDocs);
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(assignmentDocs.some((d) => d.userAccountId === 'user-target-1240c' && d.roleId === 'role-auditor' && d.assignmentStatus === 'active')).toBe(true);
        expect(auditSpies.logPermissionChange).toHaveBeenCalledWith(
          expect.anything(),
          'user-target-1240c',
          expect.objectContaining({ auditorRole: true })
        );
      });
    });
  });
});
