import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const env = require('../../src/config/env');
const rfc3161AdapterService = require('../../src/services/rfc3161-adapter.service');
const { runWithRequestId } = require('../../src/utils/requestContext');

describe('rfc3161-adapter.service', () => {
  beforeEach(() => {
    env.AUDIT_RFC3161_TSA_URL = 'https://tsa.example.test/token';
    env.AUDIT_RFC3161_TSA_AUTH_TOKEN = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('mode() cai para disabled com valor invalido', () => {
    env.AUDIT_RFC3161_MODE = 'bogus';
    expect(rfc3161AdapterService.mode()).toBe('disabled');
  });

  it('anchorEnvelopeDigest em modo disabled retorna VERIFIED sem token', async () => {
    env.AUDIT_RFC3161_MODE = 'disabled';
    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'd'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    expect(anchored.status).toBe('VERIFIED');
    expect(anchored.token).toBeNull();
    expect(anchored.mode).toBe('disabled');
  });

  it('modo remote sem AUDIT_RFC3161_TSA_URL falha com missing_tsa_url', async () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    env.AUDIT_RFC3161_TSA_URL = '';

    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'e'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    expect(anchored.status).toBe('FAILED');
    expect(anchored.error).toBe('missing_tsa_url');
  });

  it('modo remote com resposta HTTP nao-ok marca falha com o status code', async () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'f'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    expect(anchored.status).toBe('FAILED');
    expect(anchored.error).toBe('tsa_http_503');
    expect(anchored.tsa).toBe(env.AUDIT_RFC3161_TSA_URL);
  });

  it('modo remote com resposta ok mas sem token/messageImprint marca invalid_tsa_response', async () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'g'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    expect(anchored.status).toBe('FAILED');
    expect(anchored.error).toBe('invalid_tsa_response');
  });

  it('modo remote com resposta valida anexa (ANCHORED) e envia auth header quando configurado', async () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    env.AUDIT_RFC3161_TSA_AUTH_TOKEN = 'secret-token';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'tsa-token-value',
        messageImprint: 'imprint-value',
        tsa: 'https://real-tsa.example',
        anchoredAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'h'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    expect(anchored.status).toBe('ANCHORED');
    expect(anchored.token).toBe('tsa-token-value');
    expect(anchored.tsa).toBe('https://real-tsa.example');
    expect(anchored.anchoredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(fetchMock).toHaveBeenCalledWith(
      env.AUDIT_RFC3161_TSA_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret-token' }),
      }),
    );
  });

  // #1468 (RNF015 C3): the TSA can tie the call to the request or job that made it.
  it('modo remote envia X-Request-Id ao TSA dentro de um request e nenhum fora dele', async () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tsa-token-value', messageImprint: 'imprint-value' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      envelopeDigestSha256: 'i'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    };

    await runWithRequestId('req-1468-0001', () => rfc3161AdapterService.anchorEnvelopeDigest(input));
    await rfc3161AdapterService.anchorEnvelopeDigest(input);

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'content-type': 'application/json',
      'X-Request-Id': 'req-1468-0001',
    });
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-Request-Id');
  });

  it('verifyTimestamp em modo disabled sempre verifica', () => {
    env.AUDIT_RFC3161_MODE = 'disabled';
    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'i'.repeat(64),
      timestamp: null,
      replayDetected: false,
    });

    expect(check.ok).toBe(true);
    expect(check.status).toBe('VERIFIED');
  });

  it('verifyTimestamp falha quando timestamp esta ausente', () => {
    env.AUDIT_RFC3161_MODE = 'mock';
    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'j'.repeat(64),
      timestamp: null,
      replayDetected: false,
    });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('missing_timestamp');
  });

  it('verifyTimestamp falha quando token ou messageImprint estao ausentes', () => {
    env.AUDIT_RFC3161_MODE = 'mock';
    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'k'.repeat(64),
      timestamp: { token: null, messageImprint: null },
      replayDetected: false,
    });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_timestamp_material');
  });

  it('verifyTimestamp em modo mock rejeita token que nao comeca com mock-tsa:', () => {
    env.AUDIT_RFC3161_MODE = 'mock';
    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'l'.repeat(64),
      timestamp: {
        token: Buffer.from('not-a-mock-token').toString('base64'),
        messageImprint: 'l'.repeat(64),
      },
      replayDetected: false,
    });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_mock_token');
  });

  it('verifyTimestamp em modo mock rejeita message imprint divergente', async () => {
    env.AUDIT_RFC3161_MODE = 'mock';
    const anchored = await rfc3161AdapterService.anchorEnvelopeDigest({
      envelopeDigestSha256: 'm'.repeat(64),
      envelopeDigestBase64: Buffer.from('digest').toString('base64'),
    });

    const check = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'different-digest',
      timestamp: anchored,
      replayDetected: false,
    });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('message_imprint_mismatch');
  });

  it('verifyTimestamp em modo remote rejeita message imprint divergente e aceita quando bate', () => {
    env.AUDIT_RFC3161_MODE = 'remote';
    const mismatched = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'n'.repeat(64),
      timestamp: { token: 'tok', messageImprint: 'o'.repeat(64) },
      replayDetected: false,
    });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.reason).toBe('message_imprint_mismatch');

    const matched = rfc3161AdapterService.verifyTimestamp({
      envelopeDigestSha256: 'n'.repeat(64),
      timestamp: { token: 'tok', messageImprint: 'n'.repeat(64) },
      replayDetected: false,
    });
    expect(matched.ok).toBe(true);
    expect(matched.status).toBe('VERIFIED');
  });
});
