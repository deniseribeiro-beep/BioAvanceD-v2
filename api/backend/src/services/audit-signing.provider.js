const { readFile } = require('fs/promises');
const crypto = require('crypto');
const env = require('../config/env');

class AuditSigningProvider {
  async loadPrivateKey() {
    const file = String(env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE || '').trim();
    if (!file) throw new Error('AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE não configurado');
    return readFile(file, 'utf8');
  }

  getKeyId() {
    const keyId = String(env.AUDIT_MERKLE_SIGN_KEY_ID || '').trim();
    if (!keyId) throw new Error('AUDIT_MERKLE_SIGN_KEY_ID não configurado');
    return keyId;
  }

  getPublicKeyRegistry() {
    const raw = String(env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON || '').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }

  getPublicKeyPem(keyId = this.getKeyId()) {
    return String(this.getPublicKeyRegistry()[keyId] || '').trim() || null;
  }

  getPublicKeyIdFingerprint(keyId = this.getKeyId()) {
    const publicKeyPem = this.getPublicKeyPem(keyId);
    if (!publicKeyPem) return null;
    return crypto.createHash('sha256').update(publicKeyPem).digest('hex');
  }

  async sign(bytes) {
    const privateKey = await this.loadPrivateKey();
    const keyId = this.getKeyId();
    const signature = crypto.sign(null, bytes, privateKey).toString('base64');
    return {
      signature,
      signatureAlgorithm: 'Ed25519',
      keyId,
      publicKeyFingerprint: this.getPublicKeyIdFingerprint(keyId),
    };
  }

  verify(bytes, signatureBase64, keyId = this.getKeyId()) {
    const publicKeyPem = this.getPublicKeyPem(keyId);
    if (!publicKeyPem) return { ok: false, reason: 'unknown_key_id' };
    const signature = Buffer.from(String(signatureBase64 || ''), 'base64');
    const ok = crypto.verify(null, bytes, publicKeyPem, signature);
    return { ok, reason: ok ? null : 'signature_verification_failed' };
  }
}

module.exports = new AuditSigningProvider();
