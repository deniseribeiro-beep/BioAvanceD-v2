/**
 * Script de Migração (issue #762): limpa mfaLocked residual gravado antes da
 * #683 virar um gate real de login. Antes da #683, auth.service.js já
 * incrementava mfaFailedAttempts e gravava mfaLocked:true após 5 códigos
 * MFA errados, mas nada lia a flag — o valor ficava inerte no documento.
 * Depois da #683 (auth.service.js linhas ~316-335), qualquer documento com
 * mfaLocked:true passa a ser barrado no login, mesmo que mfaEnabled seja
 * false hoje — a checagem de mfaLocked roda antes da checagem de mfaEnabled
 * (linha ~391), então usuários sem MFA habilitado também ficam presos por
 * um valor que nunca deveria ter sido lido.
 *
 * Campos pareados com a flag, confirmados em auth.service.js (linhas
 * 407-418, o mesmo incremento que dispara o lock) e em user.routes.js
 * (reset-mfa, linhas 892-905, que zera os dois juntos): mfaLocked e
 * mfaFailedAttempts. Apenas esses dois são tocados aqui — mfaEnabled e
 * mfaSecret não são campos pareados com o lock e não são mexidos, para não
 * desabilitar/reabilitar MFA de ninguém.
 *
 * Idempotente via filtro de query, mesma convenção de
 * migrateUserOrganizations.js/migrateRoleAssignmentScopes.js: uma vez que
 * mfaLocked vira false o documento não casa mais com o filtro, então rodar
 * de novo é no-op (0 usuários encontrados, 0 atualizados).
 *
 * Uso: node backend/src/scripts/migrateClearStaleMfaLocks.js
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrateClearStaleMfaLocks() {
  let client;

  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGO_DB || process.env.MONGO_DB_NOVO || 'bioadvanced';

    if (!mongoUri) {
      console.error('Variáveis de ambiente disponíveis:', Object.keys(process.env).filter(k => k.includes('MONGO')));
      throw new Error('MONGODB_URI ou MONGO_URI não encontrada nas variáveis de ambiente. Verifique o arquivo .env');
    }

    console.log(`Conectando ao MongoDB: ${mongoUri.replace(/\/\/.*@/, '//***:***@')} (${dbName})`);

    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Conectado ao MongoDB');

    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    const usersWithStaleLock = await usersCollection.find({
      mfaLocked: true
    }).toArray();

    console.log(`Encontrados ${usersWithStaleLock.length} usuários com mfaLocked:true`);

    if (usersWithStaleLock.length === 0) {
      console.log('Nenhum usuário precisa de migração.');
      return { usersUpdated: 0 };
    }

    let usersUpdated = 0;
    for (const user of usersWithStaleLock) {
      await usersCollection.updateOne(
        { _id: user._id },
        { $set: { mfaLocked: false, mfaFailedAttempts: 0 } }
      );

      usersUpdated++;
      console.log(`Atualizado usuário ${user._id.toString()}: mfaLocked=false, mfaFailedAttempts=0`);
    }

    console.log(`\nMigração concluída! ${usersUpdated} usuários atualizados.`);

    return { usersUpdated };
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

if (require.main === module) {
  migrateClearStaleMfaLocks()
    .then(() => {
      console.log('Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateClearStaleMfaLocks };
