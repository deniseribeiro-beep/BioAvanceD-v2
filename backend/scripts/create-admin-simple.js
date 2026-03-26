#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');


dotenv.config();

const dbName = process.env.MONGO_DB || 'bioavanced';


// Força uso da URI local sem autenticação
process.env.MONGO_URI = process.env.MONGO_URI || `mongodb://localhost:27017/${dbName}?retryWrites=true&w=majority&tls=false`;

const uri = process.env.MONGO_URI;

if (!uri) {
  console.error('❌ MONGO_URI não definida e não foi possível montar URI com MONGO_ROOT_USERNAME/MONGO_ROOT_PASSWORD.');
  process.exit(1);
}

(async () => {
  const client = new MongoClient(uri);
  try {
    console.log('Conectando ao MongoDB...');
    await client.connect();
    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    const existingAdmin = await usersCollection.findOne({
      $or: [
        { username: 'admin' },
        { email: 'admin@bioavanced.com.br' }
      ]
    });

    if (existingAdmin) {
      console.log('ℹ️ Usuário admin já existe. Nenhuma alteração foi feita.');
      process.exit(0);
    }
    
    console.log('Criando usuário admin...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('Admin@123', salt);
    
    await usersCollection.insertOne({
      name: 'Administrador',
      email: 'admin@bioavanced.com.br',
      username: 'admin',
      password: hashedPassword,
      clinicalUnit: 'BioAvanceD',
      accessType: 4,
      roleName: 'Administrador',
      status: 'active',
      mfaEnabled: false,
      mfaSecret: null,
      mfaActivationDate: null,
      mfaFailedAttempts: 0,
      mfaLocked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: null,
      passwordHistory: [],
      lastPasswordChange: new Date(),
      forceReset: false,
      failedLoginAttempts: 0
    });
    
    console.log('✅ Usuário admin criado!');
    console.log('Email: admin@bioavanced.com.br');
    console.log('Username: admin');
    console.log('Senha: Admin@123');
  } catch(e) {
    console.error('❌ Erro:', e.message);
    process.exit(1);
  } finally {
    await client.close();
    process.exit(0);
  }
})();
