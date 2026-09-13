import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

describe('utils/fieldEncryption', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_ID;
    // #1086: the previous-key slot is env-driven too, so it has to be cleared
    // between cases or a rotation test leaks into its neighbours.
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;
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

  // #1086: keyRegistry held exactly one key, so rotating ENCRYPTION_KEY
  // turned every existing envelope into a decryptValue null -- encryptValue
  // always stamps a keyId, so decryptValue always takes the getKeyById branch
  // and never reaches the fallback loop. RNF020 AC#5 requires rotation
  // "sem alteração de código". Direction 1 (Dennis, 2026-09-07): a
  // decrypt-only previous-key slot.
  describe('#1086 ENCRYPTION_KEY rotation', () => {
    it('decrypts an envelope written under the previous key after a full rotation', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-2025';
      const before = loadModule();
      const envelope = before.encryptValue({ nome: 'identidade civil' });
      expect(envelope.keyId).toBe('key-2025');

      // The rotation an operator performs: new key + new id, old pair moved
      // into the previous slot. No code change -- env only.
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';
      const after = loadModule();

      expect(after.decryptValue(envelope)).toEqual({ nome: 'identidade civil' });
    });

    it('writes NEW envelopes under the active key after a rotation, not the previous one', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';
      const { encryptValue, decryptValue } = loadModule();

      const envelope = encryptValue('novo segredo');

      expect(envelope.keyId).toBe('key-2026');
      expect(decryptValue(envelope)).toBe('novo segredo');
    });

    it('keeps decrypting BOTH generations while the previous slot is populated', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-2025';
      const old = loadModule().encryptValue('antigo');

      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';
      const after = loadModule();
      const fresh = after.encryptValue('novo');

      expect(after.decryptValue(old)).toBe('antigo');
      expect(after.decryptValue(fresh)).toBe('novo');
    });

    it('returns null once the previous slot is emptied -- the retirement step is real', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-2025';
      const envelope = loadModule().encryptValue('antigo');

      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;

      expect(loadModule().decryptValue(envelope)).toBeNull();
    });

    // Control case: unchanged before and after the fix, so a red here is the
    // fixture rather than the behaviour under test (#695).
    it('control: an envelope written under the CURRENT key round-trips', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      const { encryptValue, decryptValue } = loadModule();

      expect(decryptValue(encryptValue('mesma geração'))).toBe('mesma geração');
    });

    // Control case: a genuinely unknown keyId must still fail closed.
    it('control: an envelope whose keyId matches neither slot decrypts to null', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-2025';
      const envelope = loadModule().encryptValue('antigo');
      envelope.keyId = 'key-que-nunca-existiu';

      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(loadModule().decryptValue(envelope)).toBeNull();
    });
  });

  // #1100: getKeyById matches on the id ALONE, and #1086's registry stacks
  // the active entry first, so an operator who rotates ENCRYPTION_KEY while
  // KEEPING ENCRYPTION_KEY_ID makes every pre-rotation envelope resolve to
  // the NEW key. The AES-GCM auth tag then fails and the previous key --
  // sitting right there in the registry -- was never tried. #1086's boot
  // gate reports [] for this configuration and is RIGHT to: whether it is
  // wrong depends on the keyIds stamped on rows in the database, which no
  // boot-time check can know, so warning harder was never available.
  describe('#1100 rotation that keeps ENCRYPTION_KEY_ID', () => {
    it('decrypts an envelope whose keyId now resolves to the NEW key', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-fixo';
      const envelope = loadModule().encryptValue('identidade civil');
      expect(envelope.keyId).toBe('key-fixo');

      // The key rotates; the id does not. The old key is parked under a new
      // previous id, so the registry HOLDS it -- getKeyById just never
      // reaches it, because the active entry claims 'key-fixo' first.
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-fixo';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-antigo';

      expect(loadModule().decryptValue(envelope)).toBe('identidade civil');
    });

    it('still writes NEW envelopes under the active key when the id is kept', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-fixo';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-antigo';
      const { encryptValue, decryptValue } = loadModule();

      const envelope = encryptValue('novo segredo');

      expect(envelope.keyId).toBe('key-fixo');
      expect(decryptValue(envelope)).toBe('novo segredo');
    });

    // Control case: unchanged before and after the fix, so a red here is the
    // fixture rather than the behaviour under test (#695). This is also the
    // fail-closed floor -- the fall-through must not invent a plaintext.
    it('control: an envelope NO configured key can decrypt still returns null', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-fixo';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-antigo';
      const { encryptValue, decryptValue } = loadModule();
      const envelope = encryptValue('segredo');
      envelope.tag = Buffer.from('0000000000000000', 'hex').toString('base64');

      expect(decryptValue(envelope)).toBeNull();
    });

    // Control case: an UNKNOWN keyId deliberately stays fail-closed on its
    // own warn. No configured key claims that id, the operator gets a
    // diagnostic, and widening that branch is not what #1100 is about.
    it('control: an unknown keyId still fails closed, without trying every key', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-fixo';
      const envelope = loadModule().encryptValue('antigo');
      envelope.keyId = 'key-que-nunca-existiu';

      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-fixo';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-antigo';

      expect(loadModule().decryptValue(envelope)).toBeNull();
    });
  });

  // #1099: hmacBlindIndex keys off getActiveKey() and stores a BARE hex
  // string with no keyId, so #1086's previous-key slot has nothing to
  // dispatch on and a rotation orphans every pre-rotation index value.
  // The remedy cannot be a keyId lookup the way decryptValue's is -- there
  // is no keyId on the stored value to look up. It is to build a candidate
  // hash under EVERY registered key and let the query match on any of
  // them, which makes the blind index behave exactly like the envelope
  // under rotation. RNF020 AC#5: secrets rotate "sem alteracao de codigo".
  describe('#1099 blind index across a rotation', () => {
    it('offers the PREVIOUS key hash as a candidate after a rotation', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-2025';
      const stored = loadModule().hmacBlindIndex('11144477735');

      // The documented four-step rotation -- new pair active, old pair
      // parked in the previous slot. Rows written before it still hold a
      // hash under 'chave-antiga'.
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';

      expect(loadModule().hmacBlindIndexCandidates('11144477735')).toContain(stored);
    });

    it('puts the ACTIVE key hash first, so new writes stay on the active key', () => {
      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      process.env.ENCRYPTION_KEY_PREVIOUS = 'chave-antiga';
      process.env.ENCRYPTION_KEY_PREVIOUS_ID = 'key-2025';
      const { hmacBlindIndex, hmacBlindIndexCandidates } = loadModule();

      expect(hmacBlindIndexCandidates('11144477735')[0]).toBe(hmacBlindIndex('11144477735'));
    });

    it('stops offering the previous hash once the slot is emptied -- retirement is real', () => {
      process.env.ENCRYPTION_KEY = 'chave-antiga';
      process.env.ENCRYPTION_KEY_ID = 'key-2025';
      const stored = loadModule().hmacBlindIndex('11144477735');

      process.env.ENCRYPTION_KEY = 'chave-nova';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
      delete process.env.ENCRYPTION_KEY_PREVIOUS_ID;

      expect(loadModule().hmacBlindIndexCandidates('11144477735')).not.toContain(stored);
    });

    // Control case: unchanged before and after the fix (#695).
    it('control: with a SINGLE key configured, yields exactly the active hash', () => {
      process.env.ENCRYPTION_KEY = 'chave-unica';
      process.env.ENCRYPTION_KEY_ID = 'key-2026';
      const { hmacBlindIndex, hmacBlindIndexCandidates } = loadModule();

      expect(hmacBlindIndexCandidates('11144477735')).toEqual([hmacBlindIndex('11144477735')]);
    });

    // Control case: the empty-input contract matches hmacBlindIndex's.
    it('control: null/undefined/empty yield no candidates at all', () => {
      process.env.ENCRYPTION_KEY = 'chave-unica';
      const { hmacBlindIndexCandidates } = loadModule();

      expect(hmacBlindIndexCandidates(null)).toEqual([]);
      expect(hmacBlindIndexCandidates(undefined)).toEqual([]);
      expect(hmacBlindIndexCandidates('')).toEqual([]);
    });

    // Control case: no key configured is not silently an empty match-all.
    it('control: with NO key configured, yields no candidates', () => {
      const { hmacBlindIndexCandidates } = loadModule();

      expect(hmacBlindIndexCandidates('11144477735')).toEqual([]);
    });
  });

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
