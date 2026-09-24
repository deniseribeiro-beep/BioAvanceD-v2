import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DrugService = require('../../src/services/DrugService');
const { isExternalDrugLookupEnabled } = DrugService;
const logService = require('../../src/services/log.service');

describe('isExternalDrugLookupEnabled', () => {
  const ORIGINAL_EXTERNAL = process.env.ALLOW_EXTERNAL_DRUG_LOOKUP;
  const ORIGINAL_CLOUD = process.env.ALLOW_CLOUD_INTEGRATIONS;

  beforeEach(() => {
    delete process.env.ALLOW_EXTERNAL_DRUG_LOOKUP;
    delete process.env.ALLOW_CLOUD_INTEGRATIONS;
  });

  afterEach(() => {
    if (ORIGINAL_EXTERNAL === undefined) delete process.env.ALLOW_EXTERNAL_DRUG_LOOKUP;
    else process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = ORIGINAL_EXTERNAL;
    if (ORIGINAL_CLOUD === undefined) delete process.env.ALLOW_CLOUD_INTEGRATIONS;
    else process.env.ALLOW_CLOUD_INTEGRATIONS = ORIGINAL_CLOUD;
  });

  it('returns true for "true"', () => {
    process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = 'true';
    expect(isExternalDrugLookupEnabled()).toBe(true);
  });

  it('returns true for "1"', () => {
    process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = '1';
    expect(isExternalDrugLookupEnabled()).toBe(true);
  });

  it('is case/whitespace insensitive ("  TRUE  ")', () => {
    process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = '  TRUE  ';
    expect(isExternalDrugLookupEnabled()).toBe(true);
  });

  it('returns false when unset', () => {
    expect(isExternalDrugLookupEnabled()).toBe(false);
  });

  it('returns false for "false"', () => {
    process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = 'false';
    expect(isExternalDrugLookupEnabled()).toBe(false);
  });

  it('falls back to ALLOW_CLOUD_INTEGRATIONS when the primary var is unset', () => {
    process.env.ALLOW_CLOUD_INTEGRATIONS = 'true';
    expect(isExternalDrugLookupEnabled()).toBe(true);
  });
});

describe('DrugService#_normalizeDrugRecord', () => {
  const service = new DrugService({});

  it('normalizes a fully-populated local row', () => {
    const result = service._normalizeDrugRecord({
      generic_name: 'Paracetamol',
      name: 'Tylenol',
      code: 'ATC:N02BE01',
      atc_code: 'atc:n02be01',
      atc_level_1: 'n',
      atc_classifications: ['ATC:N02BE01', 'n02be51'],
      source: 'LOCAL',
      drug_class: 'Custom Class',
      disease_categories: ['Pain'],
      synonyms: ['APAP'],
    });

    expect(result.atc_code).toBe('N02BE01');
    expect(result.atc_classifications).toEqual(['N02BE01', 'N02BE51']);
    expect(result.atc_level_1).toBe('N');
    expect(result.drug_class).toBe('Custom Class');
    expect(result.disease_categories).toEqual(['Pain']);
    expect(result.synonyms).toEqual(['APAP']);
  });

  it('defaults missing fields (empty row)', () => {
    const result = service._normalizeDrugRecord({});
    expect(result).toEqual({
      generic_name: '',
      name: '',
      code: '',
      atc_code: '',
      atc_level_1: '',
      atc_classifications: [],
      source: 'LOCAL',
      drug_class: '',
      disease_categories: [],
      synonyms: [],
    });
  });

  it('derives atc_level_1 and drug_class from atc_code when atc_level_1 missing', () => {
    const result = service._normalizeDrugRecord({ code: 'ATC:C09AA01' });
    expect(result.atc_level_1).toBe('C');
    expect(result.drug_class).toBe('Cardiovascular system');
    expect(result.code).toBe('ATC:C09AA01');
  });

  it('keeps an unknown ATC level without inventing a drug-class label', () => {
    const result = service._normalizeDrugRecord({ atc_code: 'Z99ZZ99' });
    expect(result.atc_level_1).toBe('Z');
    expect(result.drug_class).toBe('');
  });

  it('falls back to [atcCode] for atc_classifications when row does not carry an array', () => {
    const result = service._normalizeDrugRecord({ atc_code: 'J01CA04' });
    expect(result.atc_classifications).toEqual(['J01CA04']);
  });

  it('ignores non-array disease_categories/synonyms and defaults to []', () => {
    const result = service._normalizeDrugRecord({
      disease_categories: 'not-an-array',
      synonyms: 'also-not-an-array',
    });
    expect(result.disease_categories).toEqual([]);
    expect(result.synonyms).toEqual([]);
  });
});

describe('DrugService#_cacheDrugs', () => {
  let service;
  let collection;

  beforeEach(() => {
    service = new DrugService({});
    collection = { bulkWrite: vi.fn().mockResolvedValue({}) };
  });

  it('no-ops for an empty array', async () => {
    await service._cacheDrugs([], collection);
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('no-ops for a non-array input', async () => {
    await service._cacheDrugs(null, collection);
    expect(collection.bulkWrite).not.toHaveBeenCalled();
  });

  it('uses name/source/class fallbacks for a cacheable row that omits normalized optional aliases', async () => {
    await service._cacheDrugs([
      {
        name: 'Synthetic Z Drug',
        code: 'ATC:Z99ZZ99',
        atc_code: 'Z99ZZ99',
        atc_level_1: 'Z',
        atc_classifications: ['Z99ZZ99'],
      },
    ], collection);

    const op = collection.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(op.filter).toEqual({ generic_name: 'Synthetic Z Drug', atc_code: 'Z99ZZ99' });
    expect(op.update.$set).toMatchObject({
      generic_name: 'Synthetic Z Drug',
      name: 'Synthetic Z Drug',
      drug_class: '',
      source: 'CHEMBL',
    });
  });

  it('builds one upsert updateOne op per drug with expected shape', async () => {
    const drugs = [
      {
        generic_name: 'Ibuprofen',
        name: 'Ibuprofen',
        code: 'ATC:M01AE01',
        atc_code: 'M01AE01',
        atc_level_1: 'M',
        atc_classifications: ['M01AE01'],
        source: 'CHEMBL',
      },
    ];

    await service._cacheDrugs(drugs, collection);

    expect(collection.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops, opts] = collection.bulkWrite.mock.calls[0];
    expect(opts).toEqual({ ordered: false });
    expect(ops).toHaveLength(1);
    const op = ops[0].updateOne;
    expect(op.filter).toEqual({ generic_name: 'Ibuprofen', atc_code: 'M01AE01' });
    expect(op.upsert).toBe(true);
    expect(op.update.$set.generic_name).toBe('Ibuprofen');
    expect(op.update.$set.drug_class).toBe('Musculo-skeletal system');
    expect(op.update.$setOnInsert).toHaveProperty('createdAt');
  });
});

describe('DrugService#_logAtcDictionarySync', () => {
  let createLogSpy;

  beforeEach(() => {
    createLogSpy = vi.spyOn(logService, 'createLog');
  });

  afterEach(() => {
    createLogSpy.mockRestore();
  });

  it('returns without calling logService.createLog when this.db is falsy', async () => {
    const service = new DrugService(null);
    await service._logAtcDictionarySync({
      query: 'aspirin',
      cacheMiss: true,
      upsertedCount: 0,
      status: 'warning',
      message: 'msg',
      auditContext: null,
    });
    expect(createLogSpy).not.toHaveBeenCalled();
  });

  it('swallows errors from logService.createLog and resolves normally', async () => {
    createLogSpy.mockRejectedValue(new Error('boom'));
    const service = new DrugService({ some: 'db' });
    await expect(
      service._logAtcDictionarySync({
        query: 'aspirin',
        cacheMiss: true,
        upsertedCount: 0,
        status: 'warning',
        message: 'msg',
        auditContext: null,
      })
    ).resolves.toBeUndefined();
    expect(createLogSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves the audit actor from req.user.id when canonical userID is absent', async () => {
    createLogSpy.mockResolvedValue({});
    const service = new DrugService({ some: 'db' });

    await service._logAtcDictionarySync({
      query: 'aspirin',
      cacheMiss: true,
      upsertedCount: 1,
      status: 'success',
      message: 'msg',
      auditContext: { req: { user: { id: 'legacy-user-id' } } },
    });

    expect(createLogSpy.mock.calls[0][1].userID).toBe('USR-SYSTEM');
  });

  it('calls logService.createLog with the given status when db is present', async () => {
    createLogSpy.mockResolvedValue({});
    const service = new DrugService({ some: 'db' });
    await service._logAtcDictionarySync({
      query: 'aspirin',
      cacheMiss: true,
      upsertedCount: 3,
      status: 'success',
      message: 'msg',
      auditContext: null,
    });
    expect(createLogSpy).toHaveBeenCalledTimes(1);
    const [, payload] = createLogSpy.mock.calls[0];
    expect(payload.status).toBe('success');
    expect(payload.payload.upsertedCount).toBe(3);
  });
});

function makeDb(localRows) {
  const toArray = vi.fn().mockResolvedValue(localRows);
  const limit = vi.fn().mockReturnValue({ toArray });
  const find = vi.fn().mockReturnValue({ limit });
  const collection = { find, bulkWrite: vi.fn().mockResolvedValue({}) };
  const db = { collection: vi.fn().mockReturnValue(collection) };
  return { db, collection, find, limit, toArray };
}

describe('DrugService#searchAndCacheDrug', () => {
  const ORIGINAL_EXTERNAL = process.env.ALLOW_EXTERNAL_DRUG_LOOKUP;
  const ORIGINAL_CHEMBL_URL = process.env.CHEMBL_API_URL;
  let createLogSpy;

  beforeEach(() => {
    delete process.env.ALLOW_EXTERNAL_DRUG_LOOKUP;
    delete process.env.CHEMBL_API_URL;
    createLogSpy = vi.spyOn(logService, 'createLog').mockResolvedValue({});
  });

  afterEach(() => {
    if (ORIGINAL_EXTERNAL === undefined) delete process.env.ALLOW_EXTERNAL_DRUG_LOOKUP;
    else process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = ORIGINAL_EXTERNAL;
    if (ORIGINAL_CHEMBL_URL === undefined) delete process.env.CHEMBL_API_URL;
    else process.env.CHEMBL_API_URL = ORIGINAL_CHEMBL_URL;
    createLogSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('returns [] for an empty query without touching this.db', async () => {
    const db = { collection: vi.fn() };
    const service = new DrugService(db);
    const result = await service.searchAndCacheDrug('   ');
    expect(result).toEqual([]);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('clamps an oversized limit to 50', async () => {
    const { db, limit } = makeDb([]);
    const service = new DrugService(db);
    await service.searchAndCacheDrug('aspirin', { limit: 500 });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('clamps a limit of 0 up to the documented floor of 1 (#71)', async () => {
    const { db, limit } = makeDb([]);
    const service = new DrugService(db);
    await service.searchAndCacheDrug('aspirin', { limit: 0 });
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('clamps a negative limit up to 1', async () => {
    const { db, limit } = makeDb([]);
    const service = new DrugService(db);
    await service.searchAndCacheDrug('aspirin', { limit: -5 });
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('returns normalized records when local rows are found, without calling ChEMBL', async () => {
    const { db } = makeDb([{ generic_name: 'Aspirin', code: 'ATC:N02BA01' }]);
    const service = new DrugService(db);
    const chemblSpy = vi.spyOn(service, '_searchChembl');

    const result = await service.searchAndCacheDrug('aspirin');

    expect(chemblSpy).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        generic_name: 'Aspirin',
        name: '',
        code: 'ATC:N02BA01',
        atc_code: 'N02BA01',
        atc_level_1: 'N',
        atc_classifications: ['N02BA01'],
        source: 'LOCAL',
        drug_class: 'Nervous system',
        disease_categories: [],
        synonyms: [],
      },
    ]);
  });

  it('returns [] and logs a warning audit when no local rows and external lookup disabled', async () => {
    const { db } = makeDb([]);
    const service = new DrugService(db);

    const result = await service.searchAndCacheDrug('aspirin');

    expect(result).toEqual([]);
    expect(createLogSpy).toHaveBeenCalledTimes(1);
    const [, payload] = createLogSpy.mock.calls[0];
    expect(payload.status).toBe('warning');
    expect(payload.payload.cacheMiss).toBe(true);
    expect(payload.payload.upsertedCount).toBe(0);
  });

  it('returns [] and logs a warning audit when external lookup enabled but ChEMBL returns nothing', async () => {
    process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = 'true';
    const { db } = makeDb([]);
    const service = new DrugService(db);
    vi.spyOn(service, '_searchChembl').mockResolvedValue([]);

    const result = await service.searchAndCacheDrug('aspirin');

    expect(result).toEqual([]);
    expect(createLogSpy).toHaveBeenCalledTimes(1);
    expect(createLogSpy.mock.calls[0][1].status).toBe('warning');
  });

  it('returns raw (un-normalized) ChEMBL rows when external lookup succeeds, and caches + logs success', async () => {
    process.env.ALLOW_EXTERNAL_DRUG_LOOKUP = 'true';
    const { db, collection } = makeDb([]);
    const service = new DrugService(db);

    const remoteRows = [{ generic_name: 'Ibuprofen', atc_code: 'M01AE01', source: 'CHEMBL' }];
    const chemblSpy = vi.spyOn(service, '_searchChembl').mockResolvedValue(remoteRows);
    const cacheSpy = vi.spyOn(service, '_cacheDrugs').mockResolvedValue();

    const result = await service.searchAndCacheDrug('ibuprofen');

    expect(chemblSpy).toHaveBeenCalledWith('ibuprofen', 10);
    // NOTE: returned rows are the raw ChEMBL-mapped rows, not re-normalized via
    // _normalizeDrugRecord (asymmetric with the local-row path above).
    expect(result).toBe(remoteRows);
    expect(cacheSpy).toHaveBeenCalledWith(remoteRows, collection);
    expect(createLogSpy).toHaveBeenCalledTimes(1);
    const [, payload] = createLogSpy.mock.calls[0];
    expect(payload.status).toBe('success');
    expect(payload.payload.upsertedCount).toBe(1);
  });
});

describe('DrugService#_searchChembl', () => {
  const ORIGINAL_CHEMBL_URL = process.env.CHEMBL_API_URL;

  afterEach(() => {
    if (ORIGINAL_CHEMBL_URL === undefined) delete process.env.CHEMBL_API_URL;
    else process.env.CHEMBL_API_URL = ORIGINAL_CHEMBL_URL;
    vi.unstubAllGlobals();
  });

  it('returns [] and skips fetch entirely when CHEMBL_API_URL is unset', async () => {
    delete process.env.CHEMBL_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new DrugService({});

    const result = await service._searchChembl('aspirin', 10);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the response is not ok', async () => {
    process.env.CHEMBL_API_URL = 'https://chembl.example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const service = new DrugService({});

    await expect(service._searchChembl('aspirin', 10)).rejects.toThrow(/503/);
  });

  it('skips molecules missing pref_name or with empty atc_classifications', async () => {
    process.env.CHEMBL_API_URL = 'https://chembl.example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        molecules: [
          { pref_name: '', atc_classifications: ['N02BA01'] },
          { pref_name: 'NoAtc', atc_classifications: [] },
          { pref_name: 'NoAtcField' },
        ],
      }),
    }));
    const service = new DrugService({});

    const result = await service._searchChembl('x', 10);
    expect(result).toEqual([]);
  });

  it('fans out a molecule with multiple ATC codes into multiple rows', async () => {
    process.env.CHEMBL_API_URL = 'https://chembl.example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        molecules: [
          { pref_name: 'MultiDrug', atc_classifications: ['N02BA01', 'N02BA02'] },
        ],
      }),
    }));
    const service = new DrugService({});

    const result = await service._searchChembl('multidrug', 10);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.atc_code).sort()).toEqual(['N02BA01', 'N02BA02']);
  });

  it('deduplicates identical name|atc_code pairs into a single row', async () => {
    process.env.CHEMBL_API_URL = 'https://chembl.example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        molecules: [
          { pref_name: 'DupDrug', atc_classifications: ['N02BA01'] },
          { pref_name: 'DupDrug', atc_classifications: ['N02BA01'] },
        ],
      }),
    }));
    const service = new DrugService({});

    const result = await service._searchChembl('dupdrug', 10);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('DupDrug');
    expect(result[0].atc_code).toBe('N02BA01');
  });
});
