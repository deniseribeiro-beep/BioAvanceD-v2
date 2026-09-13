/**
 * Resolução de um usuário por identificador, compartilhada entre
 * user.routes.js e os scripts de manutenção em src/scripts/.
 *
 * Extraída de user.routes.js em #933. Antes disso a função era interna ao
 * router, e o script de break-glass clearMfaLockForUser.js precisou
 * reproduzi-la -- um script standalone não pode importar user.routes.js sem
 * puxar `express.Router()` e o resto do wiring de aplicação junto. Duas
 * cópias de uma regra de casamento de usuário em código adjacente a
 * autenticação divergem silenciosamente: se esta aqui for endurecida por um
 * motivo de segurança, a cópia do script continuaria com o comportamento
 * antigo. Este módulo não importa nada além de `mongodb`, então serve aos
 * dois chamadores.
 *
 * O identificador aceito é sempre um id -- ObjectId, _id cru, campo `id`, ou
 * userID como string e como número. Nunca e-mail ou nome de usuário.
 */

const { ObjectId } = require('mongodb');

function buildUserFilterById(id) {
  const rawId = String(id || '').trim();
  const filters = [];

  if (!rawId) {
    return { _id: null };
  }

  if (ObjectId.isValid(rawId)) {
    filters.push({ _id: new ObjectId(rawId) });
  }

  filters.push({ _id: rawId });
  filters.push({ id: rawId });
  filters.push({ userID: rawId });

  const numericId = Number(rawId);
  if (Number.isFinite(numericId)) {
    filters.push({ userID: numericId });
  }

  return { $or: filters };
}

module.exports = { buildUserFilterById };
