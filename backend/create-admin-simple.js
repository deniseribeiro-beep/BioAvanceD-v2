#!/usr/bin/env node
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB || 'bioavanced';

(async () => {
  const client = new MongoClient(uri);
  try {
    console.log('Conectando ao MongoDB...');
    await client.connect();
    const db = client.db(dbName);
    const usersCollection = db.collection('usuarios');
    
    console.log('Criando usuário admin...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('Admin@123', salt);
    
    const result = await usersCollection.insertOne({
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
