const neo4j = require('neo4j-driver');
const env = require('../../../config/env');
const logger = require('../../../utils/logger');

let neo4jDriver = null;
let connectingPromise = null;

function getNeo4jConfig() {
  return {
    uri: env.NEO4J_URI,
    username: env.NEO4J_USERNAME,
    password: env.NEO4J_PASSWORD,
    database: env.NEO4J_DATABASE || 'neo4j'
  };
}

function assertNeo4jEnv(config) {
  if (!config.uri || !config.username || !config.password) {
    throw new Error('[ISO20387][NEO4J] Variáveis NEO4J_URI, NEO4J_USERNAME e NEO4J_PASSWORD são obrigatórias');
  }
}

async function connectNeo4j() {
  if (neo4jDriver) {
    return neo4jDriver;
  }

  if (!connectingPromise) {
    const config = getNeo4jConfig();
    assertNeo4jEnv(config);

    connectingPromise = (async () => {
      const driver = neo4j.driver(
        config.uri,
        neo4j.auth.basic(config.username, config.password),
        {
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 10000,
          disableLosslessIntegers: true
        }
      );

      try {
        await driver.verifyConnectivity();
        const session = driver.session({ database: config.database });
        await session.run('RETURN 1 AS ok');
        await session.close();

        neo4jDriver = driver;
        logger.info('[ISO20387][NEO4J] Conexão e validação de rastreabilidade estabelecidas');
        return neo4jDriver;
      } catch (error) {
        await driver.close();
        logger.error('[ISO20387][NEO4J] Falha de conexão que impacta cadeia de custódia:', error.message);
        throw error;
      } finally {
        connectingPromise = null;
      }
    })();
  }

  return connectingPromise;
}

function getNeo4jDriver() {
  if (!neo4jDriver) {
    throw new Error('[ISO20387][NEO4J] Driver indisponível para validação pré-persistência');
  }
  return neo4jDriver;
}

async function closeNeo4jConnection() {
  if (!neo4jDriver) {
    return;
  }

  await neo4jDriver.close();
  neo4jDriver = null;
  logger.info('[ISO20387][NEO4J] Conexão encerrada com sucesso');
}

module.exports = {
  connectNeo4j,
  getNeo4jDriver,
  closeNeo4jConnection,
  getNeo4jConfig
};
