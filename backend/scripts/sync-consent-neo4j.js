#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const logger = require('../src/utils/logger');
const { connectDB, closeConnection } = require('../src/database/mongo');
const { connectNeo4j, closeNeo4jConnection } = require('../src/infrastructure/database/neo4j/connection');
const consentNeo4jSyncService = require('../src/services/consentNeo4jSync.service');

async function run() {
  let db = null;
  let neo4jDriver = null;

  try {
    db = await connectDB();
    neo4jDriver = await connectNeo4j();

    const result = await consentNeo4jSyncService.sync({ db, neo4jDriver });

    logger.info(`[ISO20387][SYNC] Finalizado: processadas=${result.processed}, atualizadas=${result.updated}, coleção=${result.consentCollection}`);
    process.exit(0);
  } catch (error) {
    logger.error('[ISO20387][SYNC] Falha ao sincronizar consentimento Mongo→Neo4j:', error.message || error);
    process.exit(1);
  } finally {
    await Promise.allSettled([
      closeConnection(),
      closeNeo4jConnection()
    ]);
  }
}

run();
