#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const logger = require('../src/utils/logger');
const { connectDB, closeConnection } = require('../src/database/mongo');
const fhirSyncService = require('../src/services/fhir-sync.service');

async function run() {
  let db;

  try {
    const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
    const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;

    db = await connectDB();

    const summary = await fhirSyncService.syncAllLegacyData(db, { limit });

    logger.info(
      `[FHIR_MIGRATION] Migração concluída: patients=${summary.patients}, samples=${summary.samples}, consents=${summary.consents}`
    );

    process.exit(0);
  } catch (error) {
    logger.error('[FHIR_MIGRATION] Falha na migração legado→FHIR:', error.message || error);
    process.exit(1);
  } finally {
    await closeConnection();
  }
}

run();
