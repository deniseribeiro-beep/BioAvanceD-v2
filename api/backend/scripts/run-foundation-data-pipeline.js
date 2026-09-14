require('dotenv').config();

const os = require('os');
const { version: pipelineVersion } = require('../package.json');
const { connectNewDB, closeConnection } = require('../src/database/mongo');
const env = require('../src/config/env');
const { runFoundationV2 } = require('../src/foundation/foundation-v2.service');

async function main() {
  const db = await connectNewDB();
  try {
    const result = await runFoundationV2({
      db,
      environment: env.NODE_ENV,
      deploymentId: process.env.HOSTNAME || os.hostname(),
      pipelineVersion,
      initiatedBy: 'system:foundation-data-pipeline',
    });

    console.log(JSON.stringify({
      foundationDataRunId: result.run.foundationDataRunId,
      runStatus: result.run.runStatus,
      dictionaryVersion: result.run.dictionaryVersion,
      canonicalModelReleaseId: result.run.canonicalModelReleaseId,
      readinessReportId: result.readiness.readinessReportId,
      readinessStatus: result.readiness.status,
      p0Coverage: result.readiness.p0Coverage,
    }, null, 2));
  } finally {
    await closeConnection().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = { main };
