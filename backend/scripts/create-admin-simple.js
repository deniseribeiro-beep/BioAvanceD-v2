#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

dotenv.config({ path: path.resolve(__dirname, '../../.env.docker') });
dotenv.config();

const dbName = process.env.MONGO_DB || 'bioavanced';

if (!process.env.MONGO_URI && process.env.MONGO_ROOT_USERNAME && process.env.MONGO_ROOT_PASSWORD) {
  const mongoHost = process.env.MONGO_HOST || 'localhost';
  const mongoPort = process.env.MONGO_PORT || '27017';
  const mongoUser = encodeURIComponent(process.env.MONGO_ROOT_USERNAME);
  const mongoPassword = encodeURIComponent(process.env.MONGO_ROOT_PASSWORD);
  process.env.MONGO_URI = `mongodb://${mongoUser}:${mongoPassword}@${mongoHost}:${mongoPort}/${dbName}?authSource=admin`;
}

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
      email: 'admin@bioavanced.com.br',
      username: 'admin',
      password: hashedPassword,
      fullName: 'Administrador',
      clinicalUnit: 'BioAvanceD',
      accessType: 3,
      roleName: 'Administrador',
      status: 'ativo',
      mfa: { enabled: false, secret: null },
      createdAt: new Date(),
      updatedAt: new Date()
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
