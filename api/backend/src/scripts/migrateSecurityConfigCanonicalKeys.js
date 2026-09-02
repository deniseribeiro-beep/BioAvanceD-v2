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
 * Nota: o documento é o singleton { _id: 'main' } e só existe onde a tela de
 * Segurança já foi salva alguma vez (getConfig o cria sob demanda). Não
 * encontrá-lo é o resultado esperado num ambiente novo, não um erro.
 *
 * Uso: node api/backend/src/scripts/migrateSecurityConfigCanonicalKeys.js
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

async function migrateSecurityConfigCanonicalKeys() {
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

    const configCollection = client.db(dbName).collection('security_config');
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
  migrateSecurityConfigCanonicalKeys()
    .then(() => {
      console.log('Migração finalizada com sucesso');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro na migração:', error);
      process.exit(1);
    });
}

module.exports = { migrateSecurityConfigCanonicalKeys, RENAMES };
