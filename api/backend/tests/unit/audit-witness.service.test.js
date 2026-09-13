import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const env = require('../../src/config/env');
const auditWitnessService = require('../../src/services/audit-witness.service');

describe('audit-witness.service', () => {
  beforeEach(() => {
    env.AUDIT_EXTERNAL_WITNESS_URL = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('publish', () => {
    it('retorna UNAVAILABLE quando AUDIT_EXTERNAL_WITNESS_URL nao esta configurado', async () => {
      const result = await auditWitnessService.publish({ foo: 'bar' });
      expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'missing_witness_url' });
    });

    it('retorna UNAVAILABLE quando AUDIT_EXTERNAL_WITNESS_URL e apenas espacos em branco', async () => {
      env.AUDIT_EXTERNAL_WITNESS_URL = '   ';
      const result = await auditWitnessService.publish({ foo: 'bar' });
      expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'missing_witness_url' });
    });

    it('retorna FAILED com o status http quando a resposta nao e ok', async () => {
      env.AUDIT_EXTERNAL_WITNESS_URL = 'https://witness.example.test/publish';
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal('fetch', fetchMock);

      const result = await auditWitnessService.publish({ foo: 'bar' });

      expect(result).toEqual({ status: 'FAILED', reason: 'witness_http_503' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://witness.example.test/publish',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ foo: 'bar' }),
        }),
      );
    });

    it('retorna WITNESSED com receipt e witnessId quando a resposta e ok', async () => {
      env.AUDIT_EXTERNAL_WITNESS_URL = 'https://witness.example.test/publish';
      const body = { receipt: 'r-1', witnessId: 'w-1' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => body,
      }));

      const result = await auditWitnessService.publish({ foo: 'bar' });

      expect(result).toEqual({ status: 'WITNESSED', receipt: 'r-1', witnessId: 'w-1', body });
    });

    it('retorna WITNESSED com receipt e witnessId nulos quando ausentes no corpo', async () => {
      env.AUDIT_EXTERNAL_WITNESS_URL = 'https://witness.example.test/publish';
      const body = {};
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => body,
      }));

      const result = await auditWitnessService.publish({ foo: 'bar' });

      expect(result).toEqual({ status: 'WITNESSED', receipt: null, witnessId: null, body });
    });
  });

  describe('digest', () => {
    it('produz um hash sha256 hex deterministico do registro', () => {
      const record = { a: 1, b: 'two' };
      const expected = require('crypto').createHash('sha256').update(JSON.stringify(record)).digest('hex');

      expect(auditWitnessService.digest(record)).toBe(expected);
    });

    it('produz hashes diferentes para registros diferentes', () => {
      const digestA = auditWitnessService.digest({ a: 1 });
      const digestB = auditWitnessService.digest({ a: 2 });

      expect(digestA).not.toBe(digestB);
      expect(digestA).toHaveLength(64);
    });
  });
});
