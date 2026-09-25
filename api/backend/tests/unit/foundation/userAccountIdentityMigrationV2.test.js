import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const migration = require('../../../src/foundation/userAccountIdentityMigrationV2');

const oldId = '507f1f77bcf86cd799439011';
const actorId = '550e8400-e29b-41d4-a716-446655440001';

function fakeDb(initial) {
  const tables = new Map(Object.entries(initial).map(([name, rows]) => [name, structuredClone(rows)]));
  const updateOne = vi.fn(async (name, query, update) => {
    const row = (tables.get(name) || []).find((item) =>
      String(item._id) === String(query._id) &&
      (!Object.hasOwn(query, 'userAccountId') || item.userAccountId == null));
    if (!row) return { matchedCount: 0 };
    Object.assign(row, update.$set);
    return { matchedCount: 1 };
  });
  return {
    tables,
    updateOne,
    db: {
      listCollections: () => ({ toArray: async () => [...tables.keys()].map((name) => ({ name })) }),
      collection: (name) => ({
        find: () => ({ toArray: async () => structuredClone(tables.get(name) || []) }),
        updateOne: (query, update) => updateOne(name, query, update),
      }),
    },
  };
}

function records(overrides = {}) {
  return {
    users: [{ _id: oldId, actorId, ...overrides }],
    actors: [{ actorId }],
    userRoleAssignments: [{ _id: 'assignment', userAccountId: oldId, grantedBy: oldId }],
    accessGrants: [{ _id: 'grant', userAccountId: oldId, grantedBy: actorId }],
    sessions: [{ _id: 'session', userID: oldId, tokenHash: 'opaque', isActive: true, isRevoked: false }],
    recoveryCodeSets: [{ _id: 'recovery', userAccountId: oldId }],
  };
}

