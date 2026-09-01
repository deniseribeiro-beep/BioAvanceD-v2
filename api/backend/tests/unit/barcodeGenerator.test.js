import { describe, it, expect, vi } from 'vitest';
const { generateUniqueBarcode } = require('../../src/utils/barcodeGenerator');
const { resolveCollectionName } = require('../../src/utils/collectionResolver');

// #932: generateUniqueBarcode no longer takes a collectionName parameter — it
// resolves the same 'samples' key every other service does via
// collectionResolver. RESOLVED_SAMPLES_NAME is that resolved name, and every
// fake below only serves real data under it. Any other name (e.g. the old
// 'amostras' default) is wired to a decoy collection that throws, so a
// regression that reintroduces a mismatched collection name fails loudly
// instead of silently reading/writing the wrong place.
const RESOLVED_SAMPLES_NAME = resolveCollectionName({}, 'samples');

function makeDecoyCollection(collectionName) {
  const message = `unexpected db.collection() call for '${collectionName}' — generateUniqueBarcode must only scan the resolved samples collection ('${RESOLVED_SAMPLES_NAME}')`;
  return {
    findOne: vi.fn(() => Promise.reject(new Error(message))),
    find: vi.fn(() => {
      throw new Error(message);
    })
  };
}

// #779: the generator no longer scans the year on every call — it seeds a
// `counters` document once per year and then does an atomic
// findOneAndUpdate($inc). A decoy for 'counters' would make every test throw,
// and a stub returning a fixed number could not see the increment, so this is
// a real in-memory counter: it honours $setOnInsert-on-upsert, $inc, and
// returnDocument:'after' (the v5+ driver shape #294 was bitten by — the
// document directly, not `{ value: doc }`).
function makeCountersCollection(store = {}) {
  return {
    findOne: vi.fn(async (query) => (query._id in store ? { _id: query._id, ...store[query._id] } : null)),
    updateOne: vi.fn(async (query, update, options = {}) => {
      if (!(query._id in store)) {
        if (!options.upsert) return { matchedCount: 0 };
        store[query._id] = { ...(update.$setOnInsert || {}) };
        return { upsertedCount: 1 };
      }
      return { matchedCount: 1 };
    }),
    findOneAndUpdate: vi.fn(async (query, update, options = {}) => {
      if (!(query._id in store)) {
        if (!options.upsert) return null;
        store[query._id] = { ...(update.$setOnInsert || {}) };
      }
      for (const [field, by] of Object.entries(update.$inc || {})) {
        store[query._id][field] = (store[query._id][field] || 0) + by;
      }
      return { _id: query._id, ...store[query._id] };
    }),
    __store: store
  };
}

