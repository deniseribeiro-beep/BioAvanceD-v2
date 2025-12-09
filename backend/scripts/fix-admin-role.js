require('dotenv').config();
const { connectDB, closeConnection } = require('../src/database/mongo');
const logger = require('../src/utils/logger');
const bcrypt = require('bcryptjs');

/**
 * Script para corrigir a role do usuário admin para Administrador
 */
async function fixAdminRole() {
  try {
    logger.info('Iniciando correção da role do admin...');

    const db = await connectDB();
    const usersCollection = db.collection('users');

    // Busca o usuário admin
    const adminUser = await usersCollection.findOne({
      $or: [
        { email: 'admin@bioavanced.com' },
        { email: 'admin@bioadvanced.com' },
        { username: 'admin' }
      ]
    });

    if (!adminUser) {
      logger.warn('Usuário admin não encontrado. Criando novo admin...');
      
      // Cria o admin se não existir
      const hashedPassword = await bcrypt.hash('1234@5678', 10);
      const newAdmin = {
        name: 'Administrador',
        email: 'admin@bioavanced.com',
        username: 'admin',
        password: hashedPassword,
        accessType: 4, // Administrador
        roleName: 'Administrador',
        status: 'active',
        mfaEnabled: false,
        mfaSecret: null,
        mfaActivationDate: null,
        mfaFailedAttempts: 0,
        mfaLocked: false,
        phone: null,
        institution: 'BioAvanceD',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: null
      };

      const result = await usersCollection.insertOne(newAdmin);
      logger.info(`✅ Admin criado com sucesso! ID: ${result.insertedId}`);
    } else {
      // Atualiza o admin existente
      logger.info(`Admin encontrado: ${adminUser.email || adminUser.username}`);
      
      const updateResult = await usersCollection.updateOne(
        { _id: adminUser._id },
        {
          $set: {
            accessType: 4, // Administrador
            roleName: 'Administrador',
            status: 'active',
            mfaEnabled: false,
            mfaSecret: null,
            mfaActivationDate: null,
            updatedAt: new Date()
          }
        }
      );

      if (updateResult.modifiedCount > 0) {
        logger.info('✅ Role do admin atualizada para Administrador!');
        logger.info(`   - accessType: 4`);
        logger.info(`   - roleName: Administrador`);
      } else {
        logger.info('ℹ️  Admin já está com a role correta.');
      }
    }

    await closeConnection();
    logger.info('✅ Processo concluído!');
  } catch (error) {
    logger.error('❌ Erro ao corrigir role do admin:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Executa o script
fixAdminRole();

