import { describe, expect, it } from 'vitest';
import {
  extractResponseEntity,
  extractResponseItems,
  extractResponseTotal,
  normalizeMasterDataItem,
  unwrapApiPayload,
} from './response.adapters';

describe('response adapters', () => {
  it('unwraps an axios envelope and leaves a plain body alone', () => {
    expect(unwrapApiPayload({ data: { ok: true }, status: 200 })).toEqual({ ok: true });
    expect(unwrapApiPayload({ data: [1] })).toEqual({ data: [1] });
    expect(unwrapApiPayload('texto')).toBe('texto');
  });

  it('finds the list and the total in the shapes the API returns', () => {
    expect(extractResponseItems({ data: { patients: [{ id: '1' }] }, status: 200 }, ['patients'])).toEqual([{ id: '1' }]);
    expect(extractResponseItems({ items: [2] })).toEqual([2]);
    expect(extractResponseItems({ data: { results: [3] } })).toEqual([3]);
    expect(extractResponseItems({ nope: true })).toEqual([]);
    expect(extractResponseTotal({ data: { total: 12 }, status: 200 }, 0)).toBe(12);
    expect(extractResponseTotal({ total: 4 }, 0)).toBe(4);
    expect(extractResponseTotal('x', 7)).toBe(7);
    expect(extractResponseTotal({ total: Number.NaN }, 3)).toBe(3);
  });

  it('normalizes a master-data row and falls back when the payload is empty', () => {
    expect(extractResponseEntity({ data: { data: { name: 'A' } }, status: 200 }, { name: 'fallback' })).toMatchObject({ name: 'A' });
    expect(extractResponseEntity(null, { name: 'fallback' })).toEqual({ name: 'fallback' });
    const row = normalizeMasterDataItem({ codigo: 'C1', label: 'Nome', ativo: false });
    expect(row).toMatchObject({ id: 'C1', code: 'C1', name: 'Nome', label: 'Nome', active: false, is_active: false });
    expect(normalizeMasterDataItem('x')).toMatchObject({ active: true });
  });
});
