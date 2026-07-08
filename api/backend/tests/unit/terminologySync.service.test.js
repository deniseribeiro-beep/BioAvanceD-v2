import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const MODULE_PATH = require.resolve('../../src/services/terminologySync.service');

let svc = require('../../src/services/terminologySync.service');
const Terminology = require('../../src/models/Terminology');
const logger = require('../../src/utils/logger');

function freshRequireWithEnv(envMutator) {
  // Per repo gotcha: vi.resetModules() alone does not reliably clear require.cache.
  envMutator();
  delete require.cache[MODULE_PATH];
  return require('../../src/services/terminologySync.service');
}

describe('terminologySync.service', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete require.cache[MODULE_PATH];
    svc = require('../../src/services/terminologySync.service');
  });

  describe('isExternalTerminologySyncEnabled', () => {
    it('is false when neither env var is set', () => {
      delete process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(svc.isExternalTerminologySyncEnabled()).toBe(false);
    });

    it('is true for ALLOW_EXTERNAL_TERMINOLOGY_SYNC="true"', () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      expect(svc.isExternalTerminologySyncEnabled()).toBe(true);
    });

    it('is true for ALLOW_EXTERNAL_TERMINOLOGY_SYNC="1" (with whitespace/case tolerance)', () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = '  1  ';
      expect(svc.isExternalTerminologySyncEnabled()).toBe(true);
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'TRUE';
      expect(svc.isExternalTerminologySyncEnabled()).toBe(true);
    });

    it('falls back to ALLOW_CLOUD_INTEGRATIONS when the specific var is unset', () => {
      delete process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
      process.env.ALLOW_CLOUD_INTEGRATIONS = 'true';
      expect(svc.isExternalTerminologySyncEnabled()).toBe(true);
    });

    it('is false for an arbitrary truthy-looking-but-not-matching string', () => {
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'yes';
      expect(svc.isExternalTerminologySyncEnabled()).toBe(false);
    });

    it('reads process.env live at call time, not at module load', () => {
      delete process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(svc.isExternalTerminologySyncEnabled()).toBe(false);
      process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
      expect(svc.isExternalTerminologySyncEnabled()).toBe(true);
    });
  });

  describe('normalizeRecord', () => {
    it('detects ORPHA system from an ORPHAcode field and normalizes/prefixes the code', () => {
      const result = svc.normalizeRecord({ ORPHAcode: '558', 'Preferred term': 'Marfan syndrome' });
      expect(result.sistema).toBe('ORPHA');
      expect(result.codigo).toBe('ORPHA:558');
      expect(result.descricao).toBe('Marfan syndrome');
    });

    it('does not double-prefix a code that already carries ORPHA: (case-insensitive)', () => {
      const result = svc.normalizeRecord({ ORPHAcode: 'orpha:558', descricao: 'x' });
      expect(result.codigo).toBe('ORPHA:558');
    });

    it('normalizes OMIM codes when system is explicitly OMIM', () => {
      const result = svc.normalizeRecord({ codigo: '154700', sistema: 'OMIM', descricao: 'Marfan' });
      expect(result.sistema).toBe('OMIM');
      expect(result.codigo).toBe('OMIM:154700');
    });

    it('falls back to fallbackSystem, uppercased, when no system hints are present', () => {
      const result = svc.normalizeRecord({ codigo: 'X1', descricao: 'desc' }, 'manual');
      expect(result.sistema).toBe('MANUAL');
    });

    it('builds relacoes.cid/omim from ExternalReference array when direct fields are absent', () => {
      const result = svc.normalizeRecord({
        ORPHAcode: '558',
        'Preferred term': 'Marfan syndrome',
        ExternalReference: [
          { Source: 'ICD-10', Reference: 'Q87.4' },
          { Source: 'OMIM', Reference: '154700' },
        ],
      });
      expect(result.relacoes.cid).toBe('Q87.4');
      expect(result.relacoes.omim).toBe('OMIM:154700');
    });

    it('prefers direct cid/omim fields over the ExternalReference fallback', () => {
      const result = svc.normalizeRecord({
        ORPHAcode: '558',
        descricao: 'x',
        cid: 'Q87.9',
        omim: '999999',
        ExternalReference: [
          { Source: 'ICD-10', Reference: 'Q87.4' },
          { Source: 'OMIM', Reference: '154700' },
        ],
      });
      expect(result.relacoes.cid).toBe('Q87.9');
      expect(result.relacoes.omim).toBe('OMIM:999999');
    });

    it('produces a deterministic hashConteudo for identical input', () => {
      const input = { ORPHAcode: '558', descricao: 'Marfan syndrome' };
      const r1 = svc.normalizeRecord({ ...input });
      const r2 = svc.normalizeRecord({ ...input });
      expect(r1.hashConteudo).toBe(r2.hashConteudo);
      expect(r1.hashConteudo).toMatch(/^[a-f0-9]{64}$/);
    });

    it('changes hashConteudo when a normalized field differs', () => {
      const r1 = svc.normalizeRecord({ ORPHAcode: '558', descricao: 'Marfan syndrome' });
      const r2 = svc.normalizeRecord({ ORPHAcode: '558', descricao: 'Different description' });
      expect(r1.hashConteudo).not.toBe(r2.hashConteudo);
    });

    it('defaults ativo to true when record.ativo is undefined, and honors explicit false', () => {
      const r1 = svc.normalizeRecord({ codigo: 'A', descricao: 'd' });
      expect(r1.ativo).toBe(true);
      const r2 = svc.normalizeRecord({ codigo: 'A', descricao: 'd', ativo: false });
      expect(r2.ativo).toBe(false);
    });
  });

  describe('upsertTerminology', () => {
    it('skips when required fields are missing after normalization', async () => {
      const result = await svc.upsertTerminology({});
      expect(result).toEqual({ skipped: true, reason: 'missing-required-fields' });
    });

    it('resolves aliased raw field names (e.g. ORPHAcode) via normalizeRecord before the required-field check', async () => {
      const findSpy = vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({ codigo: 'ORPHA:558' });
      const result = await svc.upsertTerminology({ ORPHAcode: '558', descricao: 'Marfan' });
      expect(result.skipped).toBe(false);
      expect(findSpy).toHaveBeenCalled();
    });

    it('uses the Terminology mongoose model path when no db is provided and raw codigo/sistema/descricao fields are present', async () => {
      const findSpy = vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({ codigo: 'ORPHA:558' });
      const result = await svc.upsertTerminology({ codigo: '558', sistema: 'ORPHA', descricao: 'Marfan' });
      expect(findSpy).toHaveBeenCalled();
      expect(result.skipped).toBe(false);
      expect(result.record).toEqual({ codigo: 'ORPHA:558' });
    });

    it('uses the raw db.collection path (and skips orphanet redundancy for non-ORPHA systems) when a db is provided', async () => {
      const updateOne = vi.fn().mockResolvedValue({});
      const db = { collection: vi.fn().mockReturnValue({ updateOne }) };
      const result = await svc.upsertTerminology({ codigo: 'X1', sistema: 'OUTRO', descricao: 'desc' }, db);
      expect(db.collection).toHaveBeenCalledWith('terminologies');
      expect(updateOne).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBe(false);
    });

    it('also upserts into orphanet_diseases via db path when system is ORPHA', async () => {
      const terminologiesUpdate = vi.fn().mockResolvedValue({});
      const orphanetUpdate = vi.fn().mockResolvedValue({});
      const db = {
        collection: vi.fn((name) => {
          if (name === 'terminologies') return { updateOne: terminologiesUpdate };
          if (name === 'orphanet_diseases') return { updateOne: orphanetUpdate };
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      const result = await svc.upsertTerminology({ codigo: '558', sistema: 'ORPHA', descricao: 'Marfan' }, db);
      expect(db.collection).toHaveBeenCalledWith('terminologies');
      expect(db.collection).toHaveBeenCalledWith('orphanet_diseases');
      expect(orphanetUpdate).toHaveBeenCalledTimes(1);
      const orphanetCallArgs = orphanetUpdate.mock.calls[0];
      expect(orphanetCallArgs[0]).toEqual({ code: '558' });
      expect(result.skipped).toBe(false);
    });
  });

  describe('seedTerminologies', () => {
    it('returns success with 0/0 for an empty list', async () => {
      const result = await svc.seedTerminologies([]);
      expect(result).toEqual({ success: true, upserted: 0, skipped: 0 });
    });

    it('counts skipped records without stopping the batch, and counts upserted for valid ones', async () => {
      vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});
      const records = [
        { codigo: '1', sistema: 'ORPHA', descricao: 'a' },
        {}, // missing fields -> skipped
        { codigo: '2', sistema: 'ORPHA', descricao: 'b' },
      ];
      const result = await svc.seedTerminologies(records);
      expect(result).toEqual({ success: true, upserted: 2, skipped: 1 });
    });

    it('isolates a per-record thrown error as a skip and logs a warning, continuing the batch', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      let call = 0;
      vi.spyOn(Terminology, 'findOneAndUpdate').mockImplementation(() => {
        call += 1;
        if (call === 1) throw new Error('db exploded');
        return Promise.resolve({});
      });
      const records = [
        { codigo: '1', sistema: 'ORPHA', descricao: 'a' },
        { codigo: '2', sistema: 'ORPHA', descricao: 'b' },
      ];
      const result = await svc.seedTerminologies(records);
      expect(result).toEqual({ success: true, upserted: 1, skipped: 1 });
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('syncFromOrphadata', () => {
    it('returns disabled early result when external sync is not enabled', async () => {
      delete process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC;
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await svc.syncFromOrphadata();
      expect(result).toEqual({
        success: true,
        disabled: true,
        attempted: [],
        upserted: 0,
        skipped: 0,
        source: 'local-only',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns disabled early result when ORPHADATA_BASE_URL is empty, even if sync is enabled', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = '';
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();
      expect(result.disabled).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls through to the next endpoint when the first fails, and stops at the first endpoint yielding records', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});

      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('network down')) // endpoint 1 fails
        .mockResolvedValueOnce({ // endpoint 2 succeeds with one record
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify([{ ORPHAcode: '1', descricao: 'Disease One' }]),
        });
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.attempted).toBe('/rd-phenotypes/orphacodes?limit=1000');
      expect(result.upserted).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('does not try the third endpoint once the second one already yielded records', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});

      const jsonResponse = (body) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(body),
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse([])) // endpoint 1: empty -> continue
        .mockResolvedValueOnce(jsonResponse([{ ORPHAcode: '1', descricao: 'D1' }])) // endpoint 2: success
        .mockResolvedValueOnce(jsonResponse([{ ORPHAcode: '2', descricao: 'D2' }])); // endpoint 3, should not be called

      vi.stubGlobal('fetch', fetchMock);

      await freshSvc.syncFromOrphadata();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns success:false with all endpoints attempted when every endpoint fails or is empty', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const fetchMock = vi.fn().mockRejectedValue(new Error('always fails'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        success: false,
        attempted: [
          '/rd-cross-referencing/orphacodes?limit=1000',
          '/rd-phenotypes/orphacodes?limit=1000',
          '/rd-classification/orphacodes?limit=1000',
        ],
        upserted: 0,
        skipped: 0,
      });
    });

    it('warns and falls through consistently on malformed JSON, regardless of the content-type header (issue #30)', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});

      const malformedResponse = (contentType) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => contentType },
        text: async () => '<html>not json</html>',
      });

      const fetchMock = vi.fn()
        // endpoint 1: malformed body mislabeled as application/json
        .mockResolvedValueOnce(malformedResponse('application/json'))
        // endpoint 2: same malformed body with no/other content-type
        .mockResolvedValueOnce(malformedResponse('text/html'))
        // endpoint 3: succeeds so the loop terminates with a clear result
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify([{ ORPHAcode: '1', descricao: 'Disease One' }]),
        });
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      // Both malformed responses should be warned about identically, not just the
      // application/json-labeled one (which previously threw instead of warning).
      const malformedWarnings = warnSpy.mock.calls.filter(([msg]) => msg.includes('não é JSON válido'));
      expect(malformedWarnings).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.attempted).toBe('/rd-classification/orphacodes?limit=1000');
    });

    it('propagates a Timeout error message when fetch aborts (exercised through the endpoint-failure/warn path)', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const fetchMock = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();

      expect(result.success).toBe(false);
      const warnMessages = warnSpy.mock.calls.map((c) => c[0]);
      expect(warnMessages.some((m) => /Timeout ap.s \d+ms/.test(m))).toBe(true);
    });
  });
});
