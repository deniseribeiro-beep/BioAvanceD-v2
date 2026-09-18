import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const pipelinePath = require.resolve('../../src/reference-data/reference-imports/pipeline');
const indexPath = require.resolve('../../src/reference-data/reference-imports/index');

const originalPipeline = require(pipelinePath);
const runImport = vi.fn(async (input) => ({
  sourceId: input.source?.sourceId || input.source?.id || input.source?.name || 'source',
  marker: input.marker || null,
  db: input.db,
  source: input.source,
  normalizeRecord: input.normalizeRecord,
}));

let imports;

beforeAll(() => {
  require.cache[pipelinePath].exports = {
    ...originalPipeline,
    runImport,
  };
  delete require.cache[indexPath];
  imports = require(indexPath);
});

afterAll(() => {
  require.cache[pipelinePath].exports = originalPipeline;
  delete require.cache[indexPath];
});

describe('reference-data importer facade item 8 coverage', () => {
  const importers = [
    ['runHpoImport', 'hpo'],
    ['runMondoImport', 'mondo'],
    ['runOrphaImport', 'orpha'],
    ['runIcd11Import', 'icd11'],
    ['runIcd10Import', 'icd10'],
    ['runOmimImport', 'omim'],
    ['runHgncImport', 'hgnc'],
    ['runLoincImport', 'loinc'],
    ['runUcumImport', 'ucum'],
    ['runDcbImport', 'dcb'],
    ['runAtcImport', 'atc'],
    ['runDuoImport', 'duo'],
    ['runUberonImport', 'uberon'],
    ['runNcbitaxImport', 'ncbitax'],
    ['runClImport', 'cl'],
    ['runEdamImport', 'edam'],
  ];

  it.each(importers)('%s delegates its canonical source and normalizer to runImport', async (method) => {
    runImport.mockClear();
    const db = { marker: method };
    const result = await imports[method](db, { marker: 'custom-option', batchSize: 25 });

    expect(runImport).toHaveBeenCalledTimes(1);
    const call = runImport.mock.calls[0][0];
    expect(call.db).toBe(db);
    expect(call.source).toBeTruthy();
    expect(typeof call.normalizeRecord).toBe('function');
    expect(call.marker).toBe('custom-option');
    expect(call.batchSize).toBe(25);
    expect(result.db).toBe(db);
  });

  it.each(importers)('%s accepts the default empty options object', async (method) => {
    runImport.mockClear();
    const db = { marker: `${method}-default` };

    await imports[method](db);

    expect(runImport).toHaveBeenCalledTimes(1);
    const call = runImport.mock.calls[0][0];
    expect(call.db).toBe(db);
    expect(call).not.toHaveProperty('marker');
    expect(call.source).toBeTruthy();
    expect(typeof call.normalizeRecord).toBe('function');
  });
});
