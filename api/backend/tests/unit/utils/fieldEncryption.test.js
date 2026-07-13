import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';

const require = createRequire(import.meta.url);

const keyRegistry = require('../../../src/config/keyRegistry');
const logger = require('../../../src/utils/logger');
const { encryptValue, decryptValue } = require('../../../src/utils/fieldEncryption');

const KEY_A = crypto.createHash('sha256').update('key-a').digest().subarray(0, 32);
const KEY_B = crypto.createHash('sha256').update('key-b').digest().subarray(0, 32);

describe('fieldEncryption', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('encryptValue', () => {
    it('returns null and logs a warning when no active key is configured', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(null);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('default');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const result = encryptValue('secret');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY ausente'));
    });

    it.each([undefined, null, ''])('returns null for empty-ish value %p when a key is present', (value) => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');

      expect(encryptValue(value)).toBeNull();
    });

    it('encrypts a value into a payload with alg/v/keyId/iv/tag/data', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');

      const result = encryptValue({ ssn: '123-45-6789' });

      expect(result).toMatchObject({ alg: 'aes-256-gcm', v: 1, keyId: 'k1' });
      expect(typeof result.iv).toBe('string');
      expect(typeof result.tag).toBe('string');
      expect(typeof result.data).toBe('string');
    });

    it('encrypts falsy-but-defined values like 0 and false', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');

      expect(encryptValue(0)).not.toBeNull();
      expect(encryptValue(false)).not.toBeNull();
    });
  });

  describe('decryptValue', () => {
    it('returns null for non-object payloads', () => {
      expect(decryptValue(null)).toBeNull();
      expect(decryptValue(undefined)).toBeNull();
      expect(decryptValue('string-payload')).toBeNull();
      expect(decryptValue(42)).toBeNull();
    });

    it('round-trips a value encrypted with the active key', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
      vi.spyOn(keyRegistry, 'getKeyById').mockImplementation((id) => (id === 'k1' ? KEY_A : null));

      const payload = encryptValue({ msg: 'hello' });
      const result = decryptValue(payload);

      expect(result).toEqual({ msg: 'hello' });
    });

    it('logs and returns null when keyId is unknown', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
      vi.spyOn(keyRegistry, 'getKeyById').mockReturnValue(null);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const payload = encryptValue({ msg: 'hello' });
      const result = decryptValue({ ...payload, keyId: 'unknown-key' });

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown-key'));
    });

    it('returns null when decryption fails (tampered payload) with a known keyId', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
      vi.spyOn(keyRegistry, 'getKeyById').mockImplementation((id) => (id === 'k1' ? KEY_A : null));

      const payload = encryptValue({ msg: 'hello' });
      const tampered = { ...payload, data: Buffer.from('not-valid-ciphertext').toString('base64') };

      expect(decryptValue(tampered)).toBeNull();
    });

    it('falls back to trying fallback keys when payload has no keyId', () => {
      vi.spyOn(keyRegistry, 'getFallbackKeys').mockReturnValue([KEY_B, KEY_A]);

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', KEY_A, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ legacy: true }), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      const payload = {
        alg: 'aes-256-gcm',
        v: 1,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64')
      };

      const result = decryptValue(payload);

      expect(result).toEqual({ legacy: true });
    });

    it('returns null when no fallback key can decrypt the payload', () => {
      vi.spyOn(keyRegistry, 'getFallbackKeys').mockReturnValue([KEY_B]);

      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', KEY_A, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify({ legacy: true }), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      const payload = {
        alg: 'aes-256-gcm',
        v: 1,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64')
      };

      expect(decryptValue(payload)).toBeNull();
    });

    it('trims a keyId with surrounding whitespace before lookup', () => {
      vi.spyOn(keyRegistry, 'getActiveKey').mockReturnValue(KEY_A);
      vi.spyOn(keyRegistry, 'getActiveKeyId').mockReturnValue('k1');
      vi.spyOn(keyRegistry, 'getKeyById').mockImplementation((id) => (id === 'k1' ? KEY_A : null));

      const payload = encryptValue({ msg: 'hello' });
      const result = decryptValue({ ...payload, keyId: '  k1  ' });

      expect(result).toEqual({ msg: 'hello' });
    });
  });
});
