// backend/tests/unit/services/hpoService.test.js
const path = require('path');

const ORIGINAL_ENV = { ...process.env };
const HPO_SERVICE_PATH = path.resolve(__dirname, '../../../src/services/hpoService.js');

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

// hpoService.js captures HPO_API_URL as a module-level const at require() time. vi.resetModules()
// resets Vitest's own module registry but does not reliably clear Node's real require.cache for
// this CJS module, so a stale module instance (with HPO_API_URL frozen from the first load) can
// keep being returned. Force a real re-require by deleting the entry from require.cache directly.
function freshHpoService() {
  delete require.cache[HPO_SERVICE_PATH];
  vi.resetModules();
  return require('../../../src/services/hpoService');
}

describe('hpoService', () => {
  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  describe('isExternalHpoLookupEnabled', () => {
    let hpoService;

    beforeEach(() => {
      hpoService = freshHpoService();
    });

    it('returns true when ALLOW_EXTERNAL_HPO_LOOKUP is "true"', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(true);
    });

    it('returns true when ALLOW_EXTERNAL_HPO_LOOKUP is "1"', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = '1';
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(true);
    });

    it('is case-insensitive ("TRUE")', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'TRUE';
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(true);
    });

    it('trims surrounding whitespace', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = '  true  ';
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(true);
    });

    it('falls back to ALLOW_CLOUD_INTEGRATIONS when ALLOW_EXTERNAL_HPO_LOOKUP is unset', () => {
      delete process.env.ALLOW_EXTERNAL_HPO_LOOKUP;
      process.env.ALLOW_CLOUD_INTEGRATIONS = 'true';
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(true);
    });

    it('prefers ALLOW_EXTERNAL_HPO_LOOKUP over ALLOW_CLOUD_INTEGRATIONS when both set', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'false';
      process.env.ALLOW_CLOUD_INTEGRATIONS = 'true';
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(false);
    });

    it('returns false for "yes" (only "true"/"1" are truthy)', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'yes';
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(false);
    });

    it('returns false when neither env var is set', () => {
      delete process.env.ALLOW_EXTERNAL_HPO_LOOKUP;
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(false);
    });

    it('returns false for empty string value', () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = '';
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      expect(hpoService.isExternalHpoLookupEnabled()).toBe(false);
    });
  });

  describe('searchHpoExternal', () => {
    let hpoService;

    beforeEach(() => {
      hpoService = freshHpoService();
    });

    it('returns [] and does not call fetch when external lookup is disabled', async () => {
      delete process.env.ALLOW_EXTERNAL_HPO_LOOKUP;
      delete process.env.ALLOW_CLOUD_INTEGRATIONS;
      process.env.HPO_API_URL = 'https://hpo.example.com/search?q=';
      hpoService = freshHpoService();
      global.fetch = vi.fn();

      const result = await hpoService.searchHpoExternal('seizure');

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('returns [] and does not call fetch when HPO_API_URL is not configured', async () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      delete process.env.HPO_API_URL;
      hpoService = freshHpoService();
      global.fetch = vi.fn();

      const result = await hpoService.searchHpoExternal('seizure');

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('builds the request URL with encoded query and calls fetch when enabled', async () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      process.env.HPO_API_URL = 'https://hpo.example.com/search?q=';
      hpoService = freshHpoService();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response: { docs: [] } })
      });

      await hpoService.searchHpoExternal('febrile seizure');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hpo.example.com/search?q=febrile%20seizure&rows=20'
      );
    });

    it('maps successful response docs into the expected shape', async () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      process.env.HPO_API_URL = 'https://hpo.example.com/search?q=';
      hpoService = freshHpoService();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            docs: [
              {
                id: 'HP:0001250',
                label: 'Seizure',
                synonym: ['Fits'],
                definition: 'A seizure definition',
                is_obsolete: false
              }
            ]
          }
        })
      });

      const result = await hpoService.searchHpoExternal('seizure');

      expect(result).toEqual([
        {
          hpoId: 'HP:0001250',
          label: 'Seizure',
          synonyms: ['Fits'],
          definition: 'A seizure definition',
          isObsolete: false
        }
      ]);
    });

    it('returns [] when response.docs is missing from the payload', async () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      process.env.HPO_API_URL = 'https://hpo.example.com/search?q=';
      hpoService = freshHpoService();
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({})
      });

      const result = await hpoService.searchHpoExternal('seizure');

      expect(result).toEqual([]);
    });

    it('throws when the fetch response is not ok', async () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      process.env.HPO_API_URL = 'https://hpo.example.com/search?q=';
      hpoService = freshHpoService();
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({})
      });

      await expect(hpoService.searchHpoExternal('seizure')).rejects.toThrow(
        'Erro ao buscar na API HPO'
      );
    });

    it('propagates a network-level fetch rejection', async () => {
      process.env.ALLOW_EXTERNAL_HPO_LOOKUP = 'true';
      process.env.HPO_API_URL = 'https://hpo.example.com/search?q=';
      hpoService = freshHpoService();
      global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

      await expect(hpoService.searchHpoExternal('seizure')).rejects.toThrow(
        'network down'
      );
    });
  });

  describe('searchHpoLocal', () => {
    // #57: searchHpoLocal now takes a shared `db` handle (req.app.locals.db) instead of
    // opening/closing its own raw MongoClient per call, so tests mock a plain db/collection
    // object rather than the mongodb module.
    let toArrayMock;
    let findMock;
    let collectionMock;
    let dbMock;

    beforeEach(() => {
      vi.resetModules();

      toArrayMock = vi.fn().mockResolvedValue([{ hpoId: 'HP:0001250', label: 'Seizure' }]);
      findMock = vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: toArrayMock })
      });
      collectionMock = vi.fn().mockReturnValue({ find: findMock });
      dbMock = { collection: collectionMock };
    });

    it('queries the shared db handle with a case-insensitive regex OR across fields, without opening its own connection', async () => {
      const hpoService = require('../../../src/services/hpoService');

      const result = await hpoService.searchHpoLocal('seiz', dbMock);

      expect(collectionMock).toHaveBeenCalledWith('hpo_terms');
      expect(findMock).toHaveBeenCalledTimes(1);

      const filter = findMock.mock.calls[0][0];
      expect(filter.isObsolete).toEqual({ $ne: true });
      expect(filter.$or).toHaveLength(3);
      for (const clause of filter.$or) {
        const [field, regex] = Object.entries(clause)[0];
        expect(['label', 'hpoId', 'synonyms']).toContain(field);
        expect(regex).toBeInstanceOf(RegExp);
        expect(regex.flags).toBe('i');
        expect(regex.source).toBe('seiz');
      }

      expect(result).toEqual([{ hpoId: 'HP:0001250', label: 'Seizure' }]);
    });

    it('escapes regex metacharacters in the query instead of feeding them into RegExp raw (#56)', async () => {
      const hpoService = require('../../../src/services/hpoService');

      await hpoService.searchHpoLocal('a(b*c+', dbMock);

      const filter = findMock.mock.calls[0][0];
      const [, regex] = Object.entries(filter.$or[0])[0];
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('a(b*c+')).toBe(true);
      expect(regex.test('abc')).toBe(false);
    });
  });
});
