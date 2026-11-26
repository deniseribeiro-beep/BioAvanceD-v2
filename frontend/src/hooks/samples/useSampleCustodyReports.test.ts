import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { sampleChainApi } from '@/services/sampleChainApi';
import type { Sample } from '@/types/models';
import { useSamples } from '../useSamples';
import {
  resolveParticipantId,
  resolveSampleId,
  useSampleCustodyReports,
  type SampleCustodyRow,
} from './useSampleCustodyReports';

vi.mock('../useSamples', () => ({
  useSamples: vi.fn(),
}));

vi.mock('@/services/sampleChainApi', () => ({
  sampleChainApi: { getMovements: vi.fn() },
}));

const mockedUseSamples = vi.mocked(useSamples);
const mockedGetMovements = vi.mocked(sampleChainApi.getMovements);

type SamplesState = ReturnType<typeof useSamples>;
type MovementsResponse = Awaited<ReturnType<typeof sampleChainApi.getMovements>>;

function row(fields: Record<string, unknown>): SampleCustodyRow {
  return fields as unknown as SampleCustodyRow;
}

// The hook's rows are useSamples' array, so each test hands it one stable
// state object rather than a fresh array per render.
let state: SamplesState;

function setSamples(samples: Sample[], loading = false) {
  state = {
    samples,
    total: samples.length,
    loading,
    error: null,
    loadSamples: vi.fn(),
    deleteSample: vi.fn(),
    createSample: vi.fn(),
    updateSample: vi.fn(),
    getSampleResults: vi.fn(),
  } as SamplesState;
}

