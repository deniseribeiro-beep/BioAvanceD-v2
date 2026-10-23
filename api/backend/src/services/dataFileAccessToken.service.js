const crypto = require('crypto');
const env = require('../config/env');
const { constantTimeSecretEquals } = require('../utils/secretCompare');

// RNF029 C5 (#1321): "Usar acesso temporário ou mecanismo equivalente,
// auditado." A DataFile download is a short-lived, single-file signed token:
// `base64url(JSON payload) + '.' + base64url(HMAC-SHA256)`. It is never a
// JWT, and its key is derived from JWT_SECRET under its own label, so the
// session middleware can never accept one as a session.
const FILE_ACCESS_TOKEN_TTL_SECONDS = 60;
const KEY_LABEL = 'bioavanced:data-file-access-token:v1';
const MAX_TOKEN_LENGTH = 2048;
const TOKEN_PART_PATTERN = /^[A-Za-z0-9_-]+$/;
const FILE_ID_PATTERN = /^[0-9a-f]{24}$/;

const FILE_ACCESS_COLLECTIONS = Object.freeze({
  sample_files: 'SampleFile',
  assayFiles: 'AssayFile',
  datasetFiles: 'DatasetFile'
});

function isAllowedCollection(collection) {
  return typeof collection === 'string'
    && Object.prototype.hasOwnProperty.call(FILE_ACCESS_COLLECTIONS, collection);
}

// Fails closed: with no JWT_SECRET there is no key, so nothing is issued and
// nothing verifies.
function deriveKey() {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET não configurado: token de acesso a arquivo indisponível.');
  }
  return crypto.createHmac('sha256', env.JWT_SECRET).update(KEY_LABEL).digest();
}

function sign(key, encodedPayload) {
  return crypto.createHmac('sha256', key).update(encodedPayload).digest('base64url');
}

function issueFileAccessToken({ collection, fileRecord, userId, now = Date.now(), ttlSeconds = FILE_ACCESS_TOKEN_TTL_SECONDS }) {
  if (!isAllowedCollection(collection)) {
    throw new Error(`Coleção sem token de acesso a arquivo: ${collection}`);
  }
  const key = deriveKey();
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = {
    v: 1,
    c: collection,
    f: fileRecord._id.toHexString ? fileRecord._id.toHexString() : String(fileRecord._id),
    u: fileRecord.storageUri || null,
    s: userId || null,
    j: crypto.randomBytes(16).toString('hex'),
    exp
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return {
    token: `${encodedPayload}.${sign(key, encodedPayload)}`,
    tokenId: payload.j,
    expiresAt: new Date(exp * 1000)
  };
}

function verifyFileAccessToken(token, { now = Date.now() } = {}) {
  const invalid = { ok: false, reason: 'invalid' };
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return invalid;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => TOKEN_PART_PATTERN.test(part))) return invalid;

  const [encodedPayload, signature] = parts;
  if (!constantTimeSecretEquals(signature, sign(deriveKey(), encodedPayload))) return invalid;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (_) {
    return invalid;
  }
  if (!payload || typeof payload !== 'object'
    || payload.v !== 1
    || !isAllowedCollection(payload.c)
    || typeof payload.f !== 'string' || !FILE_ID_PATTERN.test(payload.f)
    || !Number.isInteger(payload.exp)) {
    return invalid;
  }
  if (Math.floor(now / 1000) >= payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

module.exports = {
  FILE_ACCESS_TOKEN_TTL_SECONDS,
  FILE_ACCESS_COLLECTIONS,
  issueFileAccessToken,
  verifyFileAccessToken
};
