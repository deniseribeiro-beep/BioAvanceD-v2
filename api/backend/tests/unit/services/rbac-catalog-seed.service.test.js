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
  // #1075: `permissions` was the last collection still seeded through the
  // skip-on-existing `upsertByKey` -- the same defect #646 Wave 3 fixed for
  // `roles` and #1064 for `reportTemplates`, and the one both of those
  // docblocks cite as their negative example. A row seeded before a
  // PERMISSION_CATALOG correction kept the old catalog values forever,
  // because `existing` was returned as-is and no write was ever issued.
  //
  // Simulates the exact change shape #929 and #632 both performed -- an
  // EXISTING code whose allowedActions were later widened -- since a NEW
  // permissionCode inserts normally and the skip never bites for it.
  it('#1075: reconciles a stale catalog-owned permission field on re-seed, without minting a new permissionId', async () => {
    const db = createFakeDb();

    const first = await seedRolesAndPermissions(db);
    const seeded = db.collections.permissions.docs.find((p) => p.permissionCode === 'manageStorageTopology');
    const stablePermissionId = seeded.permissionId;
    seeded.allowedActions = ['READ', 'UPDATE'];
    seeded.displayName = 'Nome anterior a #929';
    seeded.resourceType = 'System';

    const second = await seedRolesAndPermissions(db);

    const catalogEntry = PERMISSION_CATALOG.manageStorageTopology;
    const returned = second.permissions.find((p) => p.permissionCode === 'manageStorageTopology');
    expect(returned.allowedActions).toEqual(catalogEntry.allowedActions);
    expect(returned.displayName).toBe(catalogEntry.displayName);
    expect(returned.resourceType).toBe(catalogEntry.resourceType);

    // The STORED document, not just the returned one -- returning a
    // reconciled object while writing nothing is the failure this heals.
    const stored = db.collections.permissions.docs.find((p) => p.permissionCode === 'manageStorageTopology');
    expect(stored.allowedActions).toEqual(catalogEntry.allowedActions);
    expect(stored.displayName).toBe(catalogEntry.displayName);
    expect(stored.resourceType).toBe(catalogEntry.resourceType);

    // roles reference permissions by permissionId, so re-minting it would
    // silently orphan every role document. Same contract upsertRole keeps
    // for roleId.
    expect(stored.permissionId).toBe(stablePermissionId);
    expect(returned.permissionId).toBe(stablePermissionId);
    expect(db.collections.permissions.docs).toHaveLength(first.permissions.length);
  });

  // The other half of #1064's stated split, applied here: only the fields
  // buildPermissionDocs derives from PERMISSION_CATALOG are system-owned.
  // description, permissionStatus and conditionExpression are operator-owned
  // (dict-02 P1X-0220/P1X-0224/P1X-0223) and must survive a re-seed --
  // including one that DOES write, which is why allowedActions is dirtied
  // here too.
  it('#1075: leaves operator-owned permission fields untouched by a reconciling re-seed', async () => {
    const db = createFakeDb();
    await seedRolesAndPermissions(db);

    const seeded = db.collections.permissions.docs.find((p) => p.permissionCode === 'viewReports');
    seeded.description = 'Descrição escrita por um operador';
    seeded.permissionStatus = 'deprecated';
    seeded.conditionExpression = 'organizationId == user.organizationId';
    seeded.allowedActions = ['READ'];

    await seedRolesAndPermissions(db);

    const stored = db.collections.permissions.docs.find((p) => p.permissionCode === 'viewReports');
    expect(stored.allowedActions).toEqual(PERMISSION_CATALOG.viewReports.allowedActions);
    expect(stored.description).toBe('Descrição escrita por um operador');
    expect(stored.permissionStatus).toBe('deprecated');
    expect(stored.conditionExpression).toBe('organizationId == user.organizationId');
  });

  // #1075 control -- GREEN both before and after. The pre-fix helper wrote
  // nothing at all, so "no write on a clean re-run" cannot distinguish the
  // fix from the bug; it is here to pin the half of upsertByCode's contract
  // that says a no-op re-run performs no updateOne, which a naive
  // reconcile-always implementation would break on every boot.
  it('#1075 control: a re-seed matching the catalog issues no write at all', async () => {
    const db = createFakeDb();
    await seedRolesAndPermissions(db);

    const permissions = db.collections.permissions;
    const insertedCount = permissions.docs.length;
    let updateCalls = 0;
    const realUpdateOne = permissions.updateOne.bind(permissions);
    permissions.updateOne = async (...args) => { updateCalls += 1; return realUpdateOne(...args); };

    await seedRolesAndPermissions(db);

    expect(updateCalls).toBe(0);
    expect(permissions.docs).toHaveLength(insertedCount);
  });


  // #921 finding 2: this comment used to claim the table below was
  // "audited against every real requirePermission() call site in
  // src/interface/routes/". It is not, and never was — this file reads no
  // route file, so it cannot detect the drift that wording promises. #929
  // is the worked example: both storage codes were missing from the table
  // entirely, and nothing here objected.
  //
  // The real derivation now lives in
  // `tests/architecture/rbac-actions.arch.test.js`, which reads all 190
  // call sites across both route directories and checks each one's derived
  // action against its code's allowedActions.
  //
  // This table is kept, with its claim corrected: it pins **specific
  // expected sets** for 22 codes, which the derived guard deliberately does
  // not — that one checks call sites are *inside* allowedActions, so it
  // would not notice a set that grew a permission nothing uses. The two
  // assertions are complementary; only the completeness claim was false.
  //
  // These are the corrected sets from #630, not the original stale ones
  // (e.g. manageOrganizations used to claim only UPDATE while
  // organization.routes.js also gates POST/DELETE under it).
  describe('PERMISSION_CATALOG allowedActions (#630 sets, hand-pinned)', () => {
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
      // #1073: the two codes that took the sensor/temperature WRITE routes
      // off 'viewTemperature'. manageTemperature is pinned ['UPDATE'] right
      // above, which is exactly why it could not absorb them -- CREATE and
      // DELETE would have 403'd for every caller.
      ['manageSensor', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
      ['recordTemperature', ['CREATE']],
      ['manageOrganizations', ['CREATE', 'UPDATE', 'DELETE']],
      ['createResult', ['CREATE']],
      ['editResult', ['UPDATE']],
      ['deleteResult', ['DELETE']],
      ['reidentifyParticipant', ['READ']],
      ['manageAccessRequests', ['CREATE', 'READ', 'UPDATE']],
      // #929: both storage codes were absent from this table, so #888 could
      // introduce manageStorageTopology with a READ/UPDATE-only set and
      // nothing here would have objected when #929 pointed POST/PUT/DELETE
      // routes at it. Pinned now, in the table that claims to be the audit.
      ['manageStorageAllocation', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
      ['manageStorageTopology', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
    ])('%s allows exactly %j', (permissionCode, expectedActions) => {
      expect(PERMISSION_CATALOG[permissionCode].allowedActions).toEqual(expectedActions);
    });
  });
});
