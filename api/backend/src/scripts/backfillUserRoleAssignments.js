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
