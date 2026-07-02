import { describe, it, expect, vi } from 'vitest';
const { generateUniqueBarcode } = require('../../src/utils/barcodeGenerator');

function makeDb(findOneImpl) {
  const findOne = vi.fn(findOneImpl);
  const collection = vi.fn(() => ({ findOne }));
  return { db: { collection }, findOne, collection };
}

const currentYear = new Date().getFullYear();

describe('generateUniqueBarcode', () => {
  it('returns sequence 001 when there is no prior sample this year', async () => {
    const { db, findOne } = makeDb(() => Promise.resolve(null));
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-001`);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('increments sequence based on a valid prior barcode (005 -> 006)', async () => {
    const { db, findOne } = makeDb((query) => {
      if (query.barcode && query.barcode.$regex) {
        return Promise.resolve({ barcode: `BR-${currentYear}-005` });
      }
      return Promise.resolve(null);
    });
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-006`);
  });

  it('falls back to sequence 1 when prior barcode does not match the year-prefixed pattern', async () => {
    const { db } = makeDb((query) => {
      if (query.barcode && query.barcode.$regex) {
        return Promise.resolve({ barcode: 'not-a-valid-barcode' });
      }
      return Promise.resolve(null);
    });
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-001`);
  });

  it('falls back to sequence 1 when prior barcode is an empty string', async () => {
    const { db } = makeDb((query) => {
      if (query.barcode && query.barcode.$regex) {
        return Promise.resolve({ barcode: '' });
      }
      return Promise.resolve(null);
    });
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-001`);
  });

  it('handles a single collision by bumping the sequence once and returning the bumped barcode', async () => {
    let firstCheckCalls = 0;
    const { db, findOne } = makeDb((query) => {
      if (query.barcode && query.barcode.$regex) {
        // no prior sample -> sequence starts at 1, barcode = BR-YYYY-001
        return Promise.resolve(null);
      }
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
    expect(findOne).toHaveBeenCalledTimes(3);
  });

  it('throws the Portuguese error message on a double collision', async () => {
    const { db } = makeDb((query) => {
      if (query.barcode && query.barcode.$regex) {
        return Promise.resolve(null);
      }
      // both BR-YYYY-001 and BR-YYYY-002 collide
      return Promise.resolve({ barcode: query.barcode });
    });
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
    const { db } = makeDb((query) => {
      if (query.barcode && query.barcode.$regex) {
        return Promise.resolve({ barcode: `BR-${currentYear}-1233` });
      }
      return Promise.resolve(null);
    });
    const barcode = await generateUniqueBarcode(db);
    expect(barcode).toBe(`BR-${currentYear}-1234`);
  });
});
