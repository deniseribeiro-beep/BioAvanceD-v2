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

    it('does not double-prefix an OMIM code that already carries OMIM: (case-insensitive)', () => {
      const result = svc.normalizeRecord({ codigo: 'omim:154700', sistema: 'OMIM', descricao: 'x' });
      expect(result.codigo).toBe('OMIM:154700');
    });

    it('derives sistema from record.system/source/tipo when sistema is absent', () => {
      expect(svc.normalizeRecord({ codigo: 'A', descricao: 'd', system: 'hpo' }).sistema).toBe('HPO');
      expect(svc.normalizeRecord({ codigo: 'A', descricao: 'd', source: 'cid' }).sistema).toBe('CID');
      expect(svc.normalizeRecord({ codigo: 'A', descricao: 'd', tipo: 'manual' }).sistema).toBe('MANUAL');
    });

    it('derives normalizedCodigo for OMIM system from record.OMIM/omim/omimCode fallbacks', () => {
      expect(svc.normalizeRecord({ sistema: 'OMIM', descricao: 'd', OMIM: '1' }).codigo).toBe('OMIM:1');
      expect(svc.normalizeRecord({ sistema: 'OMIM', descricao: 'd', omim: '2' }).codigo).toBe('OMIM:2');
      expect(svc.normalizeRecord({ sistema: 'OMIM', descricao: 'd', omimCode: '3' }).codigo).toBe('OMIM:3');
    });

    it('builds sinonimos from a plain synonyms array when sinonimos is absent', () => {
      const result = svc.normalizeRecord({ codigo: 'A', descricao: 'd', synonyms: ['Foo', ''] });
      expect(result.sinonimos).toEqual(['Foo']);
    });

    it('builds sinonimos from a Synonym array of objects using Label/_/plain-string fallbacks', () => {
      const result = svc.normalizeRecord({
        codigo: 'A',
        descricao: 'd',
        Synonym: [{ Label: 'A1' }, { _: 'A2' }, 'A3', { label: 'A4' }],
      });
      expect(result.sinonimos).toEqual(['A1', 'A2', 'A3', 'A4']);
    });

    it('defaults sinonimos to an empty array when none of the recognized fields are present', () => {
      const result = svc.normalizeRecord({ codigo: 'A', descricao: 'd' });
      expect(result.sinonimos).toEqual([]);
    });

    it('resolves relacoes.cid via ICD-10 externalReference lower-cased field names too', () => {
      const result = svc.normalizeRecord({
        codigo: 'A',
        descricao: 'd',
        externalReferences: { source: 'ICD-10', reference: 'Q99.9' },
      });
      expect(result.relacoes.cid).toBe('Q99.9');
    });

    it('falls back to code/id/value fields on the external reference entry itself', () => {
      const result = svc.normalizeRecord({
        codigo: 'A',
        descricao: 'd',
        externalReference: [{ Source: 'ICD-10', code: 'Q11.1' }],
      });
      expect(result.relacoes.cid).toBe('Q11.1');
    });
  });

  describe('#941 ensureTerminologyIndexes', () => {
    // #941's measured DELETEs. Terminology.js declared `index: true` on both,
    // inert under autoIndex:false. explain() on mongo:7: { ativo: 1 } is
    // picked for dictionary.js's `ativo: { $ne: false }` and walks ~98% of
    // the collection through the index -- slower than the COLLSCAN it
    // replaces. { codigo: 1 } wins only the sync upsert, and only because
    // the compound unique index is ineligible for that filter; that is
    // fixed at the compound, not by adding a second index.
    it.each([[{ ativo: 1 }], [{ codigo: 1 }]])('does NOT build %o', async (keys) => {
      const createIndex = vi.fn(async () => {});

      await svc.ensureTerminologyIndexes({ createIndex }, `941-not-built-${Object.keys(keys)[0]}`);

      expect(createIndex).toHaveBeenCalled();
      const built = createIndex.mock.calls.map(([k]) => JSON.stringify(k));
      expect(built).not.toContain(JSON.stringify(keys));
    });

    it('creates a unique index on { sistema: 1, codigo: 1 }, pinned by value', async () => {
      const createIndex = vi.fn(async () => {});
      const collection = { createIndex };

      await svc.ensureTerminologyIndexes(collection, '941-value-pin');

      expect(createIndex).toHaveBeenCalledTimes(1);
      const [keys, options] = createIndex.mock.calls[0];
      expect(keys).toEqual({ sistema: 1, codigo: 1 });
      expect(options).toEqual({
        name: 'terminologies_sistema_codigo_unique_v2',
        unique: true,
        partialFilterExpression: { sistema: { $type: 'string' }, codigo: { $type: 'string' } },
      });
    });

    // The index shipped by a936d385 was plain-unique with no partial filter,
    // and `terminologies` has a THIRD writer nobody counted: the essential
    // seed. `scripts/seed-essential-reference-data.js`'s `sprec-minimal` entry
    // writes SPREC axis rows carrying `code`, never `codigo`. Under a plain
    // unique index Mongo treats the missing field as null, so all four rows
    // share the key { 'SPREC', null } and collide with each other.
    //
    // Whichever order it happened, it failed silently: seed-then-index makes
    // createIndex throw E11000, which ensureTerminologyIndexes catches, warns
    // about, and then LATCHES anyway -- so the index never exists and never
    // retries. Index-then-seed fails the seed run instead.
    it('does not collide with the SPREC rows the essential seed writes to the same collection', async () => {
      const sprecSeed = require('../../src/reference-data/sprec.min.json');

      // Exactly the mapping scripts/seed-essential-reference-data.js applies.
      const seededDocs = sprecSeed.axes.map((axis) => ({
        sistema: sprecSeed.sistema,
        fonte: sprecSeed.fonte,
        axis: axis.axis,
        code: axis.code,
        label: axis.label,
        descricao: axis.descricao,
      }));

      // The premise: more than one row, none of them carrying `codigo`.
      expect(seededDocs.length).toBeGreaterThan(1);
      expect(seededDocs.every((doc) => doc.codigo === undefined)).toBe(true);

      const createIndex = vi.fn(async () => {});
      await svc.ensureTerminologyIndexes({ createIndex }, '941-sprec-collision');
      const [, options] = createIndex.mock.calls[0];

      // A partial filter is what keeps them out of the index entirely. Without
      // one, `unique: true` indexes them as four identical { SPREC, null }.
      expect(options.partialFilterExpression).toBeDefined();

      const matchesFilter = (doc) =>
        Object.entries(options.partialFilterExpression).every(
          ([field, cond]) => typeof doc[field] === (cond.$type === 'string' ? 'string' : typeof doc[field])
        );

      expect(seededDocs.filter(matchesFilter)).toEqual([]);
    });

    // The other half of a936d385: the index was wired into one of the two
    // writers its own comment named. `bulkUpsertTerminologies` writes only
    // rows that already carry a string `codigo`, so those DO enter the index
    // and are exactly what it is meant to deduplicate.
    it('indexes the rows bulkUpsertTerminologies actually writes', async () => {
      const createIndex = vi.fn(async () => {});
      await svc.ensureTerminologyIndexes({ createIndex }, '941-bulk-rows');
      const [, options] = createIndex.mock.calls[0];

      const realRow = { sistema: 'ORPHA', codigo: 'ORPHA:558', descricao: 'Marfan' };
      const matchesFilter = Object.entries(options.partialFilterExpression).every(
        ([field, cond]) => cond.$type !== 'string' || typeof realRow[field] === 'string'
      );

      expect(matchesFilter).toBe(true);
    });

    it('does not call createIndex again for the same collectionName (once per process, not per call)', async () => {
      const createIndex = vi.fn(async () => {});
      const collection = { createIndex };

      await svc.ensureTerminologyIndexes(collection, '941-once-per-process');
      await svc.ensureTerminologyIndexes(collection, '941-once-per-process');
      await svc.ensureTerminologyIndexes(collection, '941-once-per-process');

      expect(createIndex).toHaveBeenCalledTimes(1);
    });

    it('rebuilds for a different collectionName, since the latch is keyed by name', async () => {
      const createIndex = vi.fn(async () => {});
      const collection = { createIndex };

      await svc.ensureTerminologyIndexes(collection, '941-name-a');
      await svc.ensureTerminologyIndexes(collection, '941-name-b');

      expect(createIndex).toHaveBeenCalledTimes(2);
    });

    // Precedent (cid.service.js / sampleIndexes.js): log rather than throw,
    // so a failed index build cannot take down a terminology write.
    it('logs and does not throw when the index cannot be built', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const collection = {
        createIndex: vi.fn(async () => {
          throw new Error('E11000 duplicate key error collection: bio.terminologies index: terminologies_sistema_codigo_unique_v2');
        }),
      };

      await expect(svc.ensureTerminologyIndexes(collection, '941-fails')).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('terminologies_sistema_codigo_unique_v2');
      expect(warn.mock.calls[0][0]).toContain('E11000');
    });

    it('is a no-op for a falsy collection, missing createIndex, or empty collectionName', async () => {
      const createIndex = vi.fn(async () => {});
      await expect(svc.ensureTerminologyIndexes(null, '941-noop')).resolves.toBeUndefined();
      await expect(svc.ensureTerminologyIndexes({}, '941-noop')).resolves.toBeUndefined();
      await expect(svc.ensureTerminologyIndexes({ createIndex }, '')).resolves.toBeUndefined();
      expect(createIndex).not.toHaveBeenCalled();
    });
  });

  describe('upsertTerminology', () => {
    it('skips when required fields are missing after normalization', async () => {
      const result = await svc.upsertTerminology({});
      expect(result).toEqual({ skipped: true, reason: 'missing-required-fields' });
    });

    it('resolves normalizedCodigo via the lowercase record.orpha field when no other codigo field is present', async () => {
      const findSpy = vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});
      const result = await svc.upsertTerminology({ sistema: 'ORPHA', orpha: '558', descricao: 'Marfan' });
      expect(result.skipped).toBe(false);
      const [query] = findSpy.mock.calls[0];
      expect(query.codigo).toBe('ORPHA:558');
    });

    it('merges aliases and sinonimos (deduped) into the orphanet_diseases redundancy document', async () => {
      const terminologiesUpdate = vi.fn().mockResolvedValue({});
      const orphanetUpdate = vi.fn().mockResolvedValue({});
      const db = {
        collection: vi.fn((name) => {
          if (name === 'terminologies') return { updateOne: terminologiesUpdate };
          if (name === 'orphanet_diseases') return { updateOne: orphanetUpdate };
          throw new Error(`unexpected collection ${name}`);
        }),
      };
      await svc.upsertTerminology({
        codigo: '558',
        sistema: 'ORPHA',
        descricao: 'Marfan',
        aliases: ['Marfan syndrome', 'MFS'],
        synonyms: ['MFS'],
      }, db);
      const [, setDoc] = orphanetUpdate.mock.calls[0];
      expect(setDoc.$set.aliases.sort()).toEqual(['MFS', 'Marfan syndrome'].sort());
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

    it('#941 ensures the terminologies unique index, by value, before writing on the db path', async () => {
      const createIndex = vi.fn(async () => {});
      const updateOne = vi.fn().mockResolvedValue({});
      const db = {
        collection: vi.fn((name) => {
          if (name === 'terminologies') return { createIndex, updateOne };
          if (name === 'orphanet_diseases') return { updateOne: vi.fn().mockResolvedValue({}) };
          throw new Error(`unexpected collection ${name}`);
        }),
      };

      await svc.upsertTerminology({ codigo: 'X1', sistema: 'OUTRO', descricao: 'desc' }, db);

      expect(createIndex).toHaveBeenCalledTimes(1);
      const [keys, options] = createIndex.mock.calls[0];
      expect(keys).toEqual({ sistema: 1, codigo: 1 });
      expect(options).toEqual({
        name: 'terminologies_sistema_codigo_unique_v2',
        unique: true,
        partialFilterExpression: { sistema: { $type: 'string' }, codigo: { $type: 'string' } },
      });
      expect(createIndex.mock.invocationCallOrder[0]).toBeLessThan(updateOne.mock.invocationCallOrder[0]);
    });

    it('#941 does not rebuild the terminologies index on a second db-path upsert in the same process', async () => {
      const createIndex = vi.fn(async () => {});
      const updateOne = vi.fn().mockResolvedValue({});
      const db = {
        collection: vi.fn((name) => {
          if (name === 'terminologies') return { createIndex, updateOne };
          if (name === 'orphanet_diseases') return { updateOne: vi.fn().mockResolvedValue({}) };
          throw new Error(`unexpected collection ${name}`);
        }),
      };

      await svc.upsertTerminology({ codigo: 'X1', sistema: 'OUTRO', descricao: 'd1' }, db);
      await svc.upsertTerminology({ codigo: 'X2', sistema: 'OUTRO', descricao: 'd2' }, db);

      expect(createIndex).toHaveBeenCalledTimes(1);
      expect(updateOne).toHaveBeenCalledTimes(2);
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

    it('falls back to record.code, then "desconhecido", when logging a per-record failure', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      vi.spyOn(Terminology, 'findOneAndUpdate').mockImplementation(() => {
        throw new Error('boom');
      });
      await svc.seedTerminologies([{ code: 'C1', sistema: 'ORPHA', descricao: 'a' }]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('C1'));

      warnSpy.mockClear();
      await svc.seedTerminologies([{ ORPHAcode: '9', sistema: 'ORPHA', descricao: 'a' }]);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('desconhecido'));
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
      // issue #115: surface which endpoint(s) were actually consulted and how
      // many records each yielded, so a small/partial result from an earlier
      // endpoint isn't silently indistinguishable from a complete one.
      expect(result.consulted).toEqual([
        { endpoint: '/rd-cross-referencing/orphacodes?limit=1000', recordCount: 0, error: 'network down' },
        { endpoint: '/rd-phenotypes/orphacodes?limit=1000', recordCount: 1 },
      ]);
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

      const result = await freshSvc.syncFromOrphadata();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // issue #115: the third endpoint is never consulted, and that's visible
      // in the report rather than silently indistinguishable from "checked but empty".
      expect(result.consulted).toEqual([
        { endpoint: '/rd-cross-referencing/orphacodes?limit=1000', recordCount: 0 },
        { endpoint: '/rd-phenotypes/orphacodes?limit=1000', recordCount: 1 },
      ]);
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
        // issue #115: every attempted endpoint is reported, all failed here.
        consulted: [
          { endpoint: '/rd-cross-referencing/orphacodes?limit=1000', recordCount: 0, error: 'always fails' },
          { endpoint: '/rd-phenotypes/orphacodes?limit=1000', recordCount: 0, error: 'always fails' },
          { endpoint: '/rd-classification/orphacodes?limit=1000', recordCount: 0, error: 'always fails' },
        ],
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

    it('extracts records from a response body shaped as {data: [...]}, {items: [...]}, or {results: [...]}', async () => {
      vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});
      const shapes = [
        { data: [{ ORPHAcode: '1', descricao: 'D1' }] },
        { items: [{ ORPHAcode: '1', descricao: 'D1' }] },
        { results: [{ ORPHAcode: '1', descricao: 'D1' }] },
      ];
      for (const body of shapes) {
        const freshSvc = freshRequireWithEnv(() => {
          process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
          process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
        });
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify(body),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await freshSvc.syncFromOrphadata();
        expect(result.upserted).toBe(1);
      }
    });

    it('normalizes a bare string/number record entry into an ORPHA stub before upserting', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      const updateOneSpy = vi.spyOn(Terminology, 'findOneAndUpdate').mockResolvedValue({});
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify([558]),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();
      expect(result.upserted).toBe(1);
      expect(updateOneSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sistema: 'ORPHA', codigo: 'ORPHA:558' }),
        expect.anything(),
        expect.anything()
      );
    });

    it('surfaces the response body\'s error/message field in the thrown error when an endpoint responds non-OK', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify({ error: 'orphadata is down' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();
      expect(result.success).toBe(false);
      const warnMessages = warnSpy.mock.calls.map((c) => c[0]);
      expect(warnMessages.some((m) => m.includes('orphadata is down'))).toBe(true);
    });

    it('falls back to a plain HTTP status message when a non-OK response has no error/message field', async () => {
      const freshSvc = freshRequireWithEnv(() => {
        process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC = 'true';
        process.env.ORPHADATA_BASE_URL = 'https://orphadata.example.com';
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => 'application/json' },
        text: async () => '',
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await freshSvc.syncFromOrphadata();
      expect(result.success).toBe(false);
      const warnMessages = warnSpy.mock.calls.map((c) => c[0]);
      expect(warnMessages.some((m) => m.includes('HTTP 500 Internal Server Error'))).toBe(true);
    });
  });
});
