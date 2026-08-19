import { describe, it, expect, beforeAll } from 'vitest';

// Encryption key must be set before requiring the module
process.env.ENCRYPTION_KEY = 'dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXQ='; // 32 bytes base64
process.env.ENCRYPTION_KEY_ID = 'test-key-1';

const { encryptValue, decryptValue, hmacBlindIndex } = require('../../src/utils/fieldEncryption');

describe('encryptValue', () => {
  it('returns null for null input', () => {
    expect(encryptValue(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(encryptValue(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(encryptValue('')).toBeNull();
  });

  it('returns encrypted object with required fields', () => {
    const result = encryptValue('sensitive-data');
    expect(result).not.toBeNull();
    expect(result.alg).toBe('aes-256-gcm');
    expect(result.v).toBe(1);
    expect(typeof result.iv).toBe('string');
    expect(typeof result.tag).toBe('string');
    expect(typeof result.data).toBe('string');
    expect(typeof result.keyId).toBe('string');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const r1 = encryptValue('hello');
    const r2 = encryptValue('hello');
    expect(r1.data).not.toBe(r2.data);
    expect(r1.iv).not.toBe(r2.iv);
  });

  it('can encrypt objects', () => {
    const result = encryptValue({ cpf: '123.456.789-00', name: 'João' });
    expect(result).not.toBeNull();
    expect(result.data).toBeTruthy();
  });

  it('can encrypt numbers', () => {
    const result = encryptValue(42);
    expect(result).not.toBeNull();
    expect(result.data).toBeTruthy();
  });
});

describe('decryptValue', () => {
  it('returns null for null payload', () => {
    expect(decryptValue(null)).toBeNull();
  });

  it('returns null for non-object payload', () => {
    expect(decryptValue('string')).toBeNull();
    expect(decryptValue(42)).toBeNull();
  });

  it('returns null for payload with unknown keyId', () => {
    const payload = { keyId: 'non-existent-key', iv: 'abc', tag: 'abc', data: 'abc' };
    expect(decryptValue(payload)).toBeNull();
  });

  it('decrypt(encrypt(value)) === value for string', () => {
    const original = 'test-sensitive-value';
    const encrypted = encryptValue(original);
    const decrypted = decryptValue(encrypted);
    expect(decrypted).toBe(original);
  });

  it('decrypt(encrypt(value)) === value for object', () => {
    const original = { cpf: '529.982.247-25', name: 'Maria' };
    const encrypted = encryptValue(original);
    const decrypted = decryptValue(encrypted);
    expect(decrypted).toEqual(original);
  });

  it('decrypt(encrypt(value)) === value for number', () => {
    const encrypted = encryptValue(9876543);
    expect(decryptValue(encrypted)).toBe(9876543);
  });

  it('returns null for tampered data', () => {
    const encrypted = encryptValue('my-secret');
    encrypted.data = 'AAAA'; // tampered
    expect(decryptValue(encrypted)).toBeNull();
  });
});

// RF005/RNF007 (#574): deterministic blind index for ParticipantIdentity
// fields that need exact/range queries without touching ciphertext.
describe('hmacBlindIndex', () => {
  it('returns null for null/undefined/empty input', () => {
    expect(hmacBlindIndex(null)).toBeNull();
    expect(hmacBlindIndex(undefined)).toBeNull();
    expect(hmacBlindIndex('')).toBeNull();
  });

  it('is deterministic for the same input', () => {
    expect(hmacBlindIndex('12345678900')).toBe(hmacBlindIndex('12345678900'));
  });

  it('produces different output for different input', () => {
    expect(hmacBlindIndex('12345678900')).not.toBe(hmacBlindIndex('98765432100'));
  });

  it('does not contain the plaintext value', () => {
    expect(hmacBlindIndex('12345678900')).not.toContain('12345678900');
  });

  it('returns a hex string', () => {
    expect(hmacBlindIndex('some-value')).toMatch(/^[0-9a-f]+$/);
  });
});
