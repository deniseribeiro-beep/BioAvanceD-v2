const crypto = require('crypto');
const keyRegistry = require('../config/keyRegistry');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';

function encryptValue(value) {
  const key = keyRegistry.getActiveKey();
  const keyId = keyRegistry.getActiveKeyId();
  if (!key) {
    logger.warn('[SECURITY][AES256] ENCRYPTION_KEY ausente. Campo sensível armazenado sem criptografia.');
    return null;
  }

  if (value === undefined || value === null || value === '') {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(value);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: ALGORITHM,
    v: 1,
    keyId,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

function tryDecryptWithKey(key, payload) {
  const iv = Buffer.from(String(payload.iv || ''), 'base64');
  const tag = Buffer.from(String(payload.tag || ''), 'base64');
  const encrypted = Buffer.from(String(payload.data || ''), 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

function decryptValue(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const keyId = payload.keyId ? String(payload.keyId).trim() : null;

  if (keyId) {
    const key = keyRegistry.getKeyById(keyId);
    if (!key) {
      logger.warn(`[SECURITY][AES256] keyId desconhecido para decriptação: ${keyId}`);
      return null;
    }

    try {
      return tryDecryptWithKey(key, payload);
    } catch (_) {
      return null;
    }
  }

  const fallbackKeys = keyRegistry.getFallbackKeys();
  for (const key of fallbackKeys) {
    try {
      return tryDecryptWithKey(key, payload);
    } catch (_) {
      continue;
    }
  }

  return null;
}

// RF005/RNF007 (#574): deterministic blind index for fields ciphertext can't
// be queried on directly (Mongo can't $eq/$gte-range against AES-GCM output).
// Keyed with the same active encryption key so index values are only
// reproducible by holders of that key, but exact-match only by design --
// this is not a substitute for encryptValue's semantic confidentiality.
function hmacBlindIndex(value) {
  const key = keyRegistry.getActiveKey();
  if (!key) {
    logger.warn('[SECURITY][AES256] ENCRYPTION_KEY ausente. Índice cego não gerado.');
    return null;
  }

  if (value === undefined || value === null || value === '') {
    return null;
  }

  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}

module.exports = {
  encryptValue,
  decryptValue,
  hmacBlindIndex
};