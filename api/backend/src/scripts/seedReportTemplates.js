const { connectDB, closeConnection } = require('../database/mongo');
const { seedReportTemplates } = require('../services/report-template-seed.service');

async function run() {
  const db = await connectDB();
  const { templates } = await seedReportTemplates(db);
  console.log(`Report templates seeded: ${templates.length}`);
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro ao semear modelos de relatório:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { run };