function movements(items: Record<string, unknown>[]): MovementsResponse {
  return { data: { success: true, data: items } } as unknown as MovementsResponse;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const S1 = row({ _id: 'm1', specimenId: 'SP-1', participantId: 'P-1', sampleType: 'Sangue' });
const S2 = row({ _id: 'm2', specimenId: 'SP-2', participantId: 'P-2', sampleType: 'Urina' });

// #1216: a sample names itself by its canonical specimenId. The legacy
// sampleID field this used to read first is prohibited on the wire, so no
// row ever carried it and every row fell through to its Mongo _id.
describe('resolveSampleId', () => {
  it('prefers the canonical specimenId over the Mongo _id', () => {
    const r = { _id: '507f1f77bcf86cd799439011', specimenId: '3116768' } as SampleCustodyRow;
    expect(resolveSampleId(r)).toBe('3116768');
  });

  it('falls back to the _id for a row without a specimenId', () => {
    const r = { _id: '507f1f77bcf86cd799439011' } as SampleCustodyRow;
    expect(resolveSampleId(r)).toBe('507f1f77bcf86cd799439011');
  });

  it('reads the id before the _id when a row has no specimenId', () => {
    expect(resolveSampleId(row({ id: 'row-7', _id: 'm7' }))).toBe('row-7');
  });

  it('shows a dash for a row with no id at all', () => {
    expect(resolveSampleId(row({ sampleType: 'Sangue' }))).toBe('—');
  });
});

describe('resolveParticipantId', () => {
  it('prefers the participantId over the patient id', () => {
    expect(resolveParticipantId(row({ participantId: 'P-1', patient: { id: 'PAT-9' } }))).toBe('P-1');
  });

  it('falls back to the patient id when the row has no participantId', () => {
    expect(resolveParticipantId(row({ patient: { id: 'PAT-9' } }))).toBe('PAT-9');
  });

  it('shows a dash when neither is set', () => {
    expect(resolveParticipantId(row({ patient: {} }))).toBe('—');
  });
});

describe('useSampleCustodyReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A case that leaves a queued once-value unused must not hand it to the next.
    mockedGetMovements.mockReset();
    setSamples([S1, S2] as Sample[]);
    mockedUseSamples.mockImplementation(() => state);
  });

  it('passes useSamples rows and loading flag through', () => {
    setSamples([S1] as Sample[], true);
    const { result } = renderHook(() => useSampleCustodyReports());
    expect(result.current.rows).toBe(state.samples);
    expect(result.current.loading).toBe(true);
    expect(result.current.movementBySampleId).toEqual({});
  });

  it('opens a row loading, then fills it with the normalized movements', async () => {
    const pending = deferred<MovementsResponse>();
    mockedGetMovements.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useSampleCustodyReports());

    let call!: Promise<void>;
    act(() => {
      call = result.current.toggleMovements(S1);
    });
    expect(mockedGetMovements).toHaveBeenCalledWith('SP-1');
    expect(result.current.movementBySampleId['SP-1']).toEqual({
      isOpen: true, isLoading: true, error: null, errorCode: null, items: [],
    });

    await act(async () => {
      pending.resolve(movements([{ _id: 'mv1', timestamp: '2026-01-01', type: 'withdraw', responsibleName: 'Ana', details: 'saída' }]));
      await call;
    });
    expect(result.current.movementBySampleId['SP-1']).toEqual({
      isOpen: true,
      isLoading: false,
      error: null,
      errorCode: null,
      items: [{ id: 'mv1', timestamp: '2026-01-01', type: 'withdraw', responsible: 'Ana', details: 'saída', metadata: undefined }],
    });
  });

  it('closes a loaded row without fetching again, keeping its items', async () => {
    mockedGetMovements.mockResolvedValueOnce(movements([{ _id: 'mv1' }]));
    const { result } = renderHook(() => useSampleCustodyReports());
    await act(async () => {
      await result.current.toggleMovements(S1);
    });

    await act(async () => {
      await result.current.toggleMovements(S1);
    });
    expect(mockedGetMovements).toHaveBeenCalledTimes(1);
    expect(result.current.movementBySampleId['SP-1'].isOpen).toBe(false);
    expect(result.current.movementBySampleId['SP-1'].items.map((i) => i.id)).toEqual(['mv1']);
  });

  it('reopening a closed row shows its previous items while it fetches again', async () => {
    mockedGetMovements.mockResolvedValueOnce(movements([{ _id: 'mv1' }]));
    const { result } = renderHook(() => useSampleCustodyReports());
    await act(async () => {
      await result.current.toggleMovements(S1);
    });
    await act(async () => {
      await result.current.toggleMovements(S1);
    });

    const pending = deferred<MovementsResponse>();
    mockedGetMovements.mockReturnValueOnce(pending.promise);
    let call!: Promise<void>;
    act(() => {
      call = result.current.toggleMovements(S1);
    });
    expect(mockedGetMovements).toHaveBeenCalledTimes(2);
    expect(result.current.movementBySampleId['SP-1']).toMatchObject({ isOpen: true, isLoading: true });
    expect(result.current.movementBySampleId['SP-1'].items.map((i) => i.id)).toEqual(['mv1']);

    await act(async () => {
      pending.resolve(movements([{ _id: 'mv2' }]));
      await call;
    });
    expect(result.current.movementBySampleId['SP-1'].items.map((i) => i.id)).toEqual(['mv2']);
  });

  it('records the parsed error and code when the fetch fails', async () => {
    mockedGetMovements.mockRejectedValueOnce({ response: { status: 500, data: { message: 'falha no servidor' } } });
    const { result } = renderHook(() => useSampleCustodyReports());
    await act(async () => {
      await result.current.toggleMovements(S1);
    });
    expect(result.current.movementBySampleId['SP-1']).toEqual({
      isOpen: true, isLoading: false, error: 'falha no servidor', errorCode: 'HTTP_500', items: [],
    });
  });

  it('a second toggle while the row loads fetches again and drops the first, late response', async () => {
    const first = deferred<MovementsResponse>();
    const second = deferred<MovementsResponse>();
    mockedGetMovements.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSampleCustodyReports());

    let call1!: Promise<void>;
    let call2!: Promise<void>;
    act(() => {
      call1 = result.current.toggleMovements(S1);
    });
    act(() => {
      call2 = result.current.toggleMovements(S1);
    });
    expect(mockedGetMovements).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(movements([{ _id: 'new' }]));
      await call2;
    });
    await act(async () => {
      first.resolve(movements([{ _id: 'old' }]));
      await call1;
    });
    expect(result.current.movementBySampleId['SP-1'].items.map((i) => i.id)).toEqual(['new']);
  });

  it('drops a late failure of a superseded fetch for the same row', async () => {
    const first = deferred<MovementsResponse>();
    const second = deferred<MovementsResponse>();
    mockedGetMovements.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSampleCustodyReports());

    let call1!: Promise<void>;
    let call2!: Promise<void>;
    act(() => {
      call1 = result.current.toggleMovements(S1);
    });
    act(() => {
      call2 = result.current.toggleMovements(S1);
    });
    await act(async () => {
      second.resolve(movements([{ _id: 'new' }]));
      await call2;
    });
    await act(async () => {
      first.reject({ response: { status: 500, data: { message: 'tarde' } } });
      await call1;
    });
    expect(result.current.movementBySampleId['SP-1']).toMatchObject({ error: null, errorCode: null });
    expect(result.current.movementBySampleId['SP-1'].items.map((i) => i.id)).toEqual(['new']);
  });

  it('keeps one row in-flight fetch current while another row fetches (#901)', async () => {
    const one = deferred<MovementsResponse>();
    const two = deferred<MovementsResponse>();
    mockedGetMovements.mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const { result } = renderHook(() => useSampleCustodyReports());

    let call1!: Promise<void>;
    let call2!: Promise<void>;
    act(() => {
      call1 = result.current.toggleMovements(S1);
    });
    act(() => {
      call2 = result.current.toggleMovements(S2);
    });
    await act(async () => {
      two.resolve(movements([{ _id: 'b' }]));
      await call2;
    });
    await act(async () => {
      one.resolve(movements([{ _id: 'a' }]));
      await call1;
    });
    expect(result.current.movementBySampleId['SP-1'].items.map((i) => i.id)).toEqual(['a']);
    expect(result.current.movementBySampleId['SP-2'].items.map((i) => i.id)).toEqual(['b']);
  });
});
