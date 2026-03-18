require('dotenv').config();
const { MongoClient } = require('mongodb');

const ROLE_NAME = process.env.SAMPLE_MOVEMENTS_ROLE_NAME || 'sampleMovementsAppendOnlyRole';
const DB_NAME = process.env.MONGO_DB;
const AUTH_DB = process.env.MONGO_AUTH_DB || 'admin';
const APP_USERNAME = process.env.MONGO_APP_USERNAME || '';
const APPLY_CHANGES = process.env.APPLY_CHANGES === '1' || process.env.APPLY_CHANGES === 'true';

function getRoleDefinition() {
  return {
    role: ROLE_NAME,
    privileges: [
      {
        resource: { db: DB_NAME, collection: 'sample_movements' },
        actions: ['find', 'insert', 'createIndex', 'listIndexes']
      }
    ],
    roles: []
  };
}

async function upsertRole(db) {
  const roleDefinition = getRoleDefinition();

  const existing = await db.command({
    rolesInfo: { role: ROLE_NAME, db: DB_NAME },
    showPrivileges: true,
    showBuiltinRoles: false
  });

  if (Array.isArray(existing.roles) && existing.roles.length > 0) {
    await db.command({
      updateRole: ROLE_NAME,
      privileges: roleDefinition.privileges,
      roles: roleDefinition.roles
    });
    return 'updated';
  }

  await db.command({
    createRole: ROLE_NAME,
    privileges: roleDefinition.privileges,
    roles: roleDefinition.roles
  });
  return 'created';
}

async function grantRoleToAppUser(authDb) {
  if (!APP_USERNAME) {
    console.log('ℹ️ MONGO_APP_USERNAME não informado. Pulando grant automático de role.');
    return 'skipped';
  }

  const usersInfo = await authDb.command({
    usersInfo: APP_USERNAME,
    showPrivileges: false,
    showCredentials: false
  });

  const user = usersInfo?.users?.[0];
  if (!user) {
    throw new Error(`Usuário ${APP_USERNAME} não encontrado no auth DB ${AUTH_DB}`);
  }

  const currentRoles = Array.isArray(user.roles) ? user.roles : [];
  const hasRole = currentRoles.some((role) => role.role === ROLE_NAME && role.db === DB_NAME);
  if (hasRole) {
    return 'already-granted';
  }

  const mergedRoles = [...currentRoles, { role: ROLE_NAME, db: DB_NAME }];
  await authDb.command({
    updateUser: APP_USERNAME,
    roles: mergedRoles
  });

  return 'granted';
}

async function run() {
  if (!DB_NAME) {
    throw new Error('MONGO_DB é obrigatório');
  }

  console.log('🔐 P1-5 | Hardening append-only para sample_movements');
  console.log(`   - DB alvo: ${DB_NAME}`);
  console.log(`   - Role: ${ROLE_NAME}`);
  console.log(`   - Usuário app: ${APP_USERNAME || '(não informado)'}`);
  console.log(`   - Modo: ${APPLY_CHANGES ? 'APLICAR' : 'DRY-RUN'}`);

  if (!APPLY_CHANGES) {
    console.log('\n⚠️ DRY-RUN offline habilitado. Nenhuma alteração foi aplicada e nenhuma conexão com banco foi necessária.');
    console.log('   Para aplicar em banco, configure MONGO_URI e execute com APPLY_CHANGES=1.\n');
    console.log('Resumo da role a aplicar:');
    console.log(JSON.stringify(getRoleDefinition(), null, 2));
    return;
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI é obrigatório para APPLY_CHANGES=1');
  }

  const client = new MongoClient(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000
  });

  await client.connect();
  const db = client.db(DB_NAME);
  const authDb = client.db(AUTH_DB);

  try {
    const roleStatus = await upsertRole(db);
    console.log(`✅ Role ${ROLE_NAME} ${roleStatus}.`);

    const grantStatus = await grantRoleToAppUser(authDb);
    if (grantStatus === 'granted') {
      console.log(`✅ Role ${ROLE_NAME} concedida ao usuário ${APP_USERNAME}.`);
    } else if (grantStatus === 'already-granted') {
      console.log(`ℹ️ Usuário ${APP_USERNAME} já possui a role ${ROLE_NAME}.`);
    }

    console.log('✅ Hardening P1-5 concluído no nível de role/ACL.');
    console.log('ℹ️ Próximo passo recomendado: revisar/remover permissões mutáveis herdadas do usuário de aplicação.');
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error('❌ Falha ao configurar role append-only:', error.message || error);
  process.exit(1);
});