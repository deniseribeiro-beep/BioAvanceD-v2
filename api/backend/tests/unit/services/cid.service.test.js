import { describe, it, expect, vi } from 'vitest';
const cidService = require('../../../src/services/cid.service');

// Note on resolveSourceCollectionName: cid.service.js destructures it from
// ../utils/collectionResolver at module scope, so per this repo's testing
// conventions vi.spyOn on the exporting module would silently do nothing.
// Rather than fighting that, we exploit resolveSourceCollectionName's own
// short-circuit: it returns the preferred collection name ('cids') immediately
// whenever `db.listCollections` is not a function. Our fake db objects below
// simply omit listCollections, so resolveSourceCollectionName resolves to
// 'cids' for real (no mocking needed) and db.collection('cids') returns our
// fake collection.

function makeFakeCollection({ total = 0, docs = [] } = {}) {
  const cursor = {
    sort: vi.fn(function sort() { return this; }),
    skip: vi.fn(function skip() { return this; }),
    limit: vi.fn(function limit() { return this; }),
    toArray: vi.fn(async () => docs)
  };
  return {
    createIndex: vi.fn(async () => {}),
    countDocuments: vi.fn(async () => total),
    find: vi.fn(() => cursor),
    __cursor: cursor
  };
}

function makeFakeDb(collection) {
  return {
    collection: vi.fn(() => collection)
  };
}

describe('cid.service - normalizeDocument', () => {
  it('picks code/cid10/description from primary field names', () => {
    const result = cidService.normalizeDocument({
      Codigo_Tabulacao: 'A00',
      Codigos_CID10: 'A00.0',
      Descricao: 'Cholera'
    });
    expect(result.Codigo_Tabulacao).toBe('A00');
    expect(result.Codigos_CID10).toBe('A00.0');
    expect(result.Descricao).toBe('Cholera');
  });

  it('falls back to alternate field names (code/description) when primary fields are absent', () => {
    const result = cidService.normalizeDocument({
      code: 'B01',
      description: 'Varicella'
    });
    expect(result.Codigo_Tabulacao).toBe('B01');
    expect(result.Codigos_CID10).toBe('B01');
    expect(result.Descricao).toBe('Varicella');
  });

  it('prefers Codigo_Tabulacao over code and Codigos_CID10 when all present', () => {
    const result = cidService.normalizeDocument({
      Codigo_Tabulacao: 'PRIMARY',
      code: 'SECONDARY',
      Codigos_CID10: 'TERTIARY'
    });
    expect(result.Codigo_Tabulacao).toBe('PRIMARY');
  });

  it('dedupes aliases gathered from aliases/synonyms/alternativeNames/altNames/alias', () => {
    const result = cidService.normalizeDocument({
      aliases: ['Foo', 'Bar'],
      synonyms: ['Bar', 'Baz'],
      alternativeNames: 'Qux',
      altNames: ['Foo'],
      alias: 'Bar'
    });
    expect(result.aliases.sort()).toEqual(['Bar', 'Baz', 'Foo', 'Qux'].sort());
    expect(result.synonyms).toBe(result.aliases);
    expect(result.alternativeNames).toBe(result.aliases);
  });

  it('derives namePt/nameEn/nameEs from a translations object when direct fields are absent', () => {
    const result = cidService.normalizeDocument({
      translations: { pt: 'Portugues', en: 'English', es: 'Espanol' }
    });
    expect(result.namePt).toBe('Portugues');
    expect(result.nameEn).toBe('English');
    expect(result.nameEs).toBe('Espanol');
  });

  it('derives namePt/nameEn/nameEs from a names object when translations is absent', () => {
    const result = cidService.normalizeDocument({
      names: { pt: 'PT-Name', en: 'EN-Name', es: 'ES-Name' }
    });
    expect(result.namePt).toBe('PT-Name');
    expect(result.nameEn).toBe('EN-Name');
    expect(result.nameEs).toBe('ES-Name');
  });

  it('prefers direct namePt/nameEn/nameEs fields over translations/names objects', () => {
    const result = cidService.normalizeDocument({
      namePt: 'DirectPt',
      translations: { pt: 'FromTranslations' }
    });
    expect(result.namePt).toBe('DirectPt');
  });

  it('handles a completely empty item without throwing', () => {
    const result = cidService.normalizeDocument({});
    expect(result.Codigo_Tabulacao).toBe('');
    expect(result.Codigos_CID10).toBe('');
    expect(result.Descricao).toBe('');
    expect(result.aliases).toEqual([]);
  });

  it('defaults to an empty object when called with no argument', () => {
    const result = cidService.normalizeDocument();
    expect(result.Codigo_Tabulacao).toBe('');
    expect(result.aliases).toEqual([]);
  });
});

describe('cid.service - getSearchableTexts', () => {
  it('flattens direct string fields, arrays, and nested translations/names objects, deduped', () => {
    const texts = cidService.getSearchableTexts({
      Codigo_Tabulacao: 'A00',
      Descricao: 'Cholera',
      aliases: ['Alias1'],
      synonyms: ['Alias1', 'Alias2'],
      translations: { pt: 'Colera' },
      names: { en: 'Cholera' } // duplicate of Descricao value case-sensitively distinct? keep as is
    });
    expect(texts).toContain('A00');
    expect(texts).toContain('Cholera');
    expect(texts).toContain('Alias1');
    expect(texts).toContain('Alias2');
    expect(texts).toContain('Colera');
    // Alias1 appears in both aliases and synonyms but should only be present once
    expect(texts.filter((t) => t === 'Alias1').length).toBe(1);
  });

  it('returns an empty array for an item with no searchable fields', () => {
    expect(cidService.getSearchableTexts({})).toEqual([]);
  });
});

