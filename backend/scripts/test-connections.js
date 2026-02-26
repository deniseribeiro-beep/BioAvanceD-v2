#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const logger = require('../src/utils/logger');
const { connectMongoDB, closeMongoDBConnection } = require('../src/infrastructure/database/mongodb/connection');
const { connectNeo4j, closeNeo4jConnection } = require('../src/infrastructure/database/neo4j/connection');
const { connectInfluxDB, closeInfluxDBConnection } = require('../src/infrastructure/database/influxdb/connection');

async function testMongoDB() {
  await connectMongoDB();
  return 'MongoDB OK';
}

async function testNeo4j() {
  await connectNeo4j();
  return 'Neo4j OK';
}

async function testInfluxDB() {
  await connectInfluxDB();
  return 'InfluxDB OK';
}

async function closeAllConnections() {
  await Promise.allSettled([
    closeMongoDBConnection(),
    closeNeo4jConnection(),
    closeInfluxDBConnection()
  ]);
}

async function run() {
  logger.info('[ISO20387][CONNECTION_TEST] Iniciando teste simultâneo de conectividade (MongoDB, Neo4j, InfluxDB)');

  const checks = await Promise.allSettled([
    testMongoDB(),
    testNeo4j(),
    testInfluxDB()
  ]);

  const labels = ['MongoDB', 'Neo4j', 'InfluxDB'];
  let hasError = false;

  checks.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      logger.info(`[ISO20387][CONNECTION_TEST] ${labels[index]}: conectado com sucesso`);
      return;
    }

    hasError = true;
    logger.error(
      `[ISO20387][CONNECTION_TEST] ${labels[index]}: falha de conectividade que compromete rastreabilidade`,
      result.reason?.message || result.reason
    );
  });

  await closeAllConnections();

  if (hasError) {
    logger.error('[ISO20387][CONNECTION_TEST] Resultado final: FALHA em uma ou mais conexões');
    process.exit(1);
  }

  logger.info('[ISO20387][CONNECTION_TEST] Resultado final: sucesso nas 3 conexões simultâneas');
  process.exit(0);
}

run().catch(async (error) => {
  logger.error('[ISO20387][CONNECTION_TEST] Erro fatal durante execução:', error.message || error);
  await closeAllConnections();
  process.exit(1);
});
