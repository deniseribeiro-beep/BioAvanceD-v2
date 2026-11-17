/**
 * Script de Migração (issue #953): renomeia as chaves do documento
 * security_config que divergiam do dicionário canônico dict-02.
 *
 * Seis elementos divergiam (P1X-0282, P1X-0293, P1X-0298 perderam o sufixo de
 * unidade; P1X-0321, P1X-0322, P1X-0323 foram aninhados sob um grupo `metadata`
 * que não existe no dicionário):
 *
 *   authentication.lockoutDuration  -> authentication.lockoutDurationMinutes
 *   loginAttempts.lockoutDuration   -> loginAttempts.lockoutDurationMinutes
 *   session.maxSessionDuration      -> session.maxSessionDurationHours
 *   metadata.version                -> configVersion
 *   metadata.lastUpdated            -> lastUpdatedAt
 *   metadata.lastUpdatedBy          -> lastUpdatedBy
 *
 * Por que é necessário: updateConfig faz um spread por grupo
 * (security.service.js), então uma chave desconhecida no documento armazenado é
 * copiada adiante indefinidamente. Sem esta migração um ambiente que já salvou
 * a configuração ficaria com as duas grafias para sempre — a antiga órfã e a
 * nova em uso.
 *
 * Idempotente pelo próprio $rename: o MongoDB trata $rename de um campo
 * inexistente como no-op, então uma segunda execução não altera nada — mesma
 * convenção de migrateRoleAssignmentScopes.js, sem flag de "já migrado".
 *
 * Rollback: `npm run migrate:security-config-keys -- --rollback`
 * (rollbackSecurityConfigCanonicalKeys) aplica o $rename inverso de cada
 * chave e recria o grupo metadata. Uma chave cujas duas grafias estão
 * gravadas fica como está e é listada em conflicts. O inverso é exato
 * salvo onde o documento já guardava as duas grafias antes da migração:
 * o $rename da migração manteve só o valor da antiga. Só faz sentido junto
 * com o código anterior ao #953, que lia as chaves antigas; com o código
 * atual o próximo save volta a gravar as canônicas. Idempotente: uma
 * segunda execução não encontra chave canônica e não escreve nada.
 *
 * Nota: o documento é o singleton { _id: 'main' } e só existe onde a tela de
 * Segurança já foi salva alguma vez (getConfig o cria sob demanda). Não
 * encontrá-lo é o resultado esperado num ambiente novo, não um erro.
 *
 * Uso: node api/backend/src/scripts/migrateSecurityConfigCanonicalKeys.js
 * Uso: node api/backend/src/scripts/migrateSecurityConfigCanonicalKeys.js --rollback
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const RENAMES = {
  'authentication.lockoutDuration': 'authentication.lockoutDurationMinutes',
  'loginAttempts.lockoutDuration': 'loginAttempts.lockoutDurationMinutes',
  'session.maxSessionDuration': 'session.maxSessionDurationHours',
  'metadata.version': 'configVersion',
  'metadata.lastUpdated': 'lastUpdatedAt',
  'metadata.lastUpdatedBy': 'lastUpdatedBy'
};

// Caminho pontuado presente como propriedade própria em cada nível.
function has(doc, dotted) {
  let node = doc;
  for (const part of dotted.split('.')) {
    if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, part)) return false;
    node = node[part];
  }
  return true;
}

// Com um db injetado, usa a coleção dele sem conectar nem fechar; sem db,
// conecta pelo .env, executa e fecha a conexão.
async function withSecurityConfig(db, fn) {
  if (db) {
    return fn(db.collection('security_config'));
  }

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

    return await fn(client.db(dbName).collection('security_config'));
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

async function migrateSecurityConfigCanonicalKeys({ db } = {}) {
  return withSecurityConfig(db, async (configCollection) => {
    const current = await configCollection.findOne({ _id: 'main' });

    if (!current) {
      console.log('Nenhum documento security_config { _id: "main" } encontrado — nada a migrar.');
      return { documentFound: false, keysRenamed: 0, metadataRemoved: false };
    }

    const pending = Object.entries(RENAMES).filter(([from]) => {
      const [group, key] = from.split('.');
      return current[group] && Object.prototype.hasOwnProperty.call(current[group], key);
    });

    if (pending.length === 0) {
      console.log('Todas as chaves já estão na grafia canônica — nada a migrar.');
    } else {
      console.log(`${pending.length} chave(s) a renomear:`);
      for (const [from, to] of pending) {
        console.log(`  ${from} -> ${to}`);
      }

      await configCollection.updateOne(
        { _id: 'main' },
        { $rename: Object.fromEntries(pending) }
      );
      console.log(`${pending.length} chave(s) renomeada(s)`);
    }

    // $rename e $unset do mesmo caminho pai conflitam num único update, por isso
    // a remoção do grupo `metadata` (agora vazio) vai numa segunda operação.
    let metadataRemoved = false;
    const afterRename = await configCollection.findOne({ _id: 'main' });
    if (afterRename && Object.prototype.hasOwnProperty.call(afterRename, 'metadata')) {
      const leftovers = Object.keys(afterRename.metadata || {});
      if (leftovers.length > 0) {
        console.warn(`Grupo metadata ainda contém chaves não canônicas: ${leftovers.join(', ')} — preservado para inspeção manual.`);
      } else {
        await configCollection.updateOne({ _id: 'main' }, { $unset: { metadata: '' } });
        metadataRemoved = true;
        console.log('Grupo metadata (vazio) removido');
      }
    }

    console.log(`\nMigração concluída! ${pending.length} chave(s) renomeada(s), metadata ${metadataRemoved ? 'removido' : 'não removido'}`);
    return { documentFound: true, keysRenamed: pending.length, metadataRemoved };
  });
}

async function rollbackSecurityConfigCanonicalKeys({ db } = {}) {
  return withSecurityConfig(db, async (configCollection) => {
    const current = await configCollection.findOne({ _id: 'main' });

    if (!current) {
      console.log('Nenhum documento security_config { _id: "main" } encontrado — nada a reverter.');
      return { documentFound: false, keysRestored: 0, conflicts: [] };
    }

    const conflicts = [];
    const pending = [];
    for (const [from, to] of Object.entries(RENAMES)) {
      if (!has(current, to)) continue;
      // As duas grafias gravadas: o $rename inverso sobrescreveria a antiga.
      if (has(current, from)) { conflicts.push(to); continue; }
      pending.push([to, from]);
    }

    for (const key of conflicts) {
      console.warn(`Conflito: ${key} e a grafia antiga estão gravadas — preservado para inspeção manual.`);
    }

    if (pending.length === 0) {
      console.log('Nenhuma chave canônica a reverter.');
    } else {
      // O $rename recria o grupo metadata removido pela migração.
      await configCollection.updateOne(
        { _id: 'main' },
        { $rename: Object.fromEntries(pending) }
      );
      for (const [to, from] of pending) {
        console.log(`  ${to} -> ${from}`);
      }
    }

    console.log(`\nRollback concluído! ${pending.length} chave(s) restaurada(s), ${conflicts.length} conflito(s)`);
    return { documentFound: true, keysRestored: pending.length, conflicts };
  });
}

if (require.main === module) {
  const rollback = process.argv.includes('--rollback');
  const run = rollback ? rollbackSecurityConfigCanonicalKeys : migrateSecurityConfigCanonicalKeys;
  run()
    .then(() => {
      console.log(rollback ? 'Rollback finalizado com sucesso' : 'Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error(rollback ? 'Erro no rollback:' : 'Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateSecurityConfigCanonicalKeys, rollbackSecurityConfigCanonicalKeys, RENAMES };
