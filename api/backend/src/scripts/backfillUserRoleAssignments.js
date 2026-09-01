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
  const assignments = await backfillUserRoleAssignments(db);
  console.log(`UserRoleAssignment backfill: ${assignments.length} assignment(s) ensured`);
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
