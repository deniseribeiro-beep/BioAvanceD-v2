const { readFile } = require('fs/promises');
const { readFileSync } = require('fs');
const crypto = require('crypto');
const env = require('../config/env');
const log = require('../utils/logger');

// Warn once per path, not once per call: getPublicKeyRegistry() is reached from
// every sign() and every verify(), and processTimestampBacklog loops over 50.
const warnedRegistryFiles = new Set();

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

  /**
   * #1157: returns the registry's raw JSON text, from the file when one is
   * configured and readable, otherwise from the env var. Kept separate from
   * the parse so merkle-envelope.service can share the source while keeping
   * its own (deliberately different) posture on malformed JSON.
   */
  readPublicKeyRegistrySource() {
    const file = String(env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE || '').trim();
    if (file) {
      try {
        return readFileSync(file, 'utf8').trim();
      } catch (error) {
        // Fall back rather than throw: signing does not need the registry, and
        // taking it down here would trade a verification gap for an outage.
        // #1154 owns making this audible at boot instead of at first use.
        if (!warnedRegistryFiles.has(file)) {
          warnedRegistryFiles.add(file);
          log.warn(
            `AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE (${file}) não pôde ser lido (${error.code || error.message}); ` +
              'usando AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON. Raízes assinadas só serão verificadas se esse registro contiver a chave ativa.'
          );
        }
      }
    }
    return String(env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON || '').trim();
  }

  getPublicKeyRegistry() {
    const raw = this.readPublicKeyRegistrySource();
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