// `priorBarcodes` backs the year's existing codes. Since #775 the generator
// reads them with find().toArray() and takes the numeric maximum itself,
// rather than asking the database to sort a numeric sequence as a string.
function makeDb(findOneImpl, priorBarcodes = []) {
  const findOne = vi.fn(findOneImpl);
  const find = vi.fn(() => ({
    toArray: () => Promise.resolve(priorBarcodes.map((barcode) => ({ barcode })))
  }));
  const samplesCollection = { findOne, find };

  const counters = makeCountersCollection();
  const decoys = {};
  const collection = vi.fn((name) => {
    if (name === RESOLVED_SAMPLES_NAME) return samplesCollection;
    if (name === 'counters') return counters;
    if (!decoys[name]) decoys[name] = makeDecoyCollection(name);
    return decoys[name];
  });

  return { db: { collection }, findOne, find, collection, counters };
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

  it('resolves the samples collection via collectionResolver (#932) rather than accepting a collectionName parameter', async () => {
    const { db, collection } = makeDb(() => Promise.resolve(null));
    await generateUniqueBarcode(db);
    expect(collection).toHaveBeenCalledWith(RESOLVED_SAMPLES_NAME);
    expect(collection).not.toHaveBeenCalledWith('amostras');
  });

  it('does not truncate sequence numbers >= 1000 via padStart', async () => {
    const { db } = makeDb(() => Promise.resolve(null), [`BR-${currentYear}-1233`]);
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-1234`);
  });

  // #932: generateUniqueBarcode used to scan a caller-supplied collection
  // name (import-lgpd.service.js passed the legacy 'amostras', which is not
  // even a CANONICAL_COLLECTIONS key) while samples themselves were read and
  // written via getCollection(db, 'samples') — so its uniqueness guarantee
  // was void on that path: a barcode already present in the real samples
  // collection could be handed out again. This proves the generator scans
  // the same collection samples are written to (the decoy in makeDb throws
  // if any other name is requested), and that an existing barcode there is
  // never re-issued.
  it('scans the same collection samples are written to, and does not hand out a barcode already present there (#932)', async () => {
    const existingBarcode = `BR-${currentYear}-001`;
    const { db, collection } = makeDb(
      (query) => Promise.resolve(query.barcode === existingBarcode ? { barcode: existingBarcode } : null),
      [existingBarcode]
    );

    const barcode = await generateUniqueBarcode(db);

    expect(collection).toHaveBeenCalledWith(RESOLVED_SAMPLES_NAME);
    expect(barcode).not.toBe(existingBarcode);
    expect(barcode).toBe(`BR-${currentYear}-002`);
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

  const samplesCollection = {
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

  const counters = makeCountersCollection();
  const decoys = {};
  const collection = vi.fn((name) => {
    if (name === RESOLVED_SAMPLES_NAME) return samplesCollection;
    if (name === 'counters') return counters;
    if (!decoys[name]) decoys[name] = makeDecoyCollection(name);
    return decoys[name];
  });

  return { db: { collection }, collection, counters };
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

// #779: the generator was O(codes created this year) per sample -- a scan of
// the samples collection on every creation, and import-lgpd.service.js calls
// it per row, so a 5,000-row import paid 5,000 scans over a set that grew
// during the import itself. It is now an atomic counter, with the scan
// surviving only as a one-time-per-year seed.
describe('generateUniqueBarcode is O(1) after the year is seeded (#779)', () => {
  it('scans the samples collection once, not once per barcode', async () => {
    const { db, find } = makeDb(() => Promise.resolve(null));

    const first = await generateUniqueBarcode(db);
    const second = await generateUniqueBarcode(db);
    const third = await generateUniqueBarcode(db);

    expect([first, second, third]).toEqual([
      `BR-${currentYear}-001`,
      `BR-${currentYear}-002`,
      `BR-${currentYear}-003`,
    ]);
    // The year scan is the expensive part. Once.
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('seeds the counter from the existing maximum so an existing deployment does not restart at 001', async () => {
    const { db, counters, find } = makeDb(() => Promise.resolve(null), [
      `BR-${currentYear}-004`,
      `BR-${currentYear}-482`,
      `BR-${currentYear}-017`,
    ]);

    const barcode = await generateUniqueBarcode(db);

    expect(barcode).toBe(`BR-${currentYear}-483`);
    expect(counters.__store[`sample_barcode_${currentYear}`].seq).toBe(483);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('does not re-seed once the counter exists, even across many generations', async () => {
    const { db, counters, find } = makeDb(() => Promise.resolve(null), [`BR-${currentYear}-010`]);

    for (let i = 0; i < 5; i++) await generateUniqueBarcode(db);

    expect(counters.__store[`sample_barcode_${currentYear}`].seq).toBe(15);
    expect(find).toHaveBeenCalledTimes(1);
    // findOne on `counters` is the cheap existence check that replaces it.
    expect(counters.findOne).toHaveBeenCalledTimes(5);
  });

  it('advances the counter atomically via $inc rather than read-then-write', async () => {
    const { db, counters } = makeDb(() => Promise.resolve(null));

    await generateUniqueBarcode(db);

    const [query, update, options] = counters.findOneAndUpdate.mock.calls[0];
    expect(query).toEqual({ _id: `sample_barcode_${currentYear}` });
    expect(update.$inc).toEqual({ seq: 1 });
    expect(options.returnDocument).toBe('after');
  });

  // dict-02 ELM-0116 requires `Único`, not contiguous: a burned number is a
  // gap in the label sequence and that is acceptable. This pins that the
  // generator does NOT try to reclaim it -- reuse would be the actual
  // compliance problem, since the label must be unique.
  it('leaves a gap rather than reusing a number that a failed insert burned', async () => {
    const { db, counters } = makeDb(() => Promise.resolve(null));

    const first = await generateUniqueBarcode(db);
    // Caller's insert fails here -- nothing hands the number back.
    const second = await generateUniqueBarcode(db);

    expect(first).toBe(`BR-${currentYear}-001`);
    expect(second).toBe(`BR-${currentYear}-002`);
    expect(counters.__store[`sample_barcode_${currentYear}`].seq).toBe(2);
  });

  it('keeps a separate counter per year', async () => {
    const { db, counters } = makeDb(() => Promise.resolve(null));
    await generateUniqueBarcode(db);

    expect(Object.keys(counters.__store)).toEqual([`sample_barcode_${currentYear}`]);
  });
});
