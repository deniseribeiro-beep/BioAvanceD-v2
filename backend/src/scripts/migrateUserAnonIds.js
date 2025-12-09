/**
 * Script de Migração: Gera anonId para usuários existentes
 * Execute este script uma vez para adicionar anonId aos usuários que já existem no banco
 * 
 * Uso: node backend/src/scripts/migrateUserAnonIds.js
 */

const { MongoClient } = require('mongodb');
const { generateAnonId } = require('../utils/userAnonymization');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrateUserAnonIds() {
  let client;
  
  try {
    // Obtém URI do MongoDB das variáveis de ambiente
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGO_DB || process.env.MONGO_DB_NOVO || 'bioadvanced';
    
    if (!mongoUri) {
      console.error('Variáveis de ambiente disponíveis:', Object.keys(process.env).filter(k => k.includes('MONGO')));
      throw new Error('MONGODB_URI ou MONGO_URI não encontrada nas variáveis de ambiente. Verifique o arquivo .env');
    }
    
    console.log(`Conectando ao MongoDB: ${mongoUri.replace(/\/\/.*@/, '//***:***@')} (${dbName})`);
    
    // Conecta ao MongoDB
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Conectado ao MongoDB');
    
    const db = client.db(dbName);
    const usersCollection = db.collection('users');
    
    // Busca todos os usuários sem anonId
    const usersWithoutAnonId = await usersCollection.find({
      $or: [
        { anonId: { $exists: false } },
        { anonId: null }
      ]
    }).toArray();
    
    console.log(`Encontrados ${usersWithoutAnonId.length} usuários sem anonId`);
    
    if (usersWithoutAnonId.length === 0) {
      console.log('Nenhum usuário precisa de migração.');
      return;
    }
    
    // Gera e atualiza anonId para cada usuário
    let updated = 0;
    for (const user of usersWithoutAnonId) {
      const userID = user._id.toString();
      const anonId = generateAnonId(userID);
      
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { anonId } }
      );
      
      updated++;
      console.log(`Atualizado usuário ${userID}: ${anonId}`);
    }
    
    console.log(`\nMigração concluída! ${updated} usuários atualizados.`);
    
  } catch (error) {
    console.error('Erro na migração:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('Conexão fechada');
    }
  }
}

// Executa migração se chamado diretamente
if (require.main === module) {
  migrateUserAnonIds()
    .then(() => {
      console.log('Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateUserAnonIds };

