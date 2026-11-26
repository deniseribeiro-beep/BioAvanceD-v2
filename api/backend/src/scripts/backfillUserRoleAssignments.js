// Backfills UserRoleAssignment rows for users that predate RBAC assignment.
// This is NOT redundant with #916's boot seed and is the reason the two
// scripts in this directory are different things (#922).
//
// `server.js`'s boot path seeds the RBAC *catalog* (roles + permissions) on
// every start. It does not touch per-user assignments, which is this
// script's actual job -- deriving a UserRoleAssignment from each existing
// user's legacy `accessType`.
//
// Its `seedRolesAndPermissions` prerequisite call (inside
// rbac-assignment.service's backfillUserRoleAssignments, #437) is now
// belt-and-braces rather than load-bearing, since boot has already run it.
// Harmless and idempotent; left in so the script still works standalone
// against a database whose server never started.
//
// #1125: exposed as `npm run migrate:user-role-assignments`. It was hand-run
// only -- no npm entry, no compose service, no boot path -- which is the class
// this repo's conventions name outright: a script under src/scripts/ that is
// none of those never runs on any stack. Sharpest case in that population
// because docs/architecture/legacy-location-migration-mapping.md names THIS
// file as the pattern backfillLocationStorage.js was copied from (#461), so
// the documented exemplar was itself unrunnable while its copy got wired in
// #1070.
//
// Still deliberately NOT on the boot path or in compose: it is a one-shot
// legacy migration over pre-RBAC users, not a seed. Placement 3 of the
// conventions' "Where a new seed belongs" -- a manual npm script -- which is
// what admin:create-first and the two mfa scripts are.
//
// One-way: no rollback. Its rows carry `grantedBy: 'system-backfill'`, so a
// person can find them, but `changeUserRole` may since have revoked and
// replaced one, and enforcement reads UserRoleAssignment only, so removing
// them leaves those users with no role.
const { connectDB, closeConnection } = require('../database/mongo');
const { backfillUserRoleAssignments } = require('../services/rbac-assignment.service');

async function run() {
  const db = await connectDB();
  const { granted, skipped } = await backfillUserRoleAssignments(db);
  console.log(`UserRoleAssignment backfill: ${granted.length} assignment(s) ensured, ${skipped.length} user(s) skipped`);

  // Surfaced separately because these are the users the fix exists for: no
  // accessType and no active assignment, so this script has no recoverable
  // way to derive a role for them (see rbac-assignment.service.js). They
  // need manual attention -- guessing a role here would be worse than
  // leaving them unassigned.
  const orphans = skipped.filter((entry) => entry.reason === 'orphan-no-access-type-no-assignment');
  if (orphans.length) {
    console.log(`  ${orphans.length} orphan(s) with no accessType and no assignment -- needs manual review:`);
    for (const orphan of orphans) {
      console.log(`    - ${orphan.userAccountId}`);
    }
  }
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro ao popular UserRoleAssignment:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
