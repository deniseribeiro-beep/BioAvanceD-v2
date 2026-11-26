import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useIntakeDictionaryData } from './useIntakeDictionaryData';
import { apiClient } from '../api/client';
import { createIntakeDictionarySet, IntakeDictionarySet } from '../config/constants/intake-dictionaries.constants';

vi.mock('../api/client', () => ({
  apiClient: { get: vi.fn() },
}));

const get = vi.mocked(apiClient.get);
const DEFAULTS = createIntakeDictionarySet();
const BUCKETS = Object.keys(DEFAULTS) as Array<keyof IntakeDictionarySet>;

function ok(items: unknown[]) {
  return { data: { success: true, data: items }, status: 200 } as any;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mountWith(items: unknown[]) {
  get.mockResolvedValueOnce(ok(items));
  const hook = renderHook(() => useIntakeDictionaryData());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

function added(set: IntakeDictionarySet, key: keyof IntakeDictionarySet): any[] {
  return set[key].slice(DEFAULTS[key].length);
}

describe('useIntakeDictionaryData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts loading with the default dictionaries and asks /terminologies once', async () => {
    const d = deferred<any>();
    get.mockReturnValueOnce(d.promise);
    const { result } = renderHook(() => useIntakeDictionaryData());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe('');
    expect(result.current.dictionaries).toEqual(DEFAULTS);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/terminologies', { params: { limit: 500, lang: 'pt' }, suppressErrorToast: true });
    await act(async () => {
      d.resolve(ok([]));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.dictionaries).toEqual(DEFAULTS);
  });

  it.each([
    ['SAMPLE_TYPE', 'sampleTypes'],
    ['SAMPLE_TYPES', 'sampleTypes'],
    ['SPECIMEN_TYPE', 'sampleTypes'],
    ['SPECIMEN_TYPES', 'sampleTypes'],
    ['MIABIS_SAMPLE_TYPE', 'sampleTypes'],
    ['SAMPLE_ORIGIN', 'anatomicalOrigins'],
    ['SAMPLE_ORIGINS', 'anatomicalOrigins'],
    ['SPECIMEN_ORIGIN', 'anatomicalOrigins'],
    ['EXTRACTION_PROTOCOL', 'extractionProtocols'],
    ['EXTRACTION_PROTOCOLS', 'extractionProtocols'],
    ['QUALITY_DESCRIPTION', 'preAnalyticalQualities'],
    ['QUALITY_DESCRIPTIONS', 'preAnalyticalQualities'],
    ['PRE_ANALYTICAL_QUALITY', 'preAnalyticalQualities'],
    ['MIABIS_QUALITY', 'preAnalyticalQualities'],
    ['CLINICAL_COMORBIDITY', 'clinicalComorbidities'],
    ['CLINICAL_COMORBIDITIES', 'clinicalComorbidities'],
    ['COMORBIDITY', 'clinicalComorbidities'],
    ['COMORBIDITIES', 'clinicalComorbidities'],
    ['BIOMARKER', 'biomarkers'],
    ['BIOMARCADOR', 'biomarkers'],
    ['CONSENT_TYPE', 'consentTypes'],
    ['CONSENT_TYPES', 'consentTypes'],
    ['TCLE', 'consentTypes'],
    ['CONSENT', 'consentTypes'],
  ] as const)('routes sistema %s into %s, after the defaults', async (sistema, bucket) => {
    const { result } = await mountWith([{ sistema, codigo: 'X1', descricao: 'Item X' }]);
    const set = result.current.dictionaries;
    for (const key of BUCKETS) {
      expect(set[key]).toHaveLength(DEFAULTS[key].length + (key === bucket ? 1 : 0));
    }
    expect(added(set, bucket)[0]).toMatchObject({ code: 'X1', slug: 'X1', value: 'X1', name: 'Item X', label: 'Item X', active: true, is_active: true });
  });

  it('trims and upper-cases sistema before routing', async () => {
    const { result } = await mountWith([{ sistema: '  biomarker ', codigo: 'B1', descricao: 'Bio' }]);
    expect(added(result.current.dictionaries, 'biomarkers')).toHaveLength(1);
  });

  it('drops an item with an unknown, empty or missing sistema', async () => {
    const { result } = await mountWith([
      { sistema: 'UNKNOWN', codigo: 'U1' },
      { codigo: 'U2' },
      { sistema: '', codigo: 'U3' },
    ]);
    expect(result.current.dictionaries).toEqual(DEFAULTS);
  });

  it.each([
    ['codigo over code, id and _id', { codigo: 'c', code: 'k', id: 'i', _id: 'u' }, 'c'],
    ['code over id and _id', { code: 'k', id: 'i', _id: 'u' }, 'k'],
    ['id over _id', { id: 'i', _id: 'u' }, 'i'],
    ['_id last', { _id: 'u' }, 'u'],
    ['a trimmed codigo', { codigo: '  c  ' }, 'c'],
  ])('takes the code from %s', async (_label, fields, code) => {
    const { result } = await mountWith([{ sistema: 'TCLE', descricao: 'D', ...fields }]);
    expect(added(result.current.dictionaries, 'consentTypes')[0]).toMatchObject({ code, slug: code, value: code });
  });

  it.each([
    ['descricao first', { descricao: 'a', description: 'b', label: 'c', name: 'd', title: 'e' }, 'a'],
    ['description next', { description: 'b', label: 'c', name: 'd', title: 'e' }, 'b'],
    ['label next', { label: 'c', name: 'd', title: 'e' }, 'c'],
    ['name next', { name: 'd', title: 'e' }, 'd'],
    ['title next', { title: 'e' }, 'e'],
    ['the code last', {}, 'C9'],
  ])('takes the name from %s', async (_label, fields, name) => {
    const { result } = await mountWith([{ sistema: 'TCLE', codigo: 'C9', ...fields }]);
    expect(added(result.current.dictionaries, 'consentTypes')[0]).toMatchObject({ name, label: name });
  });

  it('slugifies the name when the item has no code', async () => {
    const { result } = await mountWith([{ sistema: 'TCLE', description: 'Termo Geral' }]);
    expect(added(result.current.dictionaries, 'consentTypes')[0]).toMatchObject({ code: '', slug: 'termo_geral', value: 'termo_geral', name: 'Termo Geral' });
  });

  it.each([
    ['ativo over active', { ativo: false, active: true }, false],
    ['a truthy ativo over active', { ativo: 1, active: false }, true],
    ['active when ativo is absent', { active: false }, false],
    ['true when both are absent', {}, true],
  ])('reads active from %s', async (_label, fields, active) => {
    const { result } = await mountWith([{ sistema: 'TCLE', codigo: 'A', ...fields }]);
    expect(added(result.current.dictionaries, 'consentTypes')[0]).toMatchObject({ active, is_active: active });
  });

  it.each([
    ['aliases and sinonimos over synonyms', { aliases: ['a1'], sinonimos: ['s1'], synonyms: ['e1'] }, ['a1'], ['s1']],
    ['synonyms when sinonimos is absent', { synonyms: ['e1'] }, [], ['e1']],
    ['empty lists for non-arrays', { aliases: 'a', sinonimos: 's', synonyms: 'e' }, [], []],
  ])('maps %s', async (_label, fields, aliases, synonyms) => {
    const { result } = await mountWith([{ sistema: 'TCLE', codigo: 'S', ...fields }]);
    expect(added(result.current.dictionaries, 'consentTypes')[0]).toMatchObject({ aliases, synonyms });
  });

  it('reads the items from a bare array response', async () => {
    get.mockResolvedValueOnce([{ sistema: 'TCLE', codigo: 'R' }] as any);
    const { result } = renderHook(() => useIntakeDictionaryData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(added(result.current.dictionaries, 'consentTypes')).toHaveLength(1);
  });

  it('reports an Error rejection by its message and resets to the defaults', async () => {
    const hook = await mountWith([{ sistema: 'TCLE', codigo: 'K' }]);
    expect(added(hook.result.current.dictionaries, 'consentTypes')).toHaveLength(1);
    get.mockRejectedValueOnce(new Error('rede caiu'));
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.error).toBe('rede caiu');
    expect(hook.result.current.dictionaries).toEqual(DEFAULTS);
  });

  it('reports a non-Error rejection with the fallback message', async () => {
    get.mockRejectedValueOnce('boom');
    const { result } = renderHook(() => useIntakeDictionaryData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Não foi possível carregar as terminologias internas.');
    expect(result.current.dictionaries).toEqual(DEFAULTS);
  });

  it('refresh fetches again, clears the error and loads while pending', async () => {
    get.mockRejectedValueOnce(new Error('first'));
    const { result } = renderHook(() => useIntakeDictionaryData());
    await waitFor(() => expect(result.current.error).toBe('first'));
    const d = deferred<any>();
    get.mockReturnValueOnce(d.promise);
    act(() => result.current.refresh());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe('');
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      d.resolve(ok([{ sistema: 'TCLE', codigo: 'N' }]));
    });
    expect(result.current.loading).toBe(false);
    expect(added(result.current.dictionaries, 'consentTypes')[0]).toMatchObject({ code: 'N' });
  });

  it('ignores a superseded response that settles after refresh', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntakeDictionaryData());
    act(() => result.current.refresh());
    await act(async () => {
      first.resolve(ok([{ sistema: 'TCLE', codigo: 'OLD' }]));
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.dictionaries).toEqual(DEFAULTS);
    await act(async () => {
      second.resolve(ok([{ sistema: 'TCLE', codigo: 'NEW' }]));
    });
    expect(result.current.loading).toBe(false);
    expect(added(result.current.dictionaries, 'consentTypes').map((i) => i.code)).toEqual(['NEW']);
  });

  it('ignores a superseded rejection that settles after refresh', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntakeDictionaryData());
    act(() => result.current.refresh());
    await act(async () => {
      second.resolve(ok([{ sistema: 'TCLE', codigo: 'NEW' }]));
    });
    await act(async () => {
      first.reject(new Error('stale'));
    });
    expect(result.current.error).toBe('');
    expect(added(result.current.dictionaries, 'consentTypes').map((i) => i.code)).toEqual(['NEW']);
  });

  it('keeps the same result object across a re-render with no state change', async () => {
    const hook = await mountWith([]);
    const before = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(before);
  });
});
