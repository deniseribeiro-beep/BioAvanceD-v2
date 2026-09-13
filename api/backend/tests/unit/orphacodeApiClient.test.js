import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  OrphacodeApiClient,
  DETAIL_ENDPOINTS,
  normalizeApiLang,
  parseLanguages,
} = require('../../src/services/orphanet/orphacodeApiClient');

function jsonResponse(body, status = 200, ok = true) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('orphacodeApiClient', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ORPHACODE_BASE_URL;
    delete process.env.ORPHACODE_API_KEY;
    delete process.env.ORPHACODE_USERNAME;
    delete process.env.ORPHACODE_DELAY_MS;
    delete process.env.ORPHACODE_CONCURRENCY;
    delete process.env.ORPHACODE_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('normalizeApiLang', () => {
    it('uppercases and trims a valid language', () => {
      expect(normalizeApiLang(' en ')).toBe('EN');
    });

    it('throws on an unsupported language', () => {
      expect(() => normalizeApiLang('XX')).toThrow(/Invalid ORPHAcodes API language "XX"/);
    });

    it('throws on an undefined language, stringifying it in the message', () => {
      expect(() => normalizeApiLang(undefined)).toThrow(/Invalid ORPHAcodes API language "undefined"/);
    });
  });

  describe('parseLanguages', () => {
    it('defaults to PT,EN when value is undefined', () => {
      expect(parseLanguages(undefined)).toEqual(['PT', 'EN']);
    });

    it('parses a comma-separated string, trimming and uppercasing each', () => {
      expect(parseLanguages(' es , fr ')).toEqual(['ES', 'FR']);
    });

    it('accepts an array of languages directly', () => {
      expect(parseLanguages(['it', 'nl'])).toEqual(['IT', 'NL']);
    });
  });

  describe('constructor', () => {
    it('applies defaults when no options or env vars are set', () => {
      const client = new OrphacodeApiClient();
      expect(client.baseUrl).toBe('https://api.orphacode.org');
      expect(client.apiKey).toBe('bioavanced-local');
      expect(client.langs).toEqual(['PT', 'EN']);
      expect(client.delayMs).toBe(250);
      expect(client.concurrency).toBe(2);
      expect(client.timeoutMs).toBe(20000);
      expect(client.retries).toBe(2);
      expect(client.quiet).toBe(false);
    });

    it('strips trailing slashes from a custom baseUrl', () => {
      const client = new OrphacodeApiClient({ baseUrl: 'https://example.com/api///' });
      expect(client.baseUrl).toBe('https://example.com/api');
    });

    it('reads baseUrl/apiKey/delay/concurrency/timeout from env vars', () => {
      process.env.ORPHACODE_BASE_URL = 'https://env.example.com/';
      process.env.ORPHACODE_API_KEY = 'env-key';
      process.env.ORPHACODE_DELAY_MS = '10';
      process.env.ORPHACODE_CONCURRENCY = '5';
      process.env.ORPHACODE_TIMEOUT_MS = '1000';
      const client = new OrphacodeApiClient();
      expect(client.baseUrl).toBe('https://env.example.com');
      expect(client.apiKey).toBe('env-key');
      expect(client.delayMs).toBe(10);
      expect(client.concurrency).toBe(5);
      expect(client.timeoutMs).toBe(1000);
    });

    it('falls back to ORPHACODE_USERNAME, then options.username, before the hardcoded default', () => {
      process.env.ORPHACODE_USERNAME = 'user-from-env';
      const client = new OrphacodeApiClient();
      expect(client.apiKey).toBe('user-from-env');

      delete process.env.ORPHACODE_USERNAME;
      const client2 = new OrphacodeApiClient({ username: 'user-from-option' });
      expect(client2.apiKey).toBe('user-from-option');
    });

    it('clamps concurrency to a minimum of 1', () => {
      const client = new OrphacodeApiClient({ concurrency: 0 });
      expect(client.concurrency).toBe(1);
    });

    it('options take priority over env vars', () => {
      process.env.ORPHACODE_BASE_URL = 'https://env.example.com';
      const client = new OrphacodeApiClient({ baseUrl: 'https://option.example.com' });
      expect(client.baseUrl).toBe('https://option.example.com');
    });
  });

  describe('buildUrl', () => {
    it('joins baseUrl and pathname without a double slash', () => {
      const client = new OrphacodeApiClient({ baseUrl: 'https://example.com' });
      expect(client.buildUrl('/EN/ClinicalEntity')).toBe('https://example.com/EN/ClinicalEntity');
    });

    it('prefixes a leading slash onto pathname when missing', () => {
      const client = new OrphacodeApiClient({ baseUrl: 'https://example.com' });
      expect(client.buildUrl('EN/ClinicalEntity')).toBe('https://example.com/EN/ClinicalEntity');
    });

    it('appends a query string from params, dropping undefined/null/empty values', () => {
      const client = new OrphacodeApiClient({ baseUrl: 'https://example.com' });
      const url = client.buildUrl('/EN/ClinicalEntity', { limit: 10, skip: undefined, name: null, q: '' });
      expect(url).toBe('https://example.com/EN/ClinicalEntity?limit=10');
    });

    it('omits the query string entirely when there are no usable params', () => {
      const client = new OrphacodeApiClient({ baseUrl: 'https://example.com' });
      expect(client.buildUrl('/EN/ClinicalEntity', {})).toBe('https://example.com/EN/ClinicalEntity');
    });
  });

  describe('throttle', () => {
    it('does not wait when delayMs is 0', async () => {
      const client = new OrphacodeApiClient({ delayMs: 0 });
      const start = client.lastRequestAt;
      await client.throttle();
      expect(client.lastRequestAt).toBe(start);
    });

    it('waits out the remaining delay since the last request', async () => {
      vi.useFakeTimers();
      const client = new OrphacodeApiClient({ delayMs: 100 });
      client.lastRequestAt = Date.now();
      vi.advanceTimersByTime(40);

      const p = client.throttle();
      let resolved = false;
      p.then(() => { resolved = true; });

      await vi.advanceTimersByTimeAsync(50);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(20);
      expect(resolved).toBe(true);
    });
  });

  describe('fetchJson', () => {
    it('returns parsed JSON on a successful response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.fetchJson('/EN/ClinicalEntity');
      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns the raw text when the body is not valid JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'not json' });
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.fetchJson('/EN/ClinicalEntity');
      expect(result).toBe('not json');
    });

    it('returns null when body text is empty', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.fetchJson('/EN/ClinicalEntity');
      expect(result).toBeNull();
    });

    it('returns null on a 404 when allowNotFound is set, without throwing', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'not found' }, 404, false));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.fetchJson('/EN/ClinicalEntity/orphacode/1/ICD10', {}, { allowNotFound: true });
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws immediately on a 404 without retrying, even without allowNotFound', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'gone' }, 404, false));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 2, quiet: true });

      await expect(client.fetchJson('/EN/ClinicalEntity/orphacode/1')).rejects.toThrow('gone');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('uses payload.error when payload.message is absent, and HTTP status as last resort', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request' }, 400, false));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 0, quiet: true });

      await expect(client.fetchJson('/EN/ClinicalEntity')).rejects.toThrow('bad request');

      const fetchMock2 = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '' });
      vi.stubGlobal('fetch', fetchMock2);
      const client2 = new OrphacodeApiClient({ delayMs: 0, retries: 0, quiet: true });
      await expect(client2.fetchJson('/EN/ClinicalEntity')).rejects.toThrow('HTTP 400');
    });

    it('retries on a 500 response and succeeds on the second attempt', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ message: 'server error' }, 500, false))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 2, quiet: true });

      const promise = client.fetchJson('/EN/ClinicalEntity');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on a network error (no status) and eventually throws once retries are exhausted', async () => {
      vi.useFakeTimers();
      const networkError = new Error('network down');
      const fetchMock = vi.fn().mockRejectedValue(networkError);
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 1, quiet: true });

      const promise = client.fetchJson('/EN/ClinicalEntity');
      promise.catch(() => {});
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('network down');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 4xx error other than 429 (shouldRetry returns false)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'forbidden' }, 403, false));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 3, quiet: true });

      await expect(client.fetchJson('/EN/ClinicalEntity')).rejects.toThrow('forbidden');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries a 429 response', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, 429, false))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 1, quiet: true });

      const promise = client.fetchJson('/EN/ClinicalEntity');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('converts an AbortError into a timeout error message', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 0, timeoutMs: 5000, quiet: true });

      const promise = client.fetchJson('/EN/ClinicalEntity');
      promise.catch(() => {});
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Timeout after 5000ms');
    });

    it('logs attempt/failure lines when quiet is false', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad' }, 400, false));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 0, quiet: false });

      await expect(client.fetchJson('/EN/ClinicalEntity')).rejects.toThrow('bad');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[orphanet-api] GET /EN/ClinicalEntity attempt=1'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[orphanet-api] failed /EN/ClinicalEntity: bad'));
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('clinicalEntities / clinicalEntity / clinicalEntityResource', () => {
    it('clinicalEntities normalizes lang and calls the ClinicalEntity list endpoint with params', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1 }]));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.clinicalEntities('en', { limit: 5 });
      expect(result).toEqual([{ id: 1 }]);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.orphacode.org/EN/ClinicalEntity?limit=5',
        expect.any(Object)
      );
    });

    it('clinicalEntities rejects an invalid language before calling fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      await expect(client.clinicalEntities('xx')).rejects.toThrow(/Invalid ORPHAcodes API language/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('clinicalEntity builds the orphacode-scoped detail URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 79430 }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.clinicalEntity('PT', '79430');
      expect(result).toEqual({ id: 79430 });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.orphacode.org/PT/ClinicalEntity/orphacode/79430',
        expect.any(Object)
      );
    });

    it('clinicalEntity URL-encodes the orphacode value', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      await client.clinicalEntity('EN', 'a/b c');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.orphacode.org/EN/ClinicalEntity/orphacode/a%2Fb%20c',
        expect.any(Object)
      );
    });

    it('clinicalEntityResource requests a single resource with allowNotFound set', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'nf' }, 404, false));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, quiet: true });

      const result = await client.clinicalEntityResource('EN', '123', 'ICD10');
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.orphacode.org/EN/ClinicalEntity/orphacode/123/ICD10',
        expect.any(Object)
      );
    });
  });

  describe('clinicalEntityResources', () => {
    it('fetches every DETAIL_ENDPOINTS resource by default and keys the output by resource name', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 'x' }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, concurrency: 3, quiet: true });

      const result = await client.clinicalEntityResources('EN', '123');
      expect(Object.keys(result).sort()).toEqual([...DETAIL_ENDPOINTS].sort());
      expect(fetchMock).toHaveBeenCalledTimes(DETAIL_ENDPOINTS.length);
      expect(result.Name).toEqual({ value: 'x' });
    });

    it('respects a custom resources list, only fetching those', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 'y' }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, concurrency: 2, quiet: true });

      const result = await client.clinicalEntityResources('EN', '123', ['Name', 'Synonym']);
      expect(Object.keys(result).sort()).toEqual(['Name', 'Synonym']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('captures a per-resource failure as { error } instead of rejecting the whole call', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ value: 'ok' }))
        .mockRejectedValueOnce(new Error('resource boom'));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, retries: 0, concurrency: 2, quiet: true });

      const result = await client.clinicalEntityResources('EN', '123', ['Name', 'Synonym']);
      expect(result.Name).toEqual({ value: 'ok' });
      expect(result.Synonym).toEqual({ error: 'resource boom' });
    });

    it('caps worker count at the resource list length even with a larger concurrency setting', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 'z' }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new OrphacodeApiClient({ delayMs: 0, concurrency: 10, quiet: true });

      const result = await client.clinicalEntityResources('EN', '123', ['Name']);
      expect(Object.keys(result)).toEqual(['Name']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
