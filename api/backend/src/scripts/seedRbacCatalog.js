// Manual re-seed escape hatch for the RBAC catalog -- NOT the thing that
// keeps the catalog current (#922).
//
// Since #916 (`91a2d523`), `server.js`'s startServer calls
// `seedRolesAndPermissions(db)` on every boot, so the catalog reaches every
// database automatically and this script duplicates that work. It is kept
// for the one case the boot path does not cover: re-seeding a database whose
// server has not been restarted since a permission code was added.
//
// Deliberately has no npm script entry and no compose reference -- it is
// hand-run only. That is what made #916 possible in the first place: nothing
// automated ever invoked it. Do not read its existence as evidence that the
// catalog needs a manual step.
//
// Sibling: backfillUserRoleAssignments.js, which is NOT redundant -- see its
// own header.
const { connectDB, closeConnection } = require('../database/mongo');
const { seedRolesAndPermissions } = require('../services/rbac-catalog-seed.service');

async function run() {
  const db = await connectDB();
  const { roles, permissions } = await seedRolesAndPermissions(db);
  console.log(`RBAC catalog seeded: ${roles.length} roles, ${permissions.length} permissions`);
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro ao semear catálogo RBAC:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
