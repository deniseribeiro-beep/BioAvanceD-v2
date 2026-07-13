import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('config/keyRegistry', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_ID;
    delete require.cache[require.resolve('../../src/config/keyRegistry.js')];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function loadModule() {
    delete require.cache[require.resolve('../../src/config/keyRegistry.js')];
    return require('../../src/config/keyRegistry.js');
  }

  describe('getActiveKeyId', () => {
    it('returns "default" when ENCRYPTION_KEY_ID is not set', () => {
      const keyRegistry = loadModule();
      expect(keyRegistry.getActiveKeyId()).toBe('default');
    });

    it('returns the trimmed value of ENCRYPTION_KEY_ID when set', () => {
      process.env.ENCRYPTION_KEY_ID = '  my-key-id  ';
      const keyRegistry = loadModule();
      expect(keyRegistry.getActiveKeyId()).toBe('my-key-id');
    });
  });

  describe('getKeyEntries', () => {
    it('returns an empty array when ENCRYPTION_KEY is unset', () => {
      const keyRegistry = loadModule();
      expect(keyRegistry.getKeyEntries()).toEqual([]);
    });

    it('returns an empty array when ENCRYPTION_KEY is whitespace-only', () => {
      process.env.ENCRYPTION_KEY = '   ';
      const keyRegistry = loadModule();
      expect(keyRegistry.getKeyEntries()).toEqual([]);
    });

    it('returns one active entry derived from ENCRYPTION_KEY', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const keyRegistry = loadModule();
      const entries = keyRegistry.getKeyEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ keyId: 'k1', isActive: true });
      expect(Buffer.isBuffer(entries[0].key)).toBe(true);
      expect(entries[0].key).toHaveLength(32);
    });
  });

  describe('getActiveKey', () => {
    it('returns null when no key is configured', () => {
      const keyRegistry = loadModule();
      expect(keyRegistry.getActiveKey()).toBeNull();
    });

    it('returns the derived 32-byte key when ENCRYPTION_KEY is set', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const keyRegistry = loadModule();
      const key = keyRegistry.getActiveKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key).toHaveLength(32);
    });

    it('derives the same key for the same raw input (deterministic)', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const keyRegistry = loadModule();
      const key1 = keyRegistry.getActiveKey();
      const key2 = keyRegistry.getActiveKey();
      expect(key1.equals(key2)).toBe(true);
    });
  });

  describe('getKeyById', () => {
    it('returns null when keyId is falsy', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const keyRegistry = loadModule();
      expect(keyRegistry.getKeyById(null)).toBeNull();
      expect(keyRegistry.getKeyById('')).toBeNull();
      expect(keyRegistry.getKeyById(undefined)).toBeNull();
    });

    it('returns the key when keyId matches the active entry', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const keyRegistry = loadModule();
      const key = keyRegistry.getKeyById('k1');
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.equals(keyRegistry.getActiveKey())).toBe(true);
    });

    it('trims the provided keyId before matching', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const keyRegistry = loadModule();
      expect(keyRegistry.getKeyById('  k1  ')).not.toBeNull();
    });

    it('returns null when no entry matches keyId', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      process.env.ENCRYPTION_KEY_ID = 'k1';
      const keyRegistry = loadModule();
      expect(keyRegistry.getKeyById('nonexistent')).toBeNull();
    });

    it('returns null when no key is configured at all', () => {
      const keyRegistry = loadModule();
      expect(keyRegistry.getKeyById('default')).toBeNull();
    });
  });

  describe('getFallbackKeys', () => {
    it('returns an empty array when no key is configured', () => {
      const keyRegistry = loadModule();
      expect(keyRegistry.getFallbackKeys()).toEqual([]);
    });

    it('returns unique keys derived from configured entries', () => {
      process.env.ENCRYPTION_KEY = 'super-secret-key';
      const keyRegistry = loadModule();
      const keys = keyRegistry.getFallbackKeys();
      expect(keys).toHaveLength(1);
      expect(Buffer.isBuffer(keys[0])).toBe(true);
    });
  });
});
