import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { seedRolesAndPermissions, PERMISSION_CATALOG } = require('../../../src/services/rbac-catalog-seed.service');

/**
 * Real query-matching fake (findOne exact-match, insertOne), not a canned
 * stub — proves the seed's upsert-by-business-key idempotency actually
 * depends on querying by roleCode/permissionCode, per build-loop's
 * native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matches = (doc, filter) => Object.keys(filter).every((key) => doc[key] === filter[key]);
  return {
    docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: `fake-${docs.length}` };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function createFakeDb() {
  const collections = { roles: createFakeCollection(), permissions: createFakeCollection() };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('rbac-catalog-seed.service', () => {
  it('seeds all 4 roles.min.json roles as Role documents with dict-02 roleCodes', async () => {
    const db = createFakeDb();

    const { roles } = await seedRolesAndPermissions(db);

    expect(roles).toHaveLength(5);
    expect(roles.map((r) => r.roleCode).sort()).toEqual(['administrator', 'auditor', 'coordinator', 'external_user', 'technician']);
  });

  // #429: `auditor` has no accessType slot -- it's granted additively
  // alongside a user's primary role, not in place of it.
  it('seeds the additive "auditor" role with no hierarchyLevel and the viewAuditLogs permission', async () => {
    const db = createFakeDb();

    const { roles, permissions } = await seedRolesAndPermissions(db);

    const auditor = roles.find((r) => r.roleCode === 'auditor');
    expect(auditor).toBeDefined();
    expect(auditor.hierarchyLevel).toBeNull();

    const permissionIdByCode = Object.fromEntries(permissions.map((p) => [p.permissionCode, p.permissionId]));
    expect(auditor.permissionIds).toEqual([permissionIdByCode.viewAuditLogs]);
  });

  it('seeds the union of permission codes referenced across all roles, deduplicated', async () => {
    const db = createFakeDb();

    const { permissions } = await seedRolesAndPermissions(db);

    const codes = permissions.map((p) => p.permissionCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('viewReports');
    expect(codes).toContain('manageSystem');
  });

  it('wires Role.permissionIds to the seeded Permission documents, not raw permission codes', async () => {
    const db = createFakeDb();

    const { roles, permissions } = await seedRolesAndPermissions(db);

    const permissionIdByCode = Object.fromEntries(permissions.map((p) => [p.permissionCode, p.permissionId]));
    const administrator = roles.find((r) => r.roleCode === 'administrator');

    expect(administrator.permissionIds).toContain(permissionIdByCode.manageSystem);
    expect(administrator.permissionIds).toContain(permissionIdByCode.createUser);
  });

  it('is idempotent — running twice does not duplicate or re-mint permissionIds/roleIds', async () => {
    const db = createFakeDb();

    const first = await seedRolesAndPermissions(db);
    const second = await seedRolesAndPermissions(db);

    expect(db.collections.roles.docs).toHaveLength(5);
    expect(db.collections.permissions.docs).toHaveLength(first.permissions.length);

    const firstAdminId = first.roles.find((r) => r.roleCode === 'administrator').roleId;
    const secondAdminId = second.roles.find((r) => r.roleCode === 'administrator').roleId;
    expect(secondAdminId).toBe(firstAdminId);
  });

  // RF024 (#646 Wave 3): before this fix, upsertByKey returned an
  // already-seeded role untouched — a permission newly granted to an
  // existing role in LEGACY_ROLES_SEED never reached a role doc seeded
  // before the grant, on any later re-run. Simulates that staleness
  // directly (strip a real permissionId back off an already-seeded
  // role), then asserts a re-seed heals it without re-minting roleId.
  it('merges a newly-granted permission into an already-seeded role on re-seed, without minting a new roleId', async () => {
    const db = createFakeDb();

    const first = await seedRolesAndPermissions(db);
    const permissionIdByCode = Object.fromEntries(first.permissions.map((p) => [p.permissionCode, p.permissionId]));
    const coordinatorDoc = db.collections.roles.docs.find((r) => r.roleCode === 'coordinator');
    const staleRoleId = coordinatorDoc.roleId;
    coordinatorDoc.permissionIds = coordinatorDoc.permissionIds.filter((id) => id !== permissionIdByCode.manageAccessRequests);
    expect(coordinatorDoc.permissionIds).not.toContain(permissionIdByCode.manageAccessRequests);

    const second = await seedRolesAndPermissions(db);

    const coordinator = second.roles.find((r) => r.roleCode === 'coordinator');
    expect(coordinator.permissionIds).toContain(permissionIdByCode.manageAccessRequests);
    expect(coordinator.roleId).toBe(staleRoleId);
    expect(db.collections.roles.docs).toHaveLength(5);
  });

  // #630: allowedActions audited against every real requirePermission()
  // call site in src/interface/routes/ — these are the corrected sets,
  // not the original stale ones (e.g. manageOrganizations used to claim
  // only UPDATE while organization.routes.js also gates POST/DELETE
  // under it).
  describe('PERMISSION_CATALOG allowedActions (#630 audit)', () => {
    it.each([
      ['viewReports', ['CREATE', 'READ', 'DELETE', 'EXPORT']],
      ['createSample', ['CREATE', 'READ']],
      ['withdrawSample', ['UPDATE']],
      ['viewTemperature', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
      ['uploadFiles', ['CREATE', 'READ', 'UPDATE']],
      ['createUser', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
      ['editSample', ['UPDATE']],
      ['deleteSample', ['DELETE']],
      ['createPatient', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
      ['uploadSampleFiles', ['CREATE']],
      ['deleteSampleFiles', ['DELETE']],
      ['manageTemperature', ['UPDATE']],
      ['manageOrganizations', ['CREATE', 'UPDATE', 'DELETE']],
      ['createResult', ['CREATE']],
      ['editResult', ['UPDATE']],
      ['deleteResult', ['DELETE']],
      ['reidentifyParticipant', ['READ']],
      ['manageAccessRequests', ['CREATE', 'READ', 'UPDATE']],
    ])('%s allows exactly %j', (permissionCode, expectedActions) => {
      expect(PERMISSION_CATALOG[permissionCode].allowedActions).toEqual(expectedActions);
    });
  });
});
