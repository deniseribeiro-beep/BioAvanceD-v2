import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { seedRolesAndPermissions, PERMISSION_CATALOG } = require('../../../src/services/rbac-catalog-seed.service');

/**
 * Real query-matching fake (findOne exact-match, insertOne), not a canned
 * stub — proves the seed's upsert-by-business-key idempotency actually
 * depends on querying by roleCode/permissionCode, per this repo's
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
    // #662: was manageAccessRequests, which the Coordenador no longer holds.
    coordinatorDoc.permissionIds = coordinatorDoc.permissionIds.filter((id) => id !== permissionIdByCode.manageReportTemplates);
    expect(coordinatorDoc.permissionIds).not.toContain(permissionIdByCode.manageReportTemplates);

    const second = await seedRolesAndPermissions(db);

    const coordinator = second.roles.find((r) => r.roleCode === 'coordinator');
    expect(coordinator.permissionIds).toContain(permissionIdByCode.manageReportTemplates);
    expect(coordinator.roleId).toBe(staleRoleId);
    expect(db.collections.roles.docs).toHaveLength(5);
  });

  // #662 (Denise, 2026-09-25): manageAccessRequests is Administrador-only
  // until a real multi-approver committee workflow exists.
  it('#662: seeds manageAccessRequests on the Administrador only, not the Coordenador', async () => {
    const db = createFakeDb();
    const { roles, permissions } = await seedRolesAndPermissions(db);
    const manageAccessRequestsId = permissions.find((p) => p.permissionCode === 'manageAccessRequests').permissionId;

    const holders = roles.filter((r) => r.permissionIds.includes(manageAccessRequestsId)).map((r) => r.roleCode);
    expect(holders).toEqual(['administrator']);
  });

  // #1008 (Denise, 2026-09-25): RF003 makes role assignment the
  // Administrador's. (#1229 then took createUser from the Coordenador too;
  // see the cases below.)
  it('#1008: seeds assignRole on the Administrador only', async () => {
    const db = createFakeDb();
    const { roles, permissions } = await seedRolesAndPermissions(db);
    const idOf = (code) => permissions.find((p) => p.permissionCode === code).permissionId;

    expect(roles.filter((r) => r.permissionIds.includes(idOf('assignRole'))).map((r) => r.roleCode)).toEqual(['administrator']);
  });

  // #1229 (Dennis, 2026-10-29): RF003 names the Administrador as the only
  // actor of user management, so each of the four user-account codes is
  // seeded on the Administrador alone.
  it.each(['createUser', 'readUser', 'updateUser', 'deleteUser'])('#1229: seeds %s on the Administrador only', async (code) => {
    const db = createFakeDb();
    const { roles, permissions } = await seedRolesAndPermissions(db);
    const idOf = (c) => permissions.find((p) => p.permissionCode === c).permissionId;

    expect(roles.filter((r) => r.permissionIds.includes(idOf(code))).map((r) => r.roleCode)).toEqual(['administrator']);
  });

  // #1229, #1341: no migration. A Coordenador seeded with createUser, under
  // the old four-verb allowedActions, loses the grant at the next boot, and
  // the Permission document narrows to CREATE.
  it('#1229: a database seeded when the Coordenador held createUser drops it, and narrows createUser to CREATE, at the next boot', async () => {
    const db = createFakeDb();
    const first = await seedRolesAndPermissions(db);
    const idOf = (c) => first.permissions.find((p) => p.permissionCode === c).permissionId;
    db.collections.roles.docs.find((r) => r.roleCode === 'coordinator').permissionIds.push(idOf('createUser'));
    db.collections.permissions.docs.find((p) => p.permissionCode === 'createUser').allowedActions = ['CREATE', 'READ', 'UPDATE', 'DELETE'];

    const second = await seedRolesAndPermissions(db);

    expect(second.roles.find((r) => r.roleCode === 'coordinator').permissionIds).not.toContain(idOf('createUser'));
    expect(db.collections.permissions.docs.find((p) => p.permissionCode === 'createUser').allowedActions).toEqual(['CREATE']);
  });

  // #1229: access.routes.js moved off createUser to its own code, seeded to
  // exactly the roles that held createUser then, so no caller gained or
  // lost. The Coordenador keeps it after the verb split took createUser.
  it('#1229: seeds manageAccessGrants on the Coordenador and the Administrador', async () => {
    const db = createFakeDb();
    const { roles, permissions } = await seedRolesAndPermissions(db);
    const idOf = (code) => permissions.find((p) => p.permissionCode === code).permissionId;
    const holdersOf = (code) => roles.filter((r) => r.permissionIds.includes(idOf(code))).map((r) => r.roleCode);

    expect(holdersOf('manageAccessGrants')).toEqual(['coordinator', 'administrator']);
  });

  // #1229, #1341: no migration. A database seeded before the code existed
  // gains the Permission document and both roles' grant at the next boot.
  it('#1229: a database seeded before manageAccessGrants gains it on both roles at the next boot', async () => {
    const db = createFakeDb();
    await seedRolesAndPermissions(db);
    const permissionDocs = db.collections.permissions.docs;
    const oldIndex = permissionDocs.findIndex((p) => p.permissionCode === 'manageAccessGrants');
    const [oldDoc] = permissionDocs.splice(oldIndex, 1);
    const roleIdByCode = {};
    for (const role of db.collections.roles.docs) {
      role.permissionIds = role.permissionIds.filter((id) => id !== oldDoc.permissionId);
      roleIdByCode[role.roleCode] = role.roleId;
    }

    const second = await seedRolesAndPermissions(db);

    expect(permissionDocs.filter((p) => p.permissionCode === 'manageAccessGrants')).toHaveLength(1);
    const newId = second.permissions.find((p) => p.permissionCode === 'manageAccessGrants').permissionId;
    const holders = db.collections.roles.docs.filter((r) => r.permissionIds.includes(newId)).map((r) => r.roleCode);
    expect(holders).toEqual(['coordinator', 'administrator']);
    for (const role of db.collections.roles.docs) {
      expect(role.roleId).toBe(roleIdByCode[role.roleCode]);
    }
  });

  // #1341: role grants are catalog-owned, so upsertRole sets the stored
  // role to the seed's list. A database seeded before #662 still holding
  // the withdrawn grant loses it, and so does a grant added by hand: the
  // stored role equals the catalog after the boot.
  it('#662, #1341: sets an already-seeded role to the catalog, pulling a withdrawn grant and a hand-added one, keeping its roleId', async () => {
    const db = createFakeDb();
    const first = await seedRolesAndPermissions(db);
    const permissionIdByCode = Object.fromEntries(first.permissions.map((p) => [p.permissionCode, p.permissionId]));
    const seededCoordinatorIds = [...first.roles.find((r) => r.roleCode === 'coordinator').permissionIds];

    // A database seeded before #662: the Coordenador still holds the grant,
    // plus one an operator added by hand.
    const coordinatorDoc = db.collections.roles.docs.find((r) => r.roleCode === 'coordinator');
    const roleId = coordinatorDoc.roleId;
    coordinatorDoc.permissionIds = [...coordinatorDoc.permissionIds, permissionIdByCode.manageAccessRequests, permissionIdByCode.manageBackup];

    const second = await seedRolesAndPermissions(db);

    const coordinator = second.roles.find((r) => r.roleCode === 'coordinator');
    expect(coordinator.permissionIds).not.toContain(permissionIdByCode.manageAccessRequests);
    expect(coordinator.permissionIds).not.toContain(permissionIdByCode.manageBackup);
    expect([...coordinator.permissionIds].sort()).toEqual([...seededCoordinatorIds].sort());
    expect(coordinator.permissionIds).toContain(permissionIdByCode.createSample);
    expect(coordinator.roleId).toBe(roleId);
    const stored = db.collections.roles.docs.find((r) => r.roleCode === 'coordinator');
    expect(stored.permissionIds).not.toContain(permissionIdByCode.manageAccessRequests);

    const administrator = second.roles.find((r) => r.roleCode === 'administrator');
    expect(administrator.permissionIds).toContain(permissionIdByCode.manageAccessRequests);
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

  // #1341: setting a role compares as a set, so a stored list in another
  // order is not a change and a no-op boot writes no role either.
  it('#1341 control: a re-seed of roles matching the catalog, in any order, issues no role write', async () => {
    const db = createFakeDb();
    await seedRolesAndPermissions(db);

    const roles = db.collections.roles;
    const coordinatorDoc = roles.docs.find((r) => r.roleCode === 'coordinator');
    coordinatorDoc.permissionIds = [...coordinatorDoc.permissionIds].reverse();
    let updateCalls = 0;
    const realUpdateOne = roles.updateOne.bind(roles);
    roles.updateOne = async (...args) => { updateCalls += 1; return realUpdateOne(...args); };

    await seedRolesAndPermissions(db);

    expect(updateCalls).toBe(0);
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
      // #1229: one verb per user-account code.
      ['createUser', ['CREATE']],
      ['readUser', ['READ']],
      ['updateUser', ['UPDATE']],
      ['deleteUser', ['DELETE']],
      // #1008: CREATE is POST /users/register, UPDATE the in-handler check on
      // PUT /users/:id.
      ['assignRole', ['CREATE', 'UPDATE']],
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
      // #929: the read-only pair added by #1087 and #1146 after this table
      // was last extended. Neither was backfilled here, which is the same
      // drift the comment above describes -- a code can be introduced, or
      // later widened, with nothing in the audit table objecting.
      ['viewEquipment', ['READ']],
      ['viewStorageTopology', ['READ']],
      // #929: the Consent-domain code that replaced the borrowed
      // 'createPatient' on POST /generate-link. CREATE only: the route is a
      // POST and METHOD_TO_ACTION derives CREATE, so a wider set would buy
      // nothing and would let the code later gate a read or a delete the way
      // 'viewTemperature' did before #1073.
      ['requestConsent', ['CREATE']],
      // #1316: custody's two routes are POSTs.
      ['manageCustody', ['CREATE']],
      // #1229: access.routes.js's GET, POST, PUT and DELETE.
      ['manageAccessGrants', ['CREATE', 'READ', 'UPDATE', 'DELETE']],
    ])('%s allows exactly %j', (permissionCode, expectedActions) => {
      expect(PERMISSION_CATALOG[permissionCode].allowedActions).toEqual(expectedActions);
    });
  });
});
