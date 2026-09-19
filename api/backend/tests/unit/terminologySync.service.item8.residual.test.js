import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MODULE_PATH = require.resolve('../../src/services/terminologySync.service');
const Terminology = require('../../src/models/Terminology');
const logger = require('../../src/utils/logger');

function freshService(baseUrl = 'https://orphadata.example.invalid') {
  process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
  process.env.ORPHADATA_BASE_URL = baseUrl;
  delete require.cache[MODULE_PATH];
  return require('../../src/services/terminologySync.service');
}

function response({ ok = true, status = 200, statusText = 'OK', contentType = 'application/json', body = '' } = {}) {
  return {
    ok,
    status,
    statusText,
    headers: { get: () => contentType },
    text: async () => body,
  };
}

describe('terminologySync.service item 8 residual branches', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete require.cache[MODULE_PATH];
  });

  it('normalizes external-reference id/value fallbacks and ignores references without a source', () => {
    const svc = freshService();

    const normalized = svc.normalizeRecord({
      codigo: 'SYN-1',
      descricao: 'Synthetic terminology',
      ExternalReference: [
        { Source: 'ICD-10', id: 'A10.1' },
        { source: 'OMIM', value: '100001' },
        { Reference: 'SHOULD-NOT-MATCH' },
      ],
    });

    expect(normalized.relacoes.cid).toBe('A10.1');
    expect(normalized.relacoes.omim).toBe('OMIM:100001');

    const noSource = svc.normalizeRecord({
      codigo: 'SYN-2',
      descricao: 'No sourced reference',
      ExternalReference: [{ Reference: 'IGNORED' }],
    });
    expect(noSource.relacoes.cid).toBe('');
    expect(noSource.relacoes.omim).toBe('');
  });

  it('normalizes the remaining direct ICD aliases without requiring an external reference', () => {
    const svc = freshService();

    expect(svc.normalizeRecord({
      codigo: 'SYN-ICD10',
      descricao: 'Synthetic ICD10 alias',
      ICD10: 'B20.1',
    }).relacoes.cid).toBe('B20.1');

    expect(svc.normalizeRecord({
      codigo: 'SYN-ICD',
      descricao: 'Synthetic icdCode alias',
      icdCode: 'C30.2',
    }).relacoes.cid).toBe('C30.2');

    expect(svc.normalizeRecord({
      codigo: 'SYN-COD',
      descricao: 'Synthetic Codigos alias',
      Codigos_CID10: 'D40.3',
    }).relacoes.cid).toBe('D40.3');
  });

  it('handles malformed JSON when content-type is absent and reports every consulted endpoint', async () => {
    const svc = freshService();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      contentType: undefined,
      body: '<not-json>',
    })));

    const result = await svc.syncFromOrphadata();

    expect(result.success).toBe(false);
    expect(result.consulted).toHaveLength(3);
    expect(warn.mock.calls.some(([message]) =>
      message.includes('content-type: "desconhecido"')
    )).toBe(true);
  });

  it('uses a response message on non-OK JSON and falls back to HTTP status without statusText', async () => {
    let svc = freshService();
    let warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: JSON.stringify({ message: 'synthetic maintenance' }),
    })));

    let result = await svc.syncFromOrphadata();

    expect(result.success).toBe(false);
    expect(warn.mock.calls.some(([message]) => message.includes('synthetic maintenance'))).toBe(true);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete require.cache[MODULE_PATH];

    svc = freshService();
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      status: 502,
      statusText: '',
      body: '',
    })));

    result = await svc.syncFromOrphadata();

    expect(result.success).toBe(false);
    expect(warn.mock.calls.some(([message]) => message.includes('HTTP 502'))).toBe(true);
  });

  it('counts an invalid object as skipped while accepting lowercase orphaCode as a valid sync record', async () => {
    const svc = freshService('https://orphadata.example.invalid/');
    const upsert = vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      body: JSON.stringify([
        {},
        { orphaCode: '558', description: 'Synthetic ORPHA record' },
      ]),
    })));

    const result = await svc.syncFromOrphadata();

    expect(result).toEqual(expect.objectContaining({
      success: true,
      upserted: 1,
      skipped: 1,
    }));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sistema: 'ORPHA', codigo: 'ORPHA:558' }),
      expect.anything(),
      expect.anything()
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://orphadata.example.invalid/rd-cross-referencing/orphacodes?limit=1000',
      expect.anything()
    );
  });
});
