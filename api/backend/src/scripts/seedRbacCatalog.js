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
