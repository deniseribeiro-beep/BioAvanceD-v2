const crypto = require('crypto');

const KEY_BYTES = 32;

function deriveKey(rawKey) {
  const normalized = String(rawKey || '').trim();
  if (!normalized) return null;
  const hash = crypto.createHash('sha256').update(normalized).digest();
  return hash.subarray(0, KEY_BYTES);
}

function getActiveKeyId() {
  return String(process.env.ENCRYPTION_KEY_ID || 'default').trim();
}

/**
 * #1086: id da chave ANTERIOR, apenas para decriptação.
 *
 * Sem default deliberado, ao contrário de getActiveKeyId. Um default aqui
 * ('default', ou o id ativo) inventaria uma identidade para uma chave cuja
 * identidade é justamente o que precisa casar com o `keyId` gravado nos
 * envelopes antigos -- e casar errado é pior que não casar, porque
 * getKeyById devolveria a chave errada e tryDecryptWithKey falharia no
 * auth tag do AES-GCM, ou seja, exatamente o null silencioso que este
 * issue existe para eliminar. Sem id, não há slot.
 */
function getPreviousKeyId() {
  const raw = String(process.env.ENCRYPTION_KEY_PREVIOUS_ID || '').trim();
  return raw || null;
}

/**
 * #1086: a chave ativa (que cifra e decifra) mais, opcionalmente, uma chave
 * anterior SOMENTE de decriptação.
 *
 * Antes disto a lista tinha no máximo um elemento, então rotacionar
 * ENCRYPTION_KEY transformava todo envelope já gravado num decryptValue
 * null, silenciosamente: encryptValue sempre carimba um keyId (#1083), então
 * decryptValue sempre entra pelo ramo getKeyById e nunca alcança o laço de
 * fallback. RNF020 AC#5 exige que segredos possam ser "rotacionados sem
 * alteração de código" -- com um slot só, rotacionar exigia justamente a
 * alteração de código que o critério proíbe.
 *
 * O slot é DECRYPT-ONLY por construção: isActive: false, e getActiveKey
 * procura por isActive, então uma chave anterior sozinha nunca faz o sistema
 * voltar a cifrar. É essa propriedade que mantém o gate de #1085 honesto --
 * ENCRYPTION_KEY em branco continua sendo "não há criptografia", com ou sem
 * slot anterior preenchido.
 *
 * O laço de dedup por hex em getFallbackKeys e o getKeyById por id já
 * existiam para esta forma; o slot é o que faz os dois deixarem de ser
 * maquinaria morta.
 *
 * Roteiro de rotação, sem tocar em código:
 *   1. ENCRYPTION_KEY_PREVIOUS / _PREVIOUS_ID  <- o par atual
 *   2. ENCRYPTION_KEY / ENCRYPTION_KEY_ID      <- o par novo
 *   3. reiniciar; envelopes novos saem sob a chave nova, os antigos ainda
 *      decifram
 *
 *   4. (#1103) `npm run encryption:rewrite -- --apply` recifra todo campo
 *      de utils/encryptedFieldRegistry.js sob a chave nova e rederiva os
 *      indices cegos; depois, `npm run encryption:rewrite` (simulacao) e
 *      esvaziar o slot SOMENTE quando ele imprimir
 *      "safeToEmptyPreviousSlot": true.
 *
 * Esvaziar o slot e IRREVERSIVEL para o que ainda estiver sob a chave
 * antiga: os envelopes passam a decifrar como null, silenciosamente, e
 * desde #1099 os indices cegos vao junto -- identityDocumentHash/
 * birthDateHash sao casados sob TODA chave registrada, entao um valor
 * indexado antes da rotacao deixa de casar, e uma identidade nao casada
 * gera participante DUPLICADO em vez de erro. A simulacao tambem conta
 * linhas de arquivo (encryptionKeyId) sob a chave antiga: a reescrita
 * recifra os binarios de DataFile guardados no Object Storage e ainda so
 * conta as demais linhas de arquivo.
 */
function getKeyEntries() {
  const entries = [];

  const activeKey = deriveKey(process.env.ENCRYPTION_KEY);
  const activeKeyId = getActiveKeyId();
  if (activeKey) {
    entries.push({ keyId: activeKeyId, key: activeKey, isActive: true });
  }

  const previousKey = deriveKey(process.env.ENCRYPTION_KEY_PREVIOUS);
  const previousKeyId = getPreviousKeyId();
  // A colisão de id é descartada em vez de empurrada: getKeyById devolve a
  // PRIMEIRA entrada que casa, e a ativa é empilhada antes, então um slot
  // anterior com o mesmo id nunca poderia ser alcançado de qualquer forma.
  // Descartar aqui torna isso explícito -- e #1085 avisa sobre a configuração
  // no boot, que é onde o operador consegue agir sobre ela.
  if (previousKey && previousKeyId && previousKeyId !== activeKeyId) {
    entries.push({ keyId: previousKeyId, key: previousKey, isActive: false });
  }

  return entries;
}

function getActiveKey() {
  const active = getKeyEntries().find((entry) => entry.isActive);
  return active ? active.key : null;
}

function getKeyById(keyId) {
  if (!keyId) return null;
  const normalized = String(keyId).trim();
  const entry = getKeyEntries().find((item) => item.keyId === normalized);
  return entry ? entry.key : null;
}

function getFallbackKeys() {
  const entries = getKeyEntries();
  const seen = new Set();
  const keys = [];

  for (const entry of entries) {
    const hash = entry.key.toString('hex');
    if (!seen.has(hash)) {
      seen.add(hash);
      keys.push(entry.key);
    }
  }

  return keys;
}

module.exports = {
  getActiveKeyId,
  getPreviousKeyId,
  getActiveKey,
  getKeyById,
  getFallbackKeys,
  getKeyEntries
};
