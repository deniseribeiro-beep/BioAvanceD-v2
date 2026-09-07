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

/**
 * #1083: the explicit, deliberate opt-out from field encryption at rest.
 * Deliberately NOT a truthy check -- only the exact string 'true' disables
 * the requirement, so a stray '1'/'yes' in an env file cannot silently turn
 * plaintext storage back on. Absent by default, which is what makes the
 * shipped templates' blank ENCRYPTION_KEY a loud failure instead of a
 * silent one. Separate from #938's ALLOW_UNENCRYPTED_FILE_STORAGE because
 * files and fields carry different data classifications (RNF029 AC#5), so
 * accepting plaintext blobs must not also accept plaintext civil identity.
 */
const UNENCRYPTED_FIELD_OPT_OUT = 'ALLOW_UNENCRYPTED_FIELD_STORAGE';

function unencryptedFieldStorageAllowed() {
  return process.env[UNENCRYPTED_FIELD_OPT_OUT] === 'true';
}

/** #1083: whether a key is configured at all -- no side effects, no throw. */
function isFieldEncryptionAvailable() {
  return Boolean(keyRegistry.getActiveKey());
}

/**
 * #1083: fail closed before a caller can persist a sensitive field in
 * plaintext.
 *
 * encryptValue returns null with a single warn when no key is configured,
 * and every caller reads that null as "skip this field" -- with the
 * plaintext-clearing step inside the if. So a keyless stack wrote no
 * ciphertext, kept the plaintext, and still answered 201.
 *
 * RNF020 AC#3 and RNF007 make encryption at rest the standing
 * classification for civil-identity and clinical values, so the correct
 * behaviour when a key is missing is to refuse the write, not to degrade
 * to plaintext and report success.
 *
 * This mirrors #938's assertFileEncryptionConfigured (fileCrypto.js) and
 * #734's assertEncryptionKeyConfigured (backup.service.js), for the same
 * reason and by the same means: encryptValue keeps returning null -- that
 * is right for participantIdentity.service, whose map is deliberately
 * additive pending #574 -- and the callers that must not degrade check up
 * front instead.
 *
 * Takes the value so encryptValue's empty-input contract lives in one
 * file: '', null and undefined return null with or without a key, so no
 * plaintext survives and there is nothing to refuse. 0 and false DO
 * encrypt, so they are gated.
 *
 * Throws with statusCode 500 -- a keyless deployment is a server
 * misconfiguration, not a bad request, and the caller can do nothing
 * about it.
 */
function assertFieldEncryptionConfigured(value) {
  if (value === undefined || value === null || value === '') return;
  if (isFieldEncryptionAvailable() || unencryptedFieldStorageAllowed()) return;

  const error = new Error(
    '[SECURITY][AES256] ENCRYPTION_KEY nao configurada: gravacao recusada para nao persistir '
      + 'campo sensivel em texto claro em repouso (RNF020 AC#3, #1083). Configure ENCRYPTION_KEY, '
      + `ou defina ${UNENCRYPTED_FIELD_OPT_OUT}=true para aceitar armazenamento sem criptografia.`
  );
  error.statusCode = 500;
  throw error;
}

module.exports = {
  encryptValue,
  decryptValue,
  hmacBlindIndex,
  isFieldEncryptionAvailable,
  assertFieldEncryptionConfigured
};