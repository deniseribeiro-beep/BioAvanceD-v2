const crypto = require('crypto');
import { describe, it, expect, beforeEach } from 'vitest';

const env = require('../../src/config/env');
const merkleEnvelopeService = require('../../src/services/merkle-envelope.service');

describe('merkle-envelope.service', () => {
  beforeEach(() => {
    const pair = crypto.generateKeyPairSync('ed25519');
    const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    env.AUDIT_MERKLE_SIGN_KEY_ID = 'test-key';
    env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_PEM = privatePem;
    env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'test-key': publicPem });
  });

  it('assina e valida envelope canonico v2', () => {
    const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
      date: '2026-07-01',
      root: 'a'.repeat(64),
      treeSize: 10,
      previousAnchorHash: 'b'.repeat(64),
    });

    const signed = merkleEnvelopeService.signEnvelope(envelope);
    const verification = merkleEnvelopeService.verifyEnvelopeSignature(signed);

    expect(verification.ok).toBe(true);
    expect(signed.signatureAlgorithm).toBe('ED25519');
  });

  it('detecta envelope alterado', () => {
    const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
      date: '2026-07-01',
      root: 'c'.repeat(64),
      treeSize: 2,
      previousAnchorHash: null,
    });
    const signed = merkleEnvelopeService.signEnvelope(envelope);
    signed.envelope.root = 'd'.repeat(64);

    const verification = merkleEnvelopeService.verifyEnvelopeSignature(signed);
    expect(verification.ok).toBe(false);
  });

  it('falha para keyId desconhecido', () => {
    const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
      date: '2026-07-01',
      root: 'e'.repeat(64),
      treeSize: 1,
      previousAnchorHash: null,
    });
    const signed = merkleEnvelopeService.signEnvelope(envelope);
    signed.keyId = 'missing-key';

    const verification = merkleEnvelopeService.verifyEnvelopeSignature(signed);
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe('unknown_key_id');
  });
});
