import { describe, expect, it } from 'vitest';
import { extractResponseItems, normalizeMasterDataItem } from '../../src/api/response.adapters';

describe('response.adapters', () => {
  it('extracts arrays from wrapped payloads', () => {
    const items = extractResponseItems({ success: true, data: [{ id: 1 }, { id: 2 }] });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 1 });
  });

  it('normalizes common record aliases', () => {
    const item = normalizeMasterDataItem({ _id: 'abc', descricao: 'Descrição', ativo: 0 });
    expect(item).toMatchObject({
      id: 'abc',
      description: 'Descrição',
      name: 'Descrição',
      label: 'Descrição',
      active: false,
    });
  });
});
