const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { generateAnonId } = require('../utils/userAnonymization');

const INITIAL_ADMIN_BOOTSTRAP_ID = 'initial_admin_seed_v1';

async function ensureInitialAdmin(db) {
  const bootstrapCollection = db.collection('systemBootstrap');
  const usersCollection = db.collection('users');

  const existingBootstrap = await bootstrapCollection.findOne({ _id: INITIAL_ADMIN_BOOTSTRAP_ID });
  if (existingBootstrap) {
    logger.info('[BOOTSTRAP] Seed de admin inicial já concluído anteriormente.');
    return;
  }

  const usersCount = await usersCollection.countDocuments();
  if (usersCount > 0) {
    await bootstrapCollection.updateOne(
      { _id: INITIAL_ADMIN_BOOTSTRAP_ID },
      {
        $set: {
          status: 'skipped',
          reason: 'users_exist',
          usersCount,
          completedAt: new Date()
        }
      },
      { upsert: true }
    );
    logger.info(`[BOOTSTRAP] Seed de admin inicial ignorado: já existem ${usersCount} usuário(s).`);
    return;
  }

  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@bioavanced.com.br';
  const adminUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@123';
  const adminName = process.env.INITIAL_ADMIN_NAME || 'Administrador';

  const existingAdmin = await usersCollection.findOne({
    $or: [
      { email: adminEmail },
      { username: adminUsername }
    ]
  });

  if (existingAdmin) {
    await bootstrapCollection.updateOne(
      { _id: INITIAL_ADMIN_BOOTSTRAP_ID },
      {
        $set: {
          status: 'skipped',
          reason: 'admin_already_exists',
          completedAt: new Date()
        }
      },
      { upsert: true }
    );
    logger.info('[BOOTSTRAP] Seed de admin inicial ignorado: admin já existente.');
    return;
  }


  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const now = new Date();
  const adminUser = {
    name: adminName,
    email: adminEmail,
    username: adminUsername,
    password: passwordHash,
    accessType: 4,
    roleName: 'Administrador',
    status: 'active',
    mfaEnabled: false,
    mfaSecret: null,
    mfaActivationDate: null,
    mfaFailedAttempts: 0,
    mfaLocked: false,
    forceReset: false,
    passwordHistory: [],
    failedLoginAttempts: 0,
    createdAt: now,
    updatedAt: now,
    lastLogin: null,
    phone: null,
    institution: null,
    anonId: null,
    lastPasswordChange: now
  };
  const insertResult = await usersCollection.insertOne(adminUser);

  const anonId = generateAnonId(insertResult.insertedId.toString());
  await usersCollection.updateOne(
    { _id: insertResult.insertedId },
    { $set: { anonId } }
  );

  await bootstrapCollection.updateOne(
    { _id: INITIAL_ADMIN_BOOTSTRAP_ID },
    {
      $set: {
        status: 'created',
        userId: insertResult.insertedId.toString(),
        completedAt: new Date()
      }
    },
    { upsert: true }
  );

  logger.info('[BOOTSTRAP] Usuário admin inicial criado com sucesso (primeiro boot).');
}

module.exports = {
  ensureInitialAdmin
};
