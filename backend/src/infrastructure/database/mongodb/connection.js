const mongoose = require('mongoose');
const env = require('../../../config/env');
const logger = require('../../../utils/logger');

let connectionPromise = null;

function buildMongoUri() {
  if (!env.MONGO_URI) {
    throw new Error('[ISO20387][MONGODB] MONGO_URI não configurada para rastreabilidade de cadeia de custódia');
  }
  return env.MONGO_URI;
}

async function connectMongoDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(buildMongoUri(), {
        dbName: env.MONGO_DB,
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        autoIndex: false
      })
      .then((mongooseInstance) => {
        logger.info('[ISO20387][MONGODB] Conexão estabelecida para persistência rastreável');
        return mongooseInstance.connection;
      })
      .catch((error) => {
        connectionPromise = null;
        logger.error('[ISO20387][MONGODB] Falha de conexão que compromete integridade de custódia:', error.message);
        throw error;
      });
  }

  return connectionPromise;
}

function getMongoDBConnection() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('[ISO20387][MONGODB] Conexão indisponível para operação crítica');
  }
  return mongoose.connection;
}

async function closeMongoDBConnection() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.connection.close();
  connectionPromise = null;
  logger.info('[ISO20387][MONGODB] Conexão encerrada com sucesso');
}

module.exports = {
  connectMongoDB,
  getMongoDBConnection,
  closeMongoDBConnection
};
