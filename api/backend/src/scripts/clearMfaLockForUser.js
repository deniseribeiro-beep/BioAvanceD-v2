/**
 * Script de break-glass (issue #933): limpa mfaLocked/mfaFailedAttempts para
 * UM usuário identificado, sob demanda -- diferente de
 * migrateClearStaleMfaLocks.js (#762), que é uma varredura de todos os
 * usuários travados, para rodar uma única vez em deploy.
 *
 * Por que este script precisa existir: os dois caminhos que hoje limpam
 * mfaLocked ficam inacessíveis quando os usuários travados são
 * administradores.
 *   - POST /:id/reset-mfa (user.routes.js) recusa explicitamente quando o
 *     alvo é administrador (checagem isAdministrator logo após localizar o
 *     usuário-alvo).
 *   - POST /:id/disable-mfa (user.routes.js) exige que quem chama já esteja
 *     autenticado como administrador -- exatamente o que mfaLocked:true
 *     impede (auth.service.js, checagem `if (user.mfaLocked)` antes da
 *     verificação de admin, ~linhas 316-335).
 *   - A permissão resetMFA (rbac-catalog-seed.service.js) é concedida
 *     apenas ao papel Administrador.
 * Se todos os administradores estiverem travados, nada dentro da aplicação
 * destrava ninguém. Este script é o caminho de break-glass para esse caso,
 * rodado por alguém com acesso direto ao banco.
 *
 * Resolução do usuário-alvo: usa buildUserFilterById de
 * src/utils/userFilter.js -- a MESMA função que user.routes.js usa, não uma
 * cópia. A função era interna ao router; foi extraída para o util em #933
 * justamente porque este script não pode importar user.routes.js (que faz
 * `require('express').Router()` e puxa o resto do wiring de aplicação no
 * top-level), e porque duas cópias de uma regra de casamento de usuário em
 * código adjacente a autenticação divergem em silêncio. Note que o
 * identificador aceito é um id (ObjectId/_id/id/userID), não e-mail ou
 * usuário -- o mesmo escopo que user.routes.js já suporta, nada além disso.
 *
 * Campos tocados, mesmo raciocínio de migrateClearStaleMfaLocks.js: apenas
 * mfaLocked e mfaFailedAttempts. mfaEnabled e mfaSecret não são mexidos,
 * para não desabilitar/reabilitar MFA de ninguém.
 *
 * Log de auditoria: NÃO usa src/utils/auditLogger.js. Seu log() depende de
 * src/services/log.service.js, que por sua vez importa ExcelJS,
 * audit-v2.service.js e securityAlerts.service.js -- wiring de aplicação
 * real que um script standalone não tem motivo para carregar por uma única
 * atualização. O registro auditável desta ação deliberada é o próprio
 * stdout: quem foi destravado, por qual identificador.
 *
 * Idempotente: não filtra por mfaLocked:true na busca (ao contrário de
 * migrateClearStaleMfaLocks.js), então localizar o mesmo usuário duas vezes
 * e reaplicar o mesmo $set é seguro -- a segunda execução só confirma que os
 * campos já estão no estado desejado.
 *
 * Uso: node backend/src/scripts/clearMfaLockForUser.js <id|_id|userID>
 * ou, de dentro de api/backend: npm run mfa:clear-lock -- <id|_id|userID>
 *
 * Deliberadamente sem serviço docker-compose (#933): um break-glass que
 * rodasse no boot destravaria em silêncio bloqueios legítimos de força
 * bruta a cada subida da stack. Este script só roda por invocação manual,
 * por alguém com acesso direto ao banco.
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { buildUserFilterById } = require('../utils/userFilter');

async function clearMfaLockForUser(userIdentifier) {
  const rawIdentifier = String(userIdentifier || '').trim();
  if (!rawIdentifier) {
    throw new Error('Identificador do usuário não informado. Uso: clearMfaLockForUser.js <id|_id|userID>');
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

    const db = client.db(dbName);
    const usersCollection = db.collection('users');

    const userFilter = buildUserFilterById(rawIdentifier);
    const targetUser = await usersCollection.findOne(userFilter);

    if (!targetUser) {
      throw new Error(`Nenhum usuário encontrado para o identificador '${rawIdentifier}'. Nenhuma alteração feita.`);
    }

    await usersCollection.updateOne(
      { _id: targetUser._id },
      { $set: { mfaLocked: false, mfaFailedAttempts: 0 } }
    );

    const label = targetUser.email || targetUser.username || targetUser._id.toString();
    console.log(`Desbloqueado: usuário ${targetUser._id.toString()} (${label}) -- mfaLocked=false, mfaFailedAttempts=0`);

    return {
      userId: targetUser._id.toString(),
      email: targetUser.email || null,
      username: targetUser.username || null,
    };
  } catch (error) {
    console.error('Erro ao desbloquear MFA:', error.message);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('Conexão fechada');
    }
  }
}

if (require.main === module) {
  clearMfaLockForUser(process.argv[2])
    .then((result) => {
      console.log(`Desbloqueio finalizado com sucesso para ${result.userId}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Erro ao desbloquear MFA:', error.message);
      process.exit(1);
    });
}

module.exports = { clearMfaLockForUser, buildUserFilterById };
