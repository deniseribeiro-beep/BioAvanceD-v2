const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { connectDB, closeConnection } = require('../database/mongo');
const { validateStrength } = require('../services/password.service');
const { generateAnonId } = require('../utils/userAnonymization');
const { grantRoleForAccessType } = require('../services/rbac-assignment.service');
const { seedRolesAndPermissions } = require('../services/rbac-catalog-seed.service');

dotenv.config();

const REQUIRED_ENV = [
  'BOOTSTRAP_ADMIN_NAME',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_USERNAME',
  'BOOTSTRAP_ADMIN_TEMP_PASSWORD',
];

function requireBootstrapEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`Variaveis obrigatorias ausentes: ${missing.join(', ')}`);
  }

  return {
    name: String(env.BOOTSTRAP_ADMIN_NAME).trim(),
    email: String(env.BOOTSTRAP_ADMIN_EMAIL).trim().toLowerCase(),
    username: String(env.BOOTSTRAP_ADMIN_USERNAME).trim(),
    password: String(env.BOOTSTRAP_ADMIN_TEMP_PASSWORD),
  };
}

async function createFirstAdmin(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const config = requireBootstrapEnv(env);
  validateStrength(config.password);

  const db = options.db || await connectDB();
  const shouldClose = !options.db;

  try {
    const users = db.collection('users');
    const systemBootstrap = db.collection('systemBootstrap');

    await users.createIndex({ email: 1 }, { unique: true });
    await users.createIndex({ username: 1 }, { unique: true });

    const usersCount = await users.countDocuments({});
    if (usersCount > 0) {
      logger.info('[ADMIN_BOOTSTRAP] Users collection is not empty. No changes made.');
      return { status: 'skipped', reason: 'users_exist', usersCount };
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(config.password, 10);
    // #427: accessType is only used below to grant the matching
    // UserRoleAssignment — no longer persisted on the User document.
    const ADMIN_ACCESS_TYPE = 4;
    // RF014 AC#4 (#648): forceReset is now actually enforced at login
    // (previously dormant) -- an explicit, isolated opt-out lets a
    // controlled/automated bootstrap (compose.test.yml's
    // BOOTSTRAP_ADMIN_FORCE_RESET: "false") skip the forced first-login
    // password change, same "never inferred from NODE_ENV" discipline
    // AUTH_RATE_LIMIT_RELAXED already uses (#359). Unset defaults to the
    // secure behavior -- a real production or dev-stack bootstrap keeps
    // forceReset:true unless it explicitly opts out too.
    const forceReset = String(env.BOOTSTRAP_ADMIN_FORCE_RESET ?? 'true').toLowerCase() !== 'false';
    const adminUser = {
      name: config.name,
      email: config.email,
      username: config.username,
      password: passwordHash,
      status: 'active',
      mfaEnabled: false,
      mfaSecret: null,
      forceReset,
      passwordHistory: [],
      failedLoginAttempts: 0,
      lastLogin: null,
      createdAt: now,
      updatedAt: now,
      lastPasswordChange: now,
      createdBy: 'BOOTSTRAP_SYSTEM',
      bootstrapSource: 'admin:create-first',
    };

    const result = await users.insertOne(adminUser);
    const userId = result.insertedId.toString();
    const anonId = generateAnonId(userId);

    // #421: bootstrap runs on an empty DB, so the RBAC catalog (#420) may
    // not be seeded yet — ensure it before granting the assignment.
    await seedRolesAndPermissions(db);
    await grantRoleForAccessType(db, {
      userAccountId: userId,
      accessType: ADMIN_ACCESS_TYPE,
      grantedBy: 'BOOTSTRAP_SYSTEM',
    });

    await users.updateOne(
      { _id: result.insertedId },
      { $set: { anonId, updatedAt: new Date() } }
    );

    await systemBootstrap.updateOne(
      { _id: 'first_admin_bootstrap_v1' },
      {
        $set: {
          status: 'created',
          userId,
          anonId,
          forceReset,
          completedAt: new Date(),
        },
      },
      { upsert: true }
    );

    logger.info(`[ADMIN_BOOTSTRAP] First admin created with forceReset=${forceReset}.`);
    return { status: 'created', userId, anonId, forceReset };
  } finally {
    if (shouldClose) {
      await closeConnection();
    }
  }
}

if (require.main === module) {
  createFirstAdmin()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[ADMIN_BOOTSTRAP] Falha ao criar primeiro admin:', error.message || error);
      process.exit(1);
    });
}

module.exports = {
  createFirstAdmin,
  requireBootstrapEnv,
};