describe('UserAccount canonical identity migration', () => {
  it('inventories all four Reference(UserAccount) fields', () => {
    expect(migration.USER_REFERENCES.map(({ collection, field }) => `${collection}.${field}`)).toEqual([
      'userRoleAssignments.userAccountId', 'accessGrants.userAccountId',
      'sessions.userAccountId', 'recoveryCodeSets.userAccountId',
    ]);
  });

  it('dry-run reports missing UUID and legacy links without changing data', async () => {
    const state = fakeDb(records());
    const result = await migration.runAccountIdentityMigration(state.db, { mode: 'dry-run' });
    expect(result.plan).toMatchObject({ totalAccounts: 1, missingUuid: 1, legacyReferences: 4, wouldBlock: false });
    expect(state.updateOne).not.toHaveBeenCalled();
  });

  it('generates UUID once, migrates references, maps Actor separately, and revokes old session', async () => {
    const state = fakeDb(records());
    const first = await migration.runAccountIdentityMigration(state.db);
    const uuid = state.tables.get('users')[0].userAccountId;
    expect(migration.isUuid(uuid)).toBe(true);
    expect(uuid).not.toBe(oldId);
    expect(first.revokedLegacySessions).toBe(1);
    expect(state.tables.get('userRoleAssignments')[0]).toMatchObject({ userAccountId: uuid, grantedBy: actorId });
    expect(state.tables.get('accessGrants')[0].userAccountId).toBe(uuid);
    expect(state.tables.get('recoveryCodeSets')[0].userAccountId).toBe(uuid);
    expect(state.tables.get('sessions')[0]).toMatchObject({ userAccountId: uuid, isActive: false, isRevoked: true });
    const count = state.updateOne.mock.calls.length;
    const second = await migration.runAccountIdentityMigration(state.db);
    expect(state.tables.get('users')[0].userAccountId).toBe(uuid);
    expect(second.revokedLegacySessions).toBe(0);
    expect(state.updateOne).toHaveBeenCalledTimes(count);
  });

  it('preserves an existing valid UUID', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440002';
    const state = fakeDb(records({ userAccountId: uuid }));
    await migration.runAccountIdentityMigration(state.db);
    expect(state.tables.get('users')[0].userAccountId).toBe(uuid);
  });

  it('blocks invalid or duplicated UUIDs before writes', async () => {
    const invalid = fakeDb(records({ userAccountId: 'not-a-uuid' }));
    await expect(migration.runAccountIdentityMigration(invalid.db)).rejects.toMatchObject({ code: 'DATA_MIGRATION_CONFLICT' });
    expect(invalid.updateOne).not.toHaveBeenCalled();
    const duplicate = records({ userAccountId: '550e8400-e29b-41d4-a716-446655440002' });
    duplicate.users.push({ _id: '507f1f77bcf86cd799439012', userAccountId: duplicate.users[0].userAccountId, actorId });
    const state = fakeDb(duplicate);
    await expect(migration.runAccountIdentityMigration(state.db)).rejects.toMatchObject({ code: 'DATA_MIGRATION_CONFLICT' });
  });

  it('blocks orphan UserAccount references and unresolved Actor references without inventing links', async () => {
    const orphan = records();
    orphan.userRoleAssignments[0].userAccountId = '507f1f77bcf86cd799439099';
    const state = fakeDb(orphan);
    await expect(migration.runAccountIdentityMigration(state.db)).rejects.toMatchObject({ code: 'DATA_MIGRATION_CONFLICT' });
    expect(state.updateOne).not.toHaveBeenCalled();
    const conflated = records();
    conflated.userRoleAssignments[0].grantedBy = 'system';
    const second = fakeDb(conflated);
    await expect(migration.runAccountIdentityMigration(second.db)).rejects.toMatchObject({ code: 'DATA_MIGRATION_CONFLICT' });
    expect(second.updateOne).not.toHaveBeenCalled();
  });

  it('treats nullish legacy keys as null and flags duplicate physical account ids', () => {
    const snapshot = {
      accountCollection: 'users',
      accounts: [
        { _id: 1, actorId },
        { _id: '1', actorId },
      ],
      actors: [{ actorId }],
      references: {
        userRoleAssignments: [],
        accessGrants: [],
        sessions: [{ _id: 's1', userAccountId: null, userID: null }],
        recoveryCodeSets: [],
      },
    };
    const plan = migration.planAccountIdentity(snapshot);
    expect(plan.issues.some((item) => item.code === 'DUPLICATE_PHYSICAL_ACCOUNT_ID')).toBe(true);
    expect(plan.issues.some((item) => item.code === 'ORPHAN_USER_ACCOUNT_REFERENCE')).toBe(true);
  });

  it('backfills userAccountId from historicalField when the canonical field is null but holds a known UUID historically', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440002';
    const data = records({ userAccountId: uuid });
    data.sessions = [{ _id: 'session', userAccountId: null, userID: uuid, isActive: true, isRevoked: false }];
    data.userRoleAssignments = [];
    data.accessGrants = [];
    data.recoveryCodeSets = [];
    const state = fakeDb(data);
    const result = await migration.runAccountIdentityMigration(state.db);
    expect(result.verified).toBe(true);
    expect(state.tables.get('sessions')[0].userAccountId).toBe(uuid);
  });

  it('rejects an invalid account identity mode', async () => {
    const state = fakeDb(records());
    await expect(migration.runAccountIdentityMigration(state.db, { mode: 'force' }))
      .rejects.toThrow('Invalid account identity mode');
  });

  it('aborts when the account UUID backfill no longer matches the preflight snapshot', async () => {
    const state = fakeDb(records());
    state.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(migration.runAccountIdentityMigration(state.db)).rejects.toMatchObject({
      code: 'DATA_MIGRATION_CONFLICT',
      message: expect.stringMatching(/Account changed during identity migration/),
    });
  });

  it('aborts when a reference update no longer matches during apply', async () => {
    const state = fakeDb(records());
    state.updateOne.mockImplementation(async (name, query, update) => {
      if (Object.hasOwn(query, 'userAccountId')) {
        const row = (state.tables.get(name) || []).find((item) =>
          String(item._id) === String(query._id) && item.userAccountId == null);
        if (!row) return { matchedCount: 0 };
        Object.assign(row, update.$set);
        return { matchedCount: 1 };
      }
      return { matchedCount: 0 };
    });
    await expect(migration.runAccountIdentityMigration(state.db)).rejects.toMatchObject({
      code: 'DATA_MIGRATION_CONFLICT',
      message: expect.stringMatching(/Reference changed during account identity migration/),
    });
  });

  it('fails verification when actors disappear after reference writes', async () => {
    const state = fakeDb(records());
    state.updateOne.mockImplementation(async (name, query, update) => {
      const row = (state.tables.get(name) || []).find((item) =>
        String(item._id) === String(query._id) &&
        (!Object.hasOwn(query, 'userAccountId') || item.userAccountId == null));
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      if (name === 'sessions' && update.$set?.isRevoked) {
        state.tables.set('actors', []);
      }
      return { matchedCount: 1 };
    });
    await expect(migration.runAccountIdentityMigration(state.db)).rejects.toMatchObject({
      code: 'DATA_MIGRATION_VERIFY_FAILED',
    });
  });
});
