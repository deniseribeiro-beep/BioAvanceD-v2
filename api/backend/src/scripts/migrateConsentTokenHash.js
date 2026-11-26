/**
 * Script de Migração (issue #1049): substitui o `consentToken` em texto claro
 * de cada Patient pelo seu hash, `consentTokenHash`.
 *
 * Por que é necessário: a partir do #1049 o token de consentimento é
 * armazenado apenas como SHA-256 (utils/consentTokenHash.js) e validado contra
 * o hash. Um documento gravado antes disso ainda carrega o token em claro e
 * nenhum hash, então o link que o participante já recebeu deixa de validar e
 * o segredo continua exposto em qualquer dump ou backup. Esta migração
 * converte esses documentos no lugar: o link já enviado volta a funcionar,
 * agora contra o hash, e o texto claro é removido.
 *
 * Idempotente: só seleciona documentos que ainda têm `consentToken` não nulo,
 * e cada um é atualizado com $unset desse campo, então uma segunda execução
 * não encontra nada. Um `consentToken: null` (o que acceptConsentToken
 * gravava ao aceitar) é apenas removido.
 *
 * Irreversível: sem rollback. O SHA-256 não devolve o token, e o mesmo
 * updateOne que grava consentTokenHash remove o consentToken ($unset), então
 * depois da execução nada no banco guarda o token em claro; o código atual
 * só valida contra o hash (utils/consentTokenHash.js). Desfazer é restaurar
 * patients de um backup feito antes da execução.
 *
 * Uso: npm run migrate:consent-token-hash  (a partir de api/backend)
 */

const { connectDB, closeConnection } = require('../database/mongo');
const { getCollection } = require('../utils/collectionResolver');
const { hashConsentToken } = require('../utils/consentTokenHash');

async function migrateConsentTokenHash(db) {
  const patients = await getCollection(db, 'patients');
  const summary = { hashed: 0, clearedNull: 0 };

  const legacy = await patients
    .find({ consentToken: { $exists: true } }, { projection: { _id: 1, consentToken: 1 } })
    .toArray();

  for (const doc of legacy) {
    if (typeof doc.consentToken === 'string' && doc.consentToken.length > 0) {
      const result = await patients.updateOne(
        { _id: doc._id, consentToken: doc.consentToken },
        {
          $set: { consentTokenHash: hashConsentToken(doc.consentToken) },
          $unset: { consentToken: '' }
        }
      );
      summary.hashed += result.modifiedCount;
    } else {
      const result = await patients.updateOne(
        { _id: doc._id },
        { $unset: { consentToken: '' } }
      );
      summary.clearedNull += result.modifiedCount;
    }
  }

  return summary;
}

async function run() {
  const db = await connectDB();
  const summary = await migrateConsentTokenHash(db);
  console.log('consentToken -> consentTokenHash:', JSON.stringify(summary));
  return summary;
}

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Erro na migração consentToken -> consentTokenHash:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeConnection();
    });
}

module.exports = { migrateConsentTokenHash, run };
