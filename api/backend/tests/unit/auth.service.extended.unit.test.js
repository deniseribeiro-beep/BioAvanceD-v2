import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { buildRbacCollections, buildMutableRbacCollections } = require('../factories/rbac.factory');

const authService = require('../../src/services/auth.service');

afterEach(() => { vi.restoreAllMocks(); });

describe('AuthService.registerUser', () => {
  function makeDb(overrides = {}, rbacUsers = []) {
    // #421: registerUser grants a UserRoleAssignment atomically via
    // grantRoleForAccessType, which needs the Role catalog to already
    // exist — buildRbacCollections() seeds the full legacy catalog.
    // #1057: rbacUsers seeds the CALLER's own assignment for the floor.
    const rbacCollections = buildRbacCollections(rbacUsers);
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(null), // no existing user
      insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
      ...overrides,
    };
    return {
      collection: vi.fn((name) => rbacCollections[name] || usersCollection),
    };
  }

  const VALID_USER = {
    name: 'Test User',
    email: 'test@example.com',
    username: 'testuser',
    password: 'SecurePass123!',
    accessType: 2,
  };

  it('throws when required fields are missing', async () => {
    const db = makeDb();
    await expect(authService.registerUser(db, {}, 'system')).rejects.toThrow();
  });

  it('throws when user already exists', async () => {
    const db = makeDb({
      findOne: vi.fn().mockResolvedValue({ _id: 'existing', email: 'test@example.com' }),
    });
    await expect(authService.registerUser(db, VALID_USER, 'system')).rejects.toThrow('cadastrado');
  });

  it('creates a new user and returns anonId', async () => {
    const db = makeDb();
    const result = await authService.registerUser(db, VALID_USER, 'system');
    expect(result).toBeDefined();
    expect(result.anonId).toBeTruthy();
    expect(result.password).toBeUndefined();
  });

  it('maps roleName to accessType when accessType not provided', async () => {
    const db = makeDb();
    const userData = { ...VALID_USER, roleName: 'Coordenador' };
    delete userData.accessType;
    const result = await authService.registerUser(db, userData, 'system');
    expect(result).toBeDefined();
  });

  it('sets mfaEnabled false for Administrador by default', async () => {
    const db = makeDb();
    const result = await authService.registerUser(db, { ...VALID_USER, accessType: 4, roleName: 'Administrador' }, 'system');
    expect(result.mfaEnabled).toBe(false);
  });

  it('adds roleName to user when not provided', async () => {
    const db = makeDb();
    const result = await authService.registerUser(db, { ...VALID_USER, accessType: 3 }, 'system');
    expect(result.roleName).toBeTruthy();
  });

  // #427: accessType/roleName no longer persisted on the User document —
  // only used transiently to grant the matching UserRoleAssignment (#421).
  it('does not persist accessType/roleName on the inserted user document', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
    const db = makeDb({ insertOne });

    await authService.registerUser(db, { ...VALID_USER, accessType: 4, roleName: 'Administrador' }, 'system');

    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = insertOne.mock.calls[0][0];
    expect(inserted).not.toHaveProperty('accessType');
    expect(inserted).not.toHaveProperty('roleName');
  });

  // #435: an invalid accessType must be rejected before any write — the
  // old UserModel.isValidAccessType check (retired in #432) used to catch
  // this in UserModel.validate(); grantRoleForAccessType's own lookup
  // still rejects it, but only after insertOne had already run, orphaning
  // a User document with no role assignment.
  it('rejects an invalid accessType before inserting the user', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
    const db = makeDb({ insertOne });

    await expect(
      authService.registerUser(db, { ...VALID_USER, accessType: 99 }, 'system')
    ).rejects.toThrow();

    expect(insertOne).not.toHaveBeenCalled();
  });

  // #1028: #435 closed the accessType trigger above and left the WINDOW open.
  // Two throw sites inside grantRoleForAccessType are still reachable after
  // insertOne, and this is the one an UNAUTHENTICATED caller can reach:
  // #1037's rejectCallerSuppliedPrivilege filters only accessType and
  // roleName -- organizationId passes through untouched, and User.js only
  // trims it. So a bogus organizationId inserts the user, then throws in
  // validateOrganizationId, leaving an orphan able to authenticate with every
  // permission check returning false and nothing explaining why.
  //
  // NOTE, updated when #1037 was resolved: this comment used to say the
  // orphan window was reachable ANONYMOUSLY, because auth.routes.js
  // registered POST /api/auth/register with no `authenticate`. #1037 gated
  // that route and #1057 deleted it. The window itself is unchanged and this
  // test still pins it; only its reachability narrowed, from any anonymous
  // caller to a holder of createUser on POST /api/users/register.
  //
  // The fixture reaches it because buildRbacCollections() seeds no
  // `organizations` collection, so makeDb falls through to usersCollection,
  // whose findOne resolves null.
  it('rejects an unknown organizationId before inserting the user (#1028)', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
    const db = makeDb({ insertOne });

    await expect(
      authService.registerUser(db, { ...VALID_USER, organizationId: 'org-inexistente' }, 'system')
    ).rejects.toThrow(/organizationId/);

    expect(insertOne).not.toHaveBeenCalled();
  });

  // #1028: the OTHER remaining throw site -- an unseeded RBAC catalogue.
  // buildMutableRbacCollections() seeds `roles: []`, and its own docstring
  // names registerUser as an intended consumer; the fixture existed and the
  // test did not.
  it('rejects an unseeded RBAC catalogue before inserting the user (#1028)', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
    const emptyRbac = buildMutableRbacCollections();
    const usersCollection = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne,
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
    };
    const db = { collection: vi.fn((name) => emptyRbac[name] || usersCollection) };

    await expect(
      authService.registerUser(db, { ...VALID_USER }, 'system')
    ).rejects.toThrow(/Role não encontrado/);

    expect(insertOne).not.toHaveBeenCalled();
  });

  // CONTROL: the happy path must stay green before AND after the fix (#695).
  // If this reds, the new pre-write guard is rejecting a VALID registration,
  // which is the one way this change could break user creation outright.
  it('CONTROL: still creates a user with no organizationId at all', async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
    const db = makeDb({ insertOne });

    const result = await authService.registerUser(db, VALID_USER, 'system');

    expect(result.anonId).toBeTruthy();
    expect(insertOne).toHaveBeenCalled();
  });

  // #1057 (Denise, 2026-09-25): #998's hierarchy floor moved from
  // user.routes.js into registerUser, so no route reaching the service can
  // drift from it again, which is what #1037 was.
  describe('#1057: hierarchy floor inside registerUser', () => {
    it('refuses a missing grantedBy before any read or write -- no silent fall-through to system', async () => {
      const insertOne = vi.fn();
      const db = makeDb({ insertOne });

      await expect(authService.registerUser(db, VALID_USER)).rejects.toThrow(/requires grantedBy/);
      await expect(authService.registerUser(db, VALID_USER, undefined)).rejects.toThrow(/requires grantedBy/);
      expect(insertOne).not.toHaveBeenCalled();
      expect(db.collection).not.toHaveBeenCalled();
    });

    it('refuses a Coordenador creating an Administrador, with statusCode 403 and no insert', async () => {
      const insertOne = vi.fn();
      const db = makeDb({ insertOne }, [{ userAccountId: 'coord-1', accessType: 3 }]);

      const error = await authService.registerUser(db, { ...VALID_USER, accessType: 4 }, 'coord-1').catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(403);
      expect(error.message).toMatch(/superior ao seu/);
      expect(insertOne).not.toHaveBeenCalled();
    });

    it('measures the RESOLVED level, so a roleName is held to the floor as well as an accessType', async () => {
      const insertOne = vi.fn();
      const db = makeDb({ insertOne }, [{ userAccountId: 'coord-1', accessType: 3 }]);
      const { accessType: _omit, ...noAccessType } = VALID_USER;

      const error = await authService.registerUser(db, { ...noAccessType, roleName: 'Administrador' }, 'coord-1').catch((e) => e);

      expect(error.statusCode).toBe(403);
      expect(insertOne).not.toHaveBeenCalled();
    });

    it('refuses a caller with no active role at all -- a null level is not a pass', async () => {
      const insertOne = vi.fn();
      const db = makeDb({ insertOne }, []);

      const error = await authService.registerUser(db, VALID_USER, 'nobody-1').catch((e) => e);

      expect(error.statusCode).toBe(403);
      expect(insertOne).not.toHaveBeenCalled();
    });

    it('CONTROL: allows a Coordenador to create at or below their own level', async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
      const db = makeDb({ insertOne }, [{ userAccountId: 'coord-1', accessType: 3 }]);

      await authService.registerUser(db, { ...VALID_USER, accessType: 3 }, 'coord-1');

      expect(insertOne).toHaveBeenCalledTimes(1);
    });

    it("CONTROL: 'system' is exempt, for a trusted internal caller with no level of its own", async () => {
      const insertOne = vi.fn().mockResolvedValue({ insertedId: { toString: () => 'new-user-id' } });
      const db = makeDb({ insertOne }, []);

      await authService.registerUser(db, { ...VALID_USER, accessType: 4 }, 'system');

      expect(insertOne).toHaveBeenCalledTimes(1);
    });
  });
});

describe('AuthService.login', () => {
  function makeDb(user = null) {
    return {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(user),
        find: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        insertOne: vi.fn().mockResolvedValue({ insertedId: { toString: () => 'sess-id' } }),
      }),
    };
  }

  it('throws when email is missing', async () => {
    const db = makeDb();
    await expect(authService.login(db, { password: 'abc' }, {})).rejects.toThrow();
  });

  it('throws when password is missing', async () => {
    const db = makeDb();
    await expect(authService.login(db, { email: 'test@test.com' }, {})).rejects.toThrow();
  });

  it('throws Credenciais inválidas when user not found', async () => {
    const db = makeDb(null); // no user found
    await expect(authService.login(db, { email: 'noone@test.com', password: 'pass' }, {})).rejects.toThrow('Credenciais');
  });
});
