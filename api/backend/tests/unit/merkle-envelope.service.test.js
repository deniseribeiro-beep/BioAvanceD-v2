const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const env = require('../../src/config/env');
const merkleEnvelopeService = require('../../src/services/merkle-envelope.service');

describe('merkle-envelope.service', () => {
  let tmpKeyFile;
  let originalPrivateFile;

  function writeTempKeyFile(pem) {
    tmpKeyFile = path.join(os.tmpdir(), `merkle-envelope-service-test-${Date.now()}-${Math.random()}.pem`);
    fs.writeFileSync(tmpKeyFile, pem, 'utf8');
    return tmpKeyFile;
  }

  beforeEach(() => {
    const pair = crypto.generateKeyPairSync('ed25519');
    const privatePem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicPem = pair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    originalPrivateFile = env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE;
    env.AUDIT_MERKLE_SIGN_KEY_ID = 'test-key';
    env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = writeTempKeyFile(privatePem);
    env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON = JSON.stringify({ 'test-key': publicPem });
  });

  afterEach(() => {
    if (tmpKeyFile) {
      fs.rmSync(tmpKeyFile, { force: true });
      tmpKeyFile = undefined;
    }
    // Restore rather than leave _FILE pointing at the deleted temp path: the
    // gaps sibling asserts the "no file configured" throw, and a leaked
    // stale path would turn that throw into an ENOENT rejection instead.
    env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE = originalPrivateFile;
  });

  it('assina e valida envelope canonico v2', async () => {
    const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
      date: '2026-07-01',
      root: 'a'.repeat(64),
      treeSize: 10,
      previousAnchorHash: 'b'.repeat(64),
    });

    const signed = await merkleEnvelopeService.signEnvelope(envelope);
    const verification = merkleEnvelopeService.verifyEnvelopeSignature(signed);

    expect(verification.ok).toBe(true);
    expect(signed.signatureAlgorithm).toBe('ED25519');
  });

  it('detecta envelope alterado', async () => {
    const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
      date: '2026-07-01',
      root: 'c'.repeat(64),
      treeSize: 2,
      previousAnchorHash: null,
    });
    const signed = await merkleEnvelopeService.signEnvelope(envelope);
    signed.envelope.root = 'd'.repeat(64);

    const verification = merkleEnvelopeService.verifyEnvelopeSignature(signed);
    expect(verification.ok).toBe(false);
  });

  it('falha para keyId desconhecido', async () => {
    const envelope = merkleEnvelopeService.buildCanonicalEnvelope({
      date: '2026-07-01',
      root: 'e'.repeat(64),
      treeSize: 1,
      previousAnchorHash: null,
    });
    const signed = await merkleEnvelopeService.signEnvelope(envelope);
    signed.keyId = 'missing-key';

    const verification = merkleEnvelopeService.verifyEnvelopeSignature(signed);
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe('unknown_key_id');
  });
});
