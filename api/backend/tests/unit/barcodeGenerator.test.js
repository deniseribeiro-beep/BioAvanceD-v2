import { describe, it, expect, vi } from 'vitest';
const { generateUniqueBarcode } = require('../../src/utils/barcodeGenerator');

// `priorBarcodes` backs the year's existing codes. Since #775 the generator
// reads them with find().toArray() and takes the numeric maximum itself,
// rather than asking the database to sort a numeric sequence as a string.
function makeDb(findOneImpl, priorBarcodes = []) {
  const findOne = vi.fn(findOneImpl);
  const find = vi.fn(() => ({
    toArray: () => Promise.resolve(priorBarcodes.map((barcode) => ({ barcode })))
  }));
  const collection = vi.fn(() => ({ findOne, find }));
  return { db: { collection }, findOne, find, collection };
}

const currentYear = new Date().getFullYear();

describe('generateUniqueBarcode', () => {
  it('returns sequence 001 when there is no prior sample this year', async () => {
    const { db, findOne } = makeDb(() => Promise.resolve(null));
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-001`);
    // one exact-barcode existence check; the year lookup is a find() now
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('increments sequence based on a valid prior barcode (005 -> 006)', async () => {
    const { db } = makeDb(() => Promise.resolve(null), [`BR-${currentYear}-005`]);
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-006`);
  });

  it('falls back to sequence 1 when prior barcode does not match the year-prefixed pattern', async () => {
    const { db } = makeDb(() => Promise.resolve(null), ['not-a-valid-barcode']);
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-001`);
  });

  it('falls back to sequence 1 when prior barcode is an empty string', async () => {
    const { db } = makeDb(() => Promise.resolve(null), ['']);
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-001`);
  });

  it('handles a single collision by bumping the sequence once and returning the bumped barcode', async () => {
    let firstCheckCalls = 0;
    // no prior sample -> sequence starts at 1, barcode = BR-YYYY-001
    const { db, findOne } = makeDb((query) => {
      // exact-barcode existence checks
      if (query.barcode === `BR-${currentYear}-001`) {
        firstCheckCalls++;
        return Promise.resolve({ barcode: `BR-${currentYear}-001` }); // collision
      }
      if (query.barcode === `BR-${currentYear}-002`) {
        return Promise.resolve(null); // no collision on second try
      }
      return Promise.resolve(null);
    });
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-002`);
    expect(firstCheckCalls).toBe(1);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('throws the Portuguese error message when every candidate collides', async () => {
    // every exact-barcode check collides, so the retry loop is exhausted
    const { db } = makeDb((query) => Promise.resolve({ barcode: query.barcode }));
    await expect(generateUniqueBarcode(db)).rejects.toThrow(
      'Não foi possível gerar um código de barras único. Tente novamente.'
    );
  });

  it('passes the given collectionName through to db.collection', async () => {
    const { db, collection } = makeDb(() => Promise.resolve(null));
    await generateUniqueBarcode(db, 'minhas_amostras');
    expect(collection).toHaveBeenCalledWith('minhas_amostras');
  });

  it('uses the default collectionName "amostras" when omitted', async () => {
    const { db, collection } = makeDb(() => Promise.resolve(null));
    await generateUniqueBarcode(db);
    expect(collection).toHaveBeenCalledWith('amostras');
  });

  it('does not truncate sequence numbers >= 1000 via padStart', async () => {
    const { db } = makeDb(() => Promise.resolve(null), [`BR-${currentYear}-1233`]);
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-1234`);
  });
});

// #775: the mocks above answer the year's "highest barcode" lookup with
// whatever the test hands back, so none of them can observe *how* the
// generator finds that maximum. This fake orders and filters the way the real
// driver does — a binary string sort for `sort: { barcode: -1 }` — which is
// what makes the lexicographic ceiling reproducible.
function makeMongoLikeDb(barcodes) {
  const docs = barcodes.map((barcode) => ({ _id: barcode, barcode }));

  const matches = (doc, query) => {
    if (!query || query.barcode === undefined) return true;
    if (typeof query.barcode === 'string') return doc.barcode === query.barcode;
    if (query.barcode.$regex) return new RegExp(query.barcode.$regex).test(doc.barcode);
    return false;
  };

  const collection = {
    findOne: vi.fn(async (query, options) => {
      const found = docs.filter((doc) => matches(doc, query));
      if (options && options.sort && options.sort.barcode === -1) {
        // Binary (code-unit) comparison, as MongoDB does without a collation.
        found.sort((a, b) => (a.barcode < b.barcode ? 1 : a.barcode > b.barcode ? -1 : 0));
      }
      return found[0] || null;
    }),
    find: vi.fn((query) => ({
      toArray: async () => docs.filter((doc) => matches(doc, query)).map((doc) => ({ barcode: doc.barcode }))
    }))
  };

  return { db: { collection: vi.fn(() => collection) }, collection };
}

function yearRange(from, to, width = 3) {
  const codes = [];
  for (let n = from; n <= to; n++) codes.push(`BR-${currentYear}-${String(n).padStart(width, '0')}`);
  return codes;
}

describe('generateUniqueBarcode past the 999th sample of a year (#775)', () => {
  it('keeps counting past 1000 instead of throwing', async () => {
    const { db } = makeMongoLikeDb([...yearRange(1, 999), `BR-${currentYear}-1000`, `BR-${currentYear}-1001`]);
    await expect(generateUniqueBarcode(db)).resolves.toBe(`BR-${currentYear}-1002`);
  });

  // A gap above 1000 is what separates the two orderings: lexicographically
  // 'BR-YYYY-999' still wins, and the collision bump then lands on a free
  // number *below* codes that already exist.
  it('takes the numeric maximum, not the lexicographic one', async () => {
    const { db } = makeMongoLikeDb([...yearRange(1, 999), `BR-${currentYear}-1005`]);
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-1006`);
  });

  // The filter is the half a mock cannot check for you: a pattern that matches
  // nothing degrades silently into "no codes yet, start at 001".
  it('scopes the year lookup to well-formed codes of the current year', async () => {
    const { db, find } = makeDb(() => Promise.resolve(null));
    await generateUniqueBarcode(db);

    const [query, options] = find.mock.calls[0];
    const pattern = new RegExp(query.barcode.$regex);

    expect(pattern.test(`BR-${currentYear}-001`)).toBe(true);
    expect(pattern.test(`BR-${currentYear}-1000`)).toBe(true);
    expect(pattern.test(`BR-${currentYear - 1}-001`)).toBe(false);
    expect(pattern.test(`BR-${currentYear}-00A`)).toBe(false);
    expect(options).toEqual({ projection: { barcode: 1, _id: 0 } });
  });

  it('still returns the next code for a year that has not reached 999', async () => {
    const { db } = makeMongoLikeDb(yearRange(1, 42));
    await expect(generateUniqueBarcode(db)).resolves.toBe(`BR-${currentYear}-043`);
  });
});
