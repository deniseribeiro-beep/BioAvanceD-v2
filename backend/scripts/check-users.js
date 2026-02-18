require('dotenv').config();
const { connectDB, closeConnection } = require('./src/database/mongo');
const logger = require('./src/utils/logger');

/**
 * Script para verificar usuários no banco
 */
async function checkUsers() {
  try {
    logger.info('Verificando usuários no banco...');

    const db = await connectDB();
    const usersCollection = db.collection('usuarios');

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
