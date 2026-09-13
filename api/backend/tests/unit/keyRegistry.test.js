import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('config/keyRegistry', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_ID;
    // #1086: the decrypt-only previous-key slot is env-driven too.
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;
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

  // #1086: the decrypt-only previous-key slot that makes an ENCRYPTION_KEY
  // rotation a config-only act (RNF020 AC#5). getFallbackKeys' dedup-by-hex
  // loop and getKeyById were plainly written for this shape; restoring the
  // slot is what makes them do anything.
  describe('#1086 previous-key slot', () => {
    it('adds a second, NON-active entry when ENCRYPTION_KEY_PREVIOUS is set', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';
      const entries = loadModule().getKeyEntries();

      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ keyId: 'key-2026', isActive: true });
      expect(entries[1]).toMatchObject({ keyId: 'key-2025', isActive: false });
    });

    it('resolves the previous key by id while getActiveKey still returns the new one', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';
      const keyRegistry = loadModule();

      const previous = keyRegistry.getKeyById('key-2025');
      const active = keyRegistry.getActiveKey();

      expect(Buffer.isBuffer(previous)).toBe(true);
      expect(previous.equals(active)).toBe(false);
      expect(keyRegistry.getKeyById('key-2026').equals(active)).toBe(true);
    });

    it('getFallbackKeys returns both generations, deduped', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(loadModule().getFallbackKeys()).toHaveLength(2);
    });

    it('dedups by key material when the previous slot repeats the active key', () => {
      process.env.ENCRYPTION_KEY = 'mesma-chave';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'mesma-chave';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(loadModule().getFallbackKeys()).toHaveLength(1);
    });

    it('ignores a previous slot whose id collides with the active id -- the active entry wins', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-unica';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-unica';
      const keyRegistry = loadModule();

      expect(keyRegistry.getKeyEntries()).toHaveLength(1);
      expect(keyRegistry.getKeyById('key-unica').equals(keyRegistry.getActiveKey())).toBe(true);
    });

    it('ignores a previous slot with no id of its own, rather than guessing one', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;

      expect(loadModule().getKeyEntries()).toHaveLength(1);
    });

    // Control case: unchanged before and after the fix (#695).
    it('control: a blank previous slot leaves exactly the one active entry', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = '   ';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(loadModule().getKeyEntries()).toHaveLength(1);
    });

    // Control case: a previous slot with no ACTIVE key configured must not
    // resurrect encryption on its own -- the previous key is decrypt-only.
    it('control: a previous slot alone does not make getActiveKey non-null', () => {
      delete process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(loadModule().getActiveKey()).toBeNull();
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
