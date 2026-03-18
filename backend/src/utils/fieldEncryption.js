const crypto = require('crypto');
const env = require('../config/env');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

function resolveKey() {
  const rawKey = String(env.ENCRYPTION_KEY || '').trim();
  if (!rawKey) {
    return null;
  }

  const hash = crypto.createHash('sha256').update(rawKey).digest();
  return hash.subarray(0, KEY_BYTES);
}

function encryptValue(value) {
  const key = resolveKey();
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
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

function decryptValue(payload) {
  const key = resolveKey();
  if (!key || !payload || typeof payload !== 'object') {
    return null;
  }

  const iv = Buffer.from(String(payload.iv || ''), 'base64');
  const tag = Buffer.from(String(payload.tag || ''), 'base64');
  const encrypted = Buffer.from(String(payload.data || ''), 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = {
  encryptValue,
  decryptValue
};