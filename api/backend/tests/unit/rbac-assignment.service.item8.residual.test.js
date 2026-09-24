import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  resolveUserHierarchyLevel,
  getActiveRoleCodes,
  findUserAccountIdsByRoleCodes,
  grantRoleForAccessType,
  changeUserRole,
  grantAdditionalRole,
  revokeAdditionalRole,
} = require('../../src/services/rbac-assignment.service');
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440001';

function matches(doc, query = {}) {
  return Object.entries(query).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && '$in' in condition) {
      return condition.$in.includes(doc[key]);
    }
    return doc[key] === condition;
  });
}

function buildDb({ roles = [], assignments = [], organizations = [] } = {}) {
  const rolesCollection = {
    findOne: async (query = {}) => roles.find((doc) => matches(doc, query)) || null,
    find: (query = {}) => ({
      toArray: async () => roles.filter((doc) => matches(doc, query)),
    }),
  };
  const assignmentsCollection = {
    findOne: async (query = {}) => assignments.find((doc) => matches(doc, query)) || null,
    find: (query = {}) => ({
      toArray: async () => assignments.filter((doc) => matches(doc, query)),
    }),
    insertOne: async (doc) => {
      assignments.push(doc);
      return { insertedId: doc.assignmentId };
    },
    updateOne: async (query, update) => {
      const doc = assignments.find((item) => matches(item, query));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
    },
  };
  const organizationsCollection = {
    findOne: async (query = {}) => organizations.find((doc) => matches(doc, query)) || null,
  };

  return {
    collection(name) {
      if (name === 'roles') return rolesCollection;
      if (name === 'userRoleAssignments') return assignmentsCollection;
      if (name === 'organizations') return organizationsCollection;
      if (name === 'actors') return { findOne: async ({ actorId }) => actorId === ACTOR_ID ? { actorId } : null };
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

const roles = [
  {
    roleId: 'role-tech',
    roleCode: 'technician',
    hierarchyLevel: 2,
    roleStatus: 'active',
    permissionIds: [],
  },
  {
    roleId: 'role-coord',
    roleCode: 'coordinator',
    hierarchyLevel: 3,
    roleStatus: 'active',
    permissionIds: [],
  },
  {
    roleId: 'role-auditor',
    roleCode: 'auditor',
    hierarchyLevel: null,
    roleStatus: 'active',
    permissionIds: [],
  },
];

describe('rbac-assignment.service item 8 residual branches', () => {
  it('maps an active role without hierarchyLevel to hierarchy zero', async () => {
    const assignments = [{
      assignmentId: 'a-auditor',
      userAccountId: 'u-auditor',
      roleId: 'role-auditor',
      assignmentStatus: 'active',
      validUntil: null,
    }];

    const level = await resolveUserHierarchyLevel(buildDb({ roles, assignments }), 'u-auditor');

    expect(level).toBe(0);
  });

  it('excludes expired assignments from active role-code resolution', async () => {
    const assignments = [
      {
        assignmentId: 'a-expired',
        userAccountId: 'u1',
        roleId: 'role-coord',
        assignmentStatus: 'active',
        validUntil: new Date(Date.now() - 60_000),
      },
      {
        assignmentId: 'a-active',
        userAccountId: 'u1',
        roleId: 'role-tech',
        assignmentStatus: 'active',
        validUntil: new Date(Date.now() + 60_000),
      },
    ];

    const codes = await getActiveRoleCodes(buildDb({ roles, assignments }), 'u1');

    expect(codes).toEqual(['technician']);
  });

  it('excludes expired assignments when resolving notification-style recipients by role code', async () => {
    const assignments = [
      {
        assignmentId: 'a-expired-tech',
        userAccountId: 'tech-expired',
        roleId: 'role-tech',
        assignmentStatus: 'active',
        validUntil: new Date(Date.now() - 60_000),
      },
      {
        assignmentId: 'a-active-tech',
        userAccountId: 'tech-active',
        roleId: 'role-tech',
        assignmentStatus: 'active',
        validUntil: new Date(Date.now() + 60_000),
      },
    ];

    const ids = await findUserAccountIdsByRoleCodes(
      buildDb({ roles, assignments }),
      ['technician']
    );

    expect(ids).toEqual(['tech-active']);
  });

  it('uses a resolved Actor and normalizes blank organizationId to null', async () => {
    const assignments = [];
    const doc = await grantRoleForAccessType(
      buildDb({ roles, assignments }),
      {
        userAccountId: 'u-default',
        accessType: 3,
        organizationId: '   ',
        grantedBy: ACTOR_ID,
      }
    );

    expect(doc.grantedBy).toBe(ACTOR_ID);
    expect(doc.scopeType).toBe('organization');
    expect(doc.scopeId).toBeNull();
  });

  it('attributes role change and replacement grant to the same resolved Actor', async () => {
    const assignments = [{
      assignmentId: 'a-old',
      userAccountId: 'u-change',
      roleId: 'role-tech',
      assignmentStatus: 'active',
      validUntil: null,
    }];
    const db = buildDb({ roles, assignments });

    const replacement = await changeUserRole(db, {
      userAccountId: 'u-change',
      accessType: 3,
      changedBy: ACTOR_ID,
    });

    expect(assignments.find((item) => item.assignmentId === 'a-old').revokedBy).toBe(ACTOR_ID);
    expect(replacement.grantedBy).toBe(ACTOR_ID);
  });

  it('attributes additive-role changes to Actor and preserves unknown-role no-op', async () => {
    const assignments = [];
    const db = buildDb({ roles, assignments });

    const added = await grantAdditionalRole(db, {
      userAccountId: 'u-additive',
      roleCode: 'auditor',
      grantedBy: ACTOR_ID,
    });
    expect(added.grantedBy).toBe(ACTOR_ID);

    const missing = await revokeAdditionalRole(db, {
      userAccountId: 'u-additive',
      roleCode: 'unknown-role',
    });
    expect(missing).toEqual([]);

    await revokeAdditionalRole(db, {
      userAccountId: 'u-additive',
      roleCode: 'auditor',
      revokedBy: ACTOR_ID,
    });
    expect(assignments.find((item) => item.assignmentId === added.assignmentId).revokedBy).toBe(ACTOR_ID);
  });

  it('refuses a system string as a grant Actor reference', async () => {
    const assignments = [];
    await expect(grantRoleForAccessType(buildDb({ roles, assignments }), {
      userAccountId: 'u-default', accessType: 3, grantedBy: 'system',
    })).rejects.toThrow(/actorId UUID/);
    expect(assignments).toEqual([]);
  });
});
