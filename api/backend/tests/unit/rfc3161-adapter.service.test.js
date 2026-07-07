import { describe, it, expect, beforeEach } from 'vitest';

const env = require('../../src/config/env');
const rfc3161AdapterService = require('../../src/services/rfc3161-adapter.service');

describe('rfc3161-adapter.service', () => {
  beforeEach(() => {
    env.AUDIT_RFC3161_TSA_URL = 'https://tsa.example.test/token';
    env.AUDIT_RFC3161_TSA_AUTH_TOKEN = '';
  });

  it('valida token em modo mock', async () => {
    env.AUDIT_RFC3161_MODE = 'mock';
    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'a'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });
    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'a'.repeat(64),
      timestamp: anchored,
      replayDetected: false,
    });

    expect(anchored.status).toBe('ANCHORED');
    expect(check.ok).toBe(true);
  });

  it('detecta replay de token', async () => {
    env.AUDIT_RFC3161_MODE = 'mock';
    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'b'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });
    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'b'.repeat(64),
      timestamp: anchored,
      replayDetected: true,
    });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('token_replay_detected');
  });

  it('marca falha quando TSA remoto esta indisponivel', async () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    env.AUDIT_RFC3161_TSA_URL = 'http://127.0.0.1:1/unavailable';

    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'c'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    expect(anchored.status).toBe('FAILED');
    expect(anchored.error).toBe('tsa_unavailable');
  });
});
