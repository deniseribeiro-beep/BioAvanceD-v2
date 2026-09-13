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

/**
 * #1100: the keyed branch tries EVERY registered key before giving up.
 *
 * getKeyById matches on the id ALONE, and #1086's registry stacks the
 * active entry first, so an operator who rotates ENCRYPTION_KEY while
 * KEEPING ENCRYPTION_KEY_ID makes every pre-rotation envelope resolve to
 * the NEW key: the AES-GCM auth tag fails, and the previous key -- sitting
 * right there in the registry -- is never tried. It is the one rotation
 * shape that produced no diagnostic at all.
 *
 * #1086's boot gate reports [] for that configuration and is RIGHT to:
 * whether it is wrong depends on the keyIds stamped on rows in the
 * database, which no boot-time check can know. Warning harder was never
 * available, which is why this is a decrypt change and not a validateEnv
 * one.
 *
 * Safe by construction: AES-GCM authenticates, so a wrong key cannot yield
 * a wrong plaintext -- it can only throw. The loop is bounded by
 * CONFIGURATION (getFallbackKeys returns at most the active key plus the
 * previous slot, deduped by hex), not by anything a caller supplies, and
 * it runs only on a decrypt that returns null today. That is what
 * separates it from the CPU amplification #1036/#952 refused, which was a
 * bcrypt round per unauthenticated REQUEST -- attacker-triggerable,
 * unbounded in rate, and deliberately slow per unit. None of those three
 * holds here.
 *
 * exclude skips the key the caller already tried, so the keyed branch does
 * not re-attempt the entry getKeyById just returned.
 */
function decryptWithFallbackKeys(payload, exclude) {
  for (const key of keyRegistry.getFallbackKeys()) {
    if (exclude && key.equals(exclude)) continue;

    try {
      return tryDecryptWithKey(key, payload);
    } catch (_) {
      continue;
    }
  }

  return null;
}

function decryptValue(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const keyId = payload.keyId ? String(payload.keyId).trim() : null;

  if (keyId) {
    const key = keyRegistry.getKeyById(keyId);
    // #1100: an UNKNOWN keyId stays fail-closed here rather than falling
    // through. No configured key claims that id, the operator already gets
    // a diagnostic, and widening this branch is not what the issue is
    // about -- the silent case is the id that RESOLVES, to the wrong key.
    if (!key) {
      logger.warn(`[SECURITY][AES256] keyId desconhecido para decriptação: ${keyId}`);
      return null;
    }

    try {
      return tryDecryptWithKey(key, payload);
    } catch (_) {
      return decryptWithFallbackKeys(payload, key);
    }
  }

  return decryptWithFallbackKeys(payload, null);
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
 * #1099: every candidate hash for a value, one per registered key.
 *
 * hmacBlindIndex stores a BARE hex string with no keyId, so #1086's
 * previous-key slot has nothing to dispatch on: after a rotation, rows
 * written earlier hold a hash under the old key and nothing on the stored
 * value says so. decryptValue's remedy (#1100) is structurally unavailable
 * here -- there is no keyId to look up, and re-deriving the old hash would
 * need the plaintext, at which point you are doing #1101's migration.
 *
 * So the query side asks for ALL of them and matches on any. The active key
 * is first, because getKeyEntries stacks it first, and getFallbackKeys
 * already dedups by key material -- so a previous slot holding the same key
 * costs nothing, and [0] is always the key new writes use.
 *
 * This makes the blind index behave exactly like the envelope under
 * rotation: both survive while the previous slot is populated, and both stop
 * matching once it is emptied. One rotation story rather than two.
 *
 * RNF020 AC#5 requires secrets be rotatable "sem alteracao de codigo".
 * Before this, rotating ENCRYPTION_KEY silently broke identity matching --
 * and the bad failure is not an error but a MISSED dedup, which creates a
 * duplicate participant record: a data-integrity fault in exactly the domain
 * RF005/RNF007 govern. Masked today by the plaintext arm of each caller's
 * $or, which is precisely what #574/#1072 exist to remove.
 *
 * WRITES stay on hmacBlindIndex (active key only). Only queries fan out.
 */
function hmacBlindIndexCandidates(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  const keys = keyRegistry.getFallbackKeys();
  if (!keys.length) {
    logger.warn('[SECURITY][AES256] ENCRYPTION_KEY ausente. Índice cego não gerado.');
    return [];
  }

  return keys.map((key) => crypto.createHmac('sha256', key).update(String(value)).digest('hex'));
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
  hmacBlindIndexCandidates,
  isFieldEncryptionAvailable,
  assertFieldEncryptionConfigured
};