// Script para criar o Super Admin no MongoDB
// Uso: node src/scripts/seed-admin.js

const { connectDB, closeConnection } = require('../database/mongo');
const UserModel = require('../models/User');
const bcrypt = require('bcryptjs');
const authService = require('../services/auth.service');

(async () => {
  try {
    const db = await connectDB();
    const usersCollection = db.collection('users');
    const adminEmail = 'admin@bioavanced.com';
    const adminUsername = 'admin';
    const adminPassword = 'AdminBioavanced2026!';

    // Verifica se já existe
    const existing = await usersCollection.findOne({ email: adminEmail });
    if (existing) {
      console.log('Usuário admin já existe. Abortando.');
      await closeConnection();
      process.exit(0);
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Cria usuário admin
    const adminUser = UserModel.create({
      name: 'Super Admin',
      email: adminEmail,
      username: adminUsername,
      password: hashedPassword,
      accessType: 4, // 4 = Administrador
      status: 'active',
      mfaEnabled: false
    });
    adminUser.roleName = authService.getRoleName(4);

    const result = await usersCollection.insertOne(adminUser);
    console.log('Usuário admin criado com sucesso:', result.insertedId);

    await closeConnection();
    process.exit(0);
  } catch (err) {
    console.error('Erro ao criar admin:', err);
    try { await closeConnection(); } catch {}
    process.exit(1);
  }
})();
