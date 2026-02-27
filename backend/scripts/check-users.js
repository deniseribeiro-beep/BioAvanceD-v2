const path = require('path');
const dotenv = require('dotenv');
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');

dotenv.config({ path: path.resolve(__dirname, '../../.env.docker') });
dotenv.config();

if (!process.env.MONGO_URI && process.env.MONGO_ROOT_USERNAME && process.env.MONGO_ROOT_PASSWORD) {
  const dbName = process.env.MONGO_DB || 'bioavanced';
  const mongoHost = process.env.MONGO_HOST || 'localhost';
  const mongoPort = process.env.MONGO_PORT || '27017';
  const mongoUser = encodeURIComponent(process.env.MONGO_ROOT_USERNAME);
  const mongoPassword = encodeURIComponent(process.env.MONGO_ROOT_PASSWORD);
  process.env.MONGO_URI = `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${dbName}?authSource=admin`;
}

/**
 * Script para verificar usuários no banco
 */
async function checkUsers() {
  try {
    logger.info('Verificando usuários no banco...');

    const db = await connectDB();
    const usersCollection = db.collection('users');

    // Busca todos os usuários
    const users = await usersCollection.find({}).project({ email: 1, username: 1, roleName: 1, status: 1 }).toArray();

    logger.info(`Total de usuários: ${users.length}`);
    
    if (users.length > 0) {
      logger.info('Primeiros 5 usuários:');
      users.slice(0, 5).forEach((u, idx) => {
        logger.info(`${idx + 1}. Email: ${u.email}, Username: ${u.username}, Role: ${u.roleName}, Status: ${u.status}`);
      });
    }

    await closeConnection();
    process.exit(0);
  } catch (error) {
    logger.error('Erro:', error);
    await closeConnection();
    process.exit(1);
  }
}

checkUsers();
