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

/**
 * #938: the explicit, deliberate opt-out from encryption-at-rest for
 * uploads. Deliberately NOT a truthy check -- only the exact string 'true'
 * disables the requirement, so a stray '1'/'yes' in an env file cannot
 * silently turn plaintext storage back on. Absent by default, which is what
 * makes the shipped templates' blank ENCRYPTION_KEY a loud failure instead
 * of a silent one.
 */
const UNENCRYPTED_STORAGE_OPT_OUT = 'ALLOW_UNENCRYPTED_FILE_STORAGE';

function unencryptedStorageAllowed() {
  return process.env[UNENCRYPTED_STORAGE_OPT_OUT] === 'true';
}

/** #938: whether a key is configured at all -- no side effects, no throw. */
function isFileEncryptionAvailable() {
  return Boolean(keyRegistry.getActiveKey());
}

/**
 * #938: fail closed before an upload can write plaintext to disk.
 *
 * RNF029 AC#5 -- "Criptografia, retenção e ciclo de vida seguem a
 * classificação do dado" -- makes encryption policy-driven rather than
 * unconditional, and the standing classification for scientific files is
 * encrypted at rest (#566). So the correct behaviour when a key is missing
 * is to refuse the operation, not to degrade to plaintext and report
 * success.
 *
 * This mirrors #734's `assertEncryptionKeyConfigured` in backup.service,
 * for the same reason and by the same means: `encryptFileBuffer` keeps
 * returning `null` (that is right for backup.service, whose own guard is
 * written against it), and the callers that must not degrade check up
 * front instead.
 *
 * Throws with `statusCode` 500 -- a keyless deployment is a server
 * misconfiguration, not a bad request, and the uploader can do nothing
 * about it.
 */
function assertFileEncryptionConfigured() {
  if (isFileEncryptionAvailable() || unencryptedStorageAllowed()) return;

  const error = new Error(
    '[SECURITY][AES256] ENCRYPTION_KEY nao configurada: upload recusado para nao gravar '
      + 'arquivo em texto claro em repouso (RNF029 AC#5, #938). Configure ENCRYPTION_KEY, ou '
      + `defina ${UNENCRYPTED_STORAGE_OPT_OUT}=true para aceitar armazenamento sem criptografia.`
  );
  error.statusCode = 500;
  throw error;
}

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
  UNENCRYPTED_STORAGE_OPT_OUT,
  isFileEncryptionAvailable,
  assertFileEncryptionConfigured,
  encryptFileBuffer,
  decryptFileBuffer,
  computeChecksum
};
