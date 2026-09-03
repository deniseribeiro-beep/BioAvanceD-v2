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
// Hand-run only: no npm script entry, no compose reference.
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
