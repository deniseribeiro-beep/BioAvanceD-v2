import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('utils/fieldEncryption', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_ID;
    delete require.cache[require.resolve('../../src/config/keyRegistry.js')];
    delete require.cache[require.resolve('../../src/utils/fieldEncryption.js')];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function loadModule() {
    delete require.cache[require.resolve('../../src/config/keyRegistry.js')];
    delete require.cache[require.resolve('../../src/utils/fieldEncryption.js')];
    return require('../../src/utils/fieldEncryption.js');
  }

  describe('encryptValue', () => {
    it('returns null when no active key is configured', () => {
      const { encryptValue } = loadModule();
      expect(encryptValue('secret')).toBeNull();
    });

    it('returns null for undefined, null, and empty-string values even with a key configured', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const { encryptValue } = loadModule();
      expect(encryptValue(undefined)).toBeNull();
      expect(encryptValue(null)).toBeNull();
      expect(encryptValue('')).toBeNull();
    });

    it('encrypts a value into an envelope carrying alg/v/keyId/iv/tag/data', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const { encryptValue } = loadModule();
      const envelope = encryptValue('hello world');

      expect(envelope).toMatchObject({ alg: 'aes-256-gcm', v: 1, keyId: 'k1' });
      expect(typeof envelope.iv).toBe('string');
      expect(typeof envelope.tag).toBe('string');
      expect(typeof envelope.data).toBe('string');
    });

    it('serializes non-string values (numbers/objects) as JSON before encrypting', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const { encryptValue, decryptValue } = loadModule();
      const envelope = encryptValue({ a: 1, b: [2, 3] });
      expect(decryptValue(envelope)).toEqual({ a: 1, b: [2, 3] });
    });

    it('produces a different iv/ciphertext on each call (no iv reuse)', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const { encryptValue } = loadModule();
      const first = encryptValue('same value');
      const second = encryptValue('same value');
      expect(first.iv).not.toBe(second.iv);
      expect(first.data).not.toBe(second.data);
    });
  });

  describe('decryptValue', () => {
    it('returns null for a null/non-object payload', () => {
      const { decryptValue } = loadModule();
      expect(decryptValue(null)).toBeNull();
      expect(decryptValue(undefined)).toBeNull();
      expect(decryptValue('not-an-object')).toBeNull();
    });

    it('round-trips a value encrypted with the same active key', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const { encryptValue, decryptValue } = loadModule();
      const envelope = encryptValue('round trip me');
      expect(decryptValue(envelope)).toBe('round trip me');
    });

    it('returns null when payload.keyId is unknown to the key registry', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const { encryptValue, decryptValue } = loadModule();
      const envelope = encryptValue('secret');
      envelope.keyId = 'unknown-key-id';
      expect(decryptValue(envelope)).toBeNull();
    });

    it('returns null when decryption fails (bad tag/ciphertext) with a keyId set', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const { encryptValue, decryptValue } = loadModule();
      const envelope = encryptValue('secret');
      envelope.tag = Buffer.from('0000000000000000', 'hex').toString('base64');
      expect(decryptValue(envelope)).toBeNull();
    });

    it('falls back to trying getFallbackKeys() when payload.keyId is absent', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const { encryptValue, decryptValue } = loadModule();
      const envelope = encryptValue('fallback me');
      delete envelope.keyId;
      expect(decryptValue(envelope)).toBe('fallback me');
    });

    it('returns null when no fallback key can decrypt the payload (keyId absent, wrong active key)', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const { encryptValue } = loadModule();
      const envelope = encryptValue('secret');
      delete envelope.keyId;

      process.env.ENCRYPTION_KEY = 'a-completely-different-key';
      delete require.cache[require.resolve('../../src/config/keyRegistry.js')];
      delete require.cache[require.resolve('../../src/utils/fieldEncryption.js')];
      const { decryptValue } = require('../../src/utils/fieldEncryption.js');

      expect(decryptValue(envelope)).toBeNull();
    });

    it('treats missing iv/tag/data on the payload as empty strings rather than throwing', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const { decryptValue } = loadModule();
      expect(decryptValue({ keyId: 'k1' })).toBeNull();
    });
  });
});
