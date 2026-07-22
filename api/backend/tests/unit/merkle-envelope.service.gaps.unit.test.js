import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const env = require('../../src/config/env');
const merkleEnvelopeService = require('../../src/services/merkle-envelope.service');
const { canonicalStringify, stableSort } = require('../../src/services/merkle-envelope.service');

describe('merkle-envelope.service gaps', () => {
  let originalKeyId;
  let originalPrivatePem;
  let originalPrivateFile;
  let originalPublicKeysJson;
  let originalNodeEnv;

  beforeEach(() => {
    originalKeyId = env.AUDIT_MERKLE_SIGN_KEY_ID;
    originalPrivatePem = env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM;
    originalPrivateFile = env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE;
    originalPublicKeysJson = env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON;
    originalNodeEnv = env.NODE_ENV;
  });

  afterEach(() => {
    env.AUDIT_MERKLE_SIGN_KEY_ID = originalKeyId;
    env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = originalPrivatePem;
    env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = originalPrivateFile;
    env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = originalPublicKeysJson;
    env.NODE_ENV = originalNodeEnv;
  });

  describe('stableSort / canonicalStringify', () => {
    it('sorts array elements recursively', () => {
      const result = stableSort([{ b: 1, a: 2 }, 'x', 5]);
      expect(result).toEqual([{ a: 2, b: 1 }, 'x', 5]);
    });

    it('produces the same string regardless of key insertion order', () => {
      const a = canonicalStringify({ z: 1, a: { d: 1, c: 2 } });
      const b = canonicalStringify({ a: { c: 2, d: 1 }, z: 1 });
      expect(a).toBe(b);
    });
  });

  describe('getPrivateKeyPem', () => {
    it('reads the private key from a file when configured', async () => {
      const pair = crypto.generateKeyPairSync('ed25519');
      const pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const filePath = path.join(os.tmpdir(), `merkle-key-${Date.now()}.pem`);
      fs.writeFileSync(filePath, `\n${pem}\n`);
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = filePath;

      try {
        const result = await merkleEnvelopeService.getPrivateKeyPem();
        expect(result).toBe(pem.trim());
      } finally {
        fs.unlinkSync(filePath);
      }
    });

    it('throws when no file is configured and no test-env fallback PEM is set', async () => {
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '';
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = '';

      expect(() => merkleEnvelopeService.getPrivateKeyPem()).toThrow(
        'Audit signing key must be provided via AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE'
      );
    });

    it('throws when a fallback PEM is set but NODE_ENV is not test', async () => {
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = '';
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = 'some-pem';
      env.NODE_ENV = 'production';

      expect(() => merkleEnvelopeService.getPrivateKeyPem()).toThrow(
        'Audit signing key must be provided via AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE'
      );
    });
  });

  describe('parsePublicKeyRegistry (via getPublicKeyPemById)', () => {
    it('returns null when the registry JSON is empty', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '';
      expect(merkleEnvelopeService.getPublicKeyPemById('anything')).toBeNull();
    });

    it('returns null when the registry JSON is malformed', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '{not valid json';
      expect(merkleEnvelopeService.getPublicKeyPemById('anything')).toBeNull();
    });

    it('returns null when the registry JSON parses to an array', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = '["a", "b"]';
      expect(merkleEnvelopeService.getPublicKeyPemById('anything')).toBeNull();
    });
  });

  describe('signEnvelope', () => {
    it('throws when the active key id is not configured', async () => {
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = 'irrelevant';
      env.NODE_ENV = 'test';
      env.AUDIT_MERKLE_SIGN_KEY_ID = '';

      const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
        date: '2026-07-01',
        root: 'a'.repeat(64),
        treeSize: 1,
      });

      await expect(merkleEnvelopeService.signEnvelope(envelope)).rejects.toThrow(
        'Audit signing key is not configured'
      );
    });
  });

  describe('verifyEnvelopeSignature', () => {
    it('reports missing_signature_material when required fields are absent', () => {
      const result = merkleEnvelopeService.verifyEnvelopeSignature({ envelope: null, signature: null, keyId: null });
      expect(result).toEqual({ ok: false, reason: 'missing_signature_material' });
    });

    it('reports unsupported_signature_algorithm for a non-ED25519 algorithm', () => {
      const result = merkleEnvelopeService.verifyEnvelopeSignature({
        envelope: { schemaVersion: 2 },
        signature: 'sig',
        signatureAlgorithm: 'RSA-SHA256',
        keyId: 'test-key',
      });
      expect(result).toEqual({ ok: false, reason: 'unsupported_signature_algorithm' });
    });

    it('reports public_key_fingerprint_mismatch when the caller-supplied fingerprint disagrees', async () => {
      const pair = crypto.generateKeyPairSync('ed25519');
      const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
      env.AUDIT_MERKLE_SIGN_KEY_ID = 'test-key';
      env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = privatePem;
      env.NODE_ENV = 'test';
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'test-key': publicPem });

      const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
        date: '2026-07-01',
        root: 'a'.repeat(64),
        treeSize: 1,
      });
      const signed = await merkleEnvelopeService.signEnvelope(envelope);
      signed.publicKeyFingerprint = 'not-the-real-fingerprint';

      const result = merkleEnvelopeService.verifyEnvelopeSignature(signed);
      expect(result).toEqual({ ok: false, reason: 'public_key_fingerprint_mismatch' });
    });

    it('reports invalid_signature_format when the registered public key is not a usable PEM', () => {
      env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'test-key': 'not-a-real-pem' });

      const result = merkleEnvelopeService.verifyEnvelopeSignature({
        envelope: { schemaVersion: 2, date: '2026-07-01' },
        signature: 'AAAA',
        signatureAlgorithm: 'ED25519',
        keyId: 'test-key',
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid_signature_format');
    });
  });

  describe('fromPersistedRoot', () => {
    it('returns null when rootDoc is falsy', () => {
      expect(merkleEnvelopeService.fromPersistedRoot(null)).toBeNull();
    });

    it('maps a schemaVersion 2 document straight through', () => {
      const rootDoc = {
        schemaVersion: 2,
        envelope: { schemaVersion: 2, date: '2026-07-01', root: 'a'.repeat(64), treeSize: 3 },
        signature: 'sig',
        signatureAlgorithm: 'ED25519',
        keyId: 'test-key',
        publicKeyFingerprint: 'fp',
      };

      const result = merkleEnvelopeService.fromPersistedRoot(rootDoc);

      expect(result).toEqual({
        schemaVersion: 2,
        envelope: rootDoc.envelope,
        signature: 'sig',
        signatureAlgorithm: 'ED25519',
        keyId: 'test-key',
        publicKeyFingerprint: 'fp',
      });
    });

    it('wraps a legacy (schemaVersion 1) document into the v2-shaped envelope structure', () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const rootDoc = {
        date: '2026-01-01',
        root: 'b'.repeat(64),
        treeSize: 7,
        previousRootHash: 'c'.repeat(64),
        createdAt,
      };

      const result = merkleEnvelopeService.fromPersistedRoot(rootDoc);

      expect(result.schemaVersion).toBe(1);
      expect(result.legacyV1).toBe(true);
      expect(result.signature).toBeNull();
      expect(result.envelope).toEqual({
        schemaVersion: 1,
        date: '2026-01-01',
        root: 'b'.repeat(64),
        treeSize: 7,
        hashAlgorithm: 'SHA-256',
        merkleAlgorithm: 'BIOAVANCED-MERKLE-V1',
        previousAnchorHash: 'c'.repeat(64),
        generatedAt: createdAt.toISOString(),
        keyId: null,
      });
    });

    it('defaults treeSize to 0 and generatedAt to null when absent from a legacy document', () => {
      const result = merkleEnvelopeService.fromPersistedRoot({ date: '2026-01-01', root: 'd'.repeat(64) });

      expect(result.envelope.treeSize).toBe(0);
      expect(result.envelope.generatedAt).toBeNull();
      expect(result.envelope.previousAnchorHash).toBeNull();
    });
  });
});
