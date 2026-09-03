const crypto = require('crypto');
const { readFile } = require('fs/promises');
const env = require('../config/env');

const SIGNATURE_ALGORITHM = 'ED25519';
const HASH_ALGORITHM = 'SHA-256';
const MERKLE_ALGORITHM = 'BIOAVANCED-MERKLE-V2';

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSort(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted = {};
  Object.keys(value).sort().forEach((key) => {
    sorted[key] = stableSort(value[key]);
  });
  return sorted;
}

function canonicalStringify(value) {
  return JSON.stringify(stableSort(value));
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function sha256Base64(input) {
  return crypto.createHash('sha256').update(String(input)).digest('base64');
}

function parsePublicKeyRegistry() {
  const raw = String(env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (error) {
    return {};
  }
}

class MerkleEnvelopeService {
  getActiveKeyId() {
    return String(env.AUDIT_MERKLE_SIGN_KEY_ID || '').trim();
  }

  getPrivateKeyPem() {
    const file = String(env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE || '').trim();
    if (file) {
      return readFile(file, 'utf8').then((content) => String(content || '').trim());
    }

    throw new Error('Audit signing key must be provided via AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE');
  }

  getPublicKeyPemById(keyId) {
    const registry = parsePublicKeyRegistry();
    return String(registry[keyId] || '').trim() || null;
  }

  getPublicKeyFingerprint(publicKeyPem) {
    return sha256Hex(String(publicKeyPem || ''));
  }

  buildCanonicalEnvelope({ date, root, treeSize, previousAnchorHash = null, generatedAt = null }) {
    return {
      schemaVersion: 2,
      date,
      root,
      treeSize,
      hashAlgorithm: HASH_ALGORITHM,
      merkleAlgorithm: MERKLE_ALGORITHM,
      previousAnchorHash,
      generatedAt: generatedAt || new Date().toISOString(),
      keyId: this.getActiveKeyId(),
    };
  }

  async signEnvelope(envelope) {
    const privateKeyPem = await this.getPrivateKeyPem();
    const keyId = this.getActiveKeyId();
    if (!privateKeyPem || !keyId) {
      throw new Error('Audit signing key is not configured');
    }
    const payload = canonicalStringify(envelope);
    const signature = crypto.sign(null, Buffer.from(payload), privateKeyPem).toString('base64');
    const publicKeyPem = this.getPublicKeyPemById(keyId);

    return {
      envelope,
      signature,
      signatureAlgorithm: SIGNATURE_ALGORITHM,
      keyId,
      publicKeyFingerprint: publicKeyPem ? this.getPublicKeyFingerprint(publicKeyPem) : null,
      envelopeDigestSha256: sha256Hex(payload),
      envelopeDigestBase64: sha256Base64(payload),
    };
  }

  verifyEnvelopeSignature({ envelope, signature, signatureAlgorithm, keyId, publicKeyFingerprint }) {
    if (!envelope || !signature || !keyId) {
      return { ok: false, reason: 'missing_signature_material' };
    }
    if ((signatureAlgorithm || '').toUpperCase() !== SIGNATURE_ALGORITHM) {
      return { ok: false, reason: 'unsupported_signature_algorithm' };
    }

    const publicKeyPem = this.getPublicKeyPemById(keyId);
    if (!publicKeyPem) {
      return { ok: false, reason: 'unknown_key_id' };
    }

    const expectedFingerprint = this.getPublicKeyFingerprint(publicKeyPem);
    if (publicKeyFingerprint && expectedFingerprint !== publicKeyFingerprint) {
      return { ok: false, reason: 'public_key_fingerprint_mismatch' };
    }

    let verified = false;
    try {
      verified = crypto.verify(null, Buffer.from(canonicalStringify(envelope)), publicKeyPem, Buffer.from(signature, 'base64'));
    } catch (error) {
      return { ok: false, reason: 'invalid_signature_format' };
    }

    return {
      ok: Boolean(verified),
      reason: verified ? null : 'signature_verification_failed',
      keyId,
      publicKeyFingerprint: expectedFingerprint,
      envelopeDigestSha256: sha256Hex(canonicalStringify(envelope)),
      envelopeDigestBase64: sha256Base64(canonicalStringify(envelope)),
    };
  }

  fromPersistedRoot(rootDoc) {
    if (!rootDoc) return null;
    if (rootDoc.schemaVersion === 2 && rootDoc.envelope) {
      return {
        schemaVersion: 2,
        envelope: rootDoc.envelope,
        signature: rootDoc.signature,
        signatureAlgorithm: rootDoc.signatureAlgorithm,
        keyId: rootDoc.keyId,
        publicKeyFingerprint: rootDoc.publicKeyFingerprint,
      };
    }

    return {
      schemaVersion: 1,
      envelope: {
        schemaVersion: 1,
        date: rootDoc.date,
        root: rootDoc.root,
        treeSize: rootDoc.treeSize || 0,
        hashAlgorithm: HASH_ALGORITHM,
        merkleAlgorithm: 'BIOAVANCED-MERKLE-V1',
        previousAnchorHash: rootDoc.previousRootHash || null,
        generatedAt: rootDoc.createdAt ? new Date(rootDoc.createdAt).toISOString() : null,
        keyId: null,
      },
      signature: null,
      signatureAlgorithm: null,
      keyId: null,
      publicKeyFingerprint: null,
      legacyV1: true,
    };
  }
}

module.exports = new MerkleEnvelopeService();
module.exports.canonicalStringify = canonicalStringify;
module.exports.stableSort = stableSort;
