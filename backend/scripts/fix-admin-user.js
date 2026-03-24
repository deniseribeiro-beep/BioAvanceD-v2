// Script para corrigir usuários corrompidos (sem senha válida) ou criar um novo admin
// Uso: node scripts/fix-admin-user.js


// Carrega variáveis do .env automaticamente
require('dotenv').config({ path: __dirname + '/../.env' });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const MONGO_DB = process.env.MONGO_DB || 'bioavanced';

// Altere conforme necessário
const ADMIN_USERNAME = 'admin';
const ADMIN_EMAIL = 'admin@bioavanced.local';
const ADMIN_PASSWORD = 'Admin@123'; // Altere para uma senha forte

async function main() {
  const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db(MONGO_DB);
  const users = db.collection('users');

  // Gera hash da senha
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Busca usuário admin existente
  let admin = await users.findOne({ $or: [ { username: ADMIN_USERNAME }, { email: ADMIN_EMAIL } ] });

  if (admin) {
    // Corrige senha se necessário
    if (!admin.password || typeof admin.password !== 'string' || !admin.password.startsWith('$2')) {
      await users.updateOne(
        { _id: admin._id },
        { $set: { password: passwordHash, status: 'active', accessType: 4, roleName: 'Administrador' } }
      );
      console.log('Senha do admin corrigida com sucesso!');
    } else {
      console.log('Usuário admin já possui senha válida.');
    }
  } else {
    // Cria novo admin
    await users.insertOne({
      name: 'Administrador',
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: passwordHash,
      accessType: 4,
      roleName: 'Administrador',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: null,
      mfaEnabled: false,
      mfaSecret: null,
      mfaFailedAttempts: 0,
      mfaLocked: false,
      passwordHistory: [],
      lastPasswordChange: new Date(),
      forceReset: false,
      failedLoginAttempts: 0
    });
    console.log('Usuário admin criado com sucesso!');
  }

  await client.close();
}

main().catch(err => {
  console.error('Erro ao corrigir/criar admin:', err);
  process.exit(1);
});
