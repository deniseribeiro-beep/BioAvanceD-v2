const crypto = require('crypto');
const logger = require('./logger');
const keyRegistry = require('../config/keyRegistry');

/**
 * RF007/RNF029 -- encrypts a file's plaintext bytes at rest (Object
 * Storage integrity) using the same key registry fieldEncryption.js
 * already relies on for sensitive field values, adapted for binary
 * payloads. Extracted from sample-file.controller.js (#643) so the
 * scientific-file linkage controllers (Assay/Dataset) reuse the exact
 * same crypto path instead of a second implementation.
 */
const FILE_ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function encryptFileBuffer(buffer) {
  const key = keyRegistry.getActiveKey();
  const keyId = keyRegistry.getActiveKeyId();
  if (!key) {
    logger.warn('[SECURITY][AES256] ENCRYPTION_KEY ausente. Arquivo armazenado sem criptografia em repouso.');
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(FILE_ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: FILE_ENCRYPTION_ALGORITHM,
    keyId,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext
  };
}

function decryptFileBuffer(ciphertext, envelope) {
  const key = keyRegistry.getKeyById(envelope.encryptionKeyId);
  if (!key) {
    throw new Error(`Chave de criptografia desconhecida: ${envelope.encryptionKeyId}`);
  }

  const iv = Buffer.from(String(envelope.encryptionIv || ''), 'base64');
  const tag = Buffer.from(String(envelope.encryptionTag || ''), 'base64');
  const decipher = crypto.createDecipheriv(FILE_ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function computeChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  FILE_ENCRYPTION_ALGORITHM,
  encryptFileBuffer,
  decryptFileBuffer,
  computeChecksum
};