describe('cid.service - matchesTerm', () => {
  it('returns false for an empty/whitespace term', () => {
    expect(cidService.matchesTerm({ Descricao: 'Cholera' }, '')).toBe(false);
    expect(cidService.matchesTerm({ Descricao: 'Cholera' }, '   ')).toBe(false);
  });

  it('returns false when no searchable text matches the term', () => {
    expect(cidService.matchesTerm({ Descricao: 'Cholera' }, 'malaria')).toBe(false);
  });

  it('matches case-insensitively against a term buried in aliases', () => {
    expect(cidService.matchesTerm({ Descricao: 'Cholera', aliases: ['RareAliasXYZ'] }, 'rarealiasxyz')).toBe(true);
  });

  it('matches a term found only inside a nested translations object', () => {
    expect(cidService.matchesTerm({ translations: { es: 'ColeraEspanol' } }, 'coleraespanol')).toBe(true);
  });
});

describe('cid.service - ensureIndexes', () => {
  it('creates the expected indexes on first call for a given collection name', async () => {
    const collection = { createIndex: vi.fn(async () => {}) };
    await cidService.ensureIndexes(collection, 'ensureIndexes-test-collection-1');
    expect(collection.createIndex).toHaveBeenCalled();
    const callCount = collection.createIndex.mock.calls.length;
    expect(callCount).toBeGreaterThan(1);
  });

  it('does not call createIndex again on a second call with the same collectionName (caching)', async () => {
    const collection = { createIndex: vi.fn(async () => {}) };
    await cidService.ensureIndexes(collection, 'ensureIndexes-test-collection-2');
    const firstCallCount = collection.createIndex.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await cidService.ensureIndexes(collection, 'ensureIndexes-test-collection-2');
    expect(collection.createIndex.mock.calls.length).toBe(firstCallCount);
  });

  it('does nothing when collection or collectionName is falsy', async () => {
    const collection = { createIndex: vi.fn(async () => {}) };
    await cidService.ensureIndexes(null, 'some-name');
    await cidService.ensureIndexes(collection, '');
    expect(collection.createIndex).not.toHaveBeenCalled();
  });
});

describe('cid.service - searchPaginated', () => {
  it('returns items for an empty term (goes through the active-search filter, not the null-filter path)', async () => {
    const docs = [{ Codigo_Tabulacao: 'A00', Descricao: 'Cholera' }];
    const collection = makeFakeCollection({ total: 1, docs });
    const db = makeFakeDb(collection);

    const result = await cidService.searchPaginated(db, '', 1, 10);

    expect(collection.countDocuments).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].Codigo_Tabulacao).toBe('A00');
    expect(result.pagination.total).toBe(1);
  });

  it('returns the explicit empty-result shape for a term under 2 characters without hitting the db', async () => {
    const collection = makeFakeCollection({ total: 99, docs: [{ Descricao: 'should not be used' }] });
    const db = makeFakeDb(collection);

    const result = await cidService.searchPaginated(db, 'a', 1, 10);

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
    expect(collection.countDocuments).not.toHaveBeenCalled();
  });

  it('computes pagination math correctly (page 2, hasNext/hasPrev true, totalPages)', async () => {
    const docs = [
      { Codigo_Tabulacao: 'C01', Descricao: 'Disease C01' },
      { Codigo_Tabulacao: 'C02', Descricao: 'Disease C02' }
    ];
    const collection = makeFakeCollection({ total: 25, docs });
    const db = makeFakeDb(collection);

    const result = await cidService.searchPaginated(db, 'disease', 2, 10);

    expect(result.pagination.page).toBe(2);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(25);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasPrev).toBe(true);
    // pageIndex(1) * limit(10) + items.length(2) = 12 < 25 => hasNext true
    expect(result.pagination.hasNext).toBe(true);
    expect(collection.__cursor.skip).toHaveBeenCalledWith(10);
    expect(collection.__cursor.limit).toHaveBeenCalledWith(10);
  });

  it('filters out normalized items that have no code and no description', async () => {
    const docs = [
      { Codigo_Tabulacao: 'D01', Descricao: 'Valid Disease' },
      {} // normalizes to all-empty strings, should be filtered out
    ];
    const collection = makeFakeCollection({ total: 2, docs });
    const db = makeFakeDb(collection);

    const result = await cidService.searchPaginated(db, 'disease', 1, 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].Codigo_Tabulacao).toBe('D01');
  });

  it('caps limit at 100 and floors page at 1 for out-of-range inputs', async () => {
    const collection = makeFakeCollection({ total: 0, docs: [] });
    const db = makeFakeDb(collection);

    const result = await cidService.searchPaginated(db, 'disease', -5, 5000);

    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(100);
  });
});

describe('cid.service - search', () => {
  it('delegates to searchPaginated with page 1 and returns only the items array', async () => {
    const docs = [{ Codigo_Tabulacao: 'E01', Descricao: 'E Disease' }];
    const collection = makeFakeCollection({ total: 1, docs });
    const db = makeFakeDb(collection);

    const items = await cidService.search(db, 'disease', 5);

    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0].Codigo_Tabulacao).toBe('E01');
  });
});
