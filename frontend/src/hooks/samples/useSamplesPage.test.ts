import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Sample } from '@/types/models';
import { useSamplesPage } from './useSamplesPage';
import { useSamples } from '../useSamples';

vi.mock('../useSamples', () => ({
  useSamples: vi.fn(),
}));

const mockedUseSamples = vi.mocked(useSamples);

type SamplesState = ReturnType<typeof useSamples>;

// The hook's effect depends on the samples array's identity, so each test
// hands useSamples one stable state object rather than a fresh array per render.
let state: SamplesState;

function sample(fields: Record<string, unknown>): Sample {
  return fields as unknown as Sample;
}

function setSamples(samples: Sample[], extra: Partial<SamplesState> = {}) {
  state = {
    samples,
    loading: false,
    error: null,
    loadSamples: vi.fn().mockResolvedValue(undefined),
    deleteSample: vi.fn().mockResolvedValue(undefined),
    createSample: vi.fn(),
    updateSample: vi.fn(),
    getSampleResults: vi.fn(),
    ...extra,
  } as SamplesState;
}

function mount() {
  return renderHook(() => useSamplesPage());
}

function search(hook: ReturnType<typeof mount>, term: string) {
  act(() => hook.result.current.setSearchInput(term));
  act(() => hook.result.current.submitSearch());
}

const S1 = sample({ _id: 'm1', specimenId: 'SP-1', sampleType: 'Sangue' });
const S2 = sample({ _id: 'm2', specimenId: 'SP-2', sampleType: 'Urina' });
const S3 = sample({ _id: 'm3', specimenId: 'SP-3', sampleType: 'Saliva' });

describe('useSamplesPage', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseSamples.mockImplementation(() => state);
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  describe('passthrough from useSamples', () => {
    it('exposes loading, error and loadSamples as refreshSamples', () => {
      setSamples([], { loading: true, error: 'falhou' });
      const { result } = mount();
      expect(result.current.loading).toBe(true);
      expect(result.current.error).toBe('falhou');
      expect(result.current.refreshSamples).toBe(state.loadSamples);
    });
  });

  describe('row ids', () => {
    it.each([
      ['the Mongo _id first', { _id: 'mongo-1', specimenId: 'SP-9', barcode: 'BC-9', participantId: 'P-9' }, 'mongo-1'],
      ['the specimenId without an _id', { specimenId: 'SP-9', barcode: 'BC-9', participantId: 'P-9' }, 'SP-9'],
      ['the barcode without a specimenId', { barcode: 'BC-9', participantId: 'P-9' }, 'BC-9'],
      ['the participantId last', { participantId: 'P-9' }, 'P-9'],
    ])('names a row by %s', (_label, fields, expected) => {
      setSamples([sample(fields)]);
      const { result } = mount();
      expect(result.current.filteredSamples.map((s) => s.id)).toEqual([expected]);
    });

    it('keeps every sample field on the row', () => {
      setSamples([S1]);
      const { result } = mount();
      expect(result.current.filteredSamples[0]).toMatchObject({ _id: 'm1', specimenId: 'SP-1', id: 'm1' });
    });
  });

  describe('preselection', () => {
    it('selects the samples the server marked checked', () => {
      setSamples([sample({ _id: 'm1', checked: true }), S2, sample({ _id: 'm3', checked: true })]);
      const { result } = mount();
      expect(result.current.selectedSampleIds).toEqual(['m1', 'm3']);
    });

    it('selects nothing when no sample is checked', () => {
      setSamples([S1, S2]);
      const { result } = mount();
      expect(result.current.selectedSampleIds).toEqual([]);
    });

    it('keeps the current selection when new samples arrive with none checked', () => {
      setSamples([sample({ _id: 'm1', checked: true }), S2]);
      const hook = mount();
      expect(hook.result.current.selectedSampleIds).toEqual(['m1']);
      setSamples([S1, S2, S3]);
      hook.rerender();
      expect(hook.result.current.selectedSampleIds).toEqual(['m1']);
    });
  });

  describe('search', () => {
    it('lists every sample until a search is submitted', () => {
      setSamples([S1, S2]);
      const hook = mount();
      act(() => hook.result.current.setSearchInput('SP-1'));
      expect(hook.result.current.searchInput).toBe('SP-1');
      expect(hook.result.current.search).toBe('');
      expect(hook.result.current.filteredSamples).toHaveLength(2);
    });

    it('trims the submitted term and matches case-insensitively', () => {
      setSamples([S1, S2]);
      const hook = mount();
      search(hook, '  sp-2  ');
      expect(hook.result.current.search).toBe('sp-2');
      expect(hook.result.current.filteredSamples.map((s) => s.id)).toEqual(['m2']);
    });

    it('lists every sample again for a blank search', () => {
      setSamples([S1, S2]);
      const hook = mount();
      search(hook, 'SP-2');
      expect(hook.result.current.filteredSamples).toHaveLength(1);
      search(hook, '   ');
      expect(hook.result.current.filteredSamples).toHaveLength(2);
    });

    it('lists nothing when no field matches', () => {
      // A sample with no specimenId or other ids still searches cleanly.
      setSamples([S1, S2, sample({ _id: 'm4' })]);
      const hook = mount();
      search(hook, 'nada-assim');
      expect(hook.result.current.filteredSamples).toEqual([]);
    });

    it.each([
      ['_id', { _id: 'zq-mongo' }],
      ['specimenId', { specimenId: 'ZQ-SPEC' }],
      ['barcode', { barcode: 'ZQ-BAR' }],
      ['labelData.code', { labelData: { code: 'ZQ-LABEL' } }],
      ['labelCode', { labelCode: 'ZQ-LABEL' }],
      ['labelData.qrPayload', { labelData: { qrPayload: 'ZQ-QR' } }],
      ['barcodeIndustrial.payload', { barcodeIndustrial: { payload: 'ZQ-QR' } }],
      ['participantId', { participantId: 'ZQ-PART' }],
      ['patient.participantId', { patient: { participantId: 'ZQ-PART' } }],
      ['patient.name', { patient: { name: 'Zq Silva' } }],
      ['patient.patientName', { patient: { patientName: 'Zq Souza' } }],
      ['patientName', { patientName: 'Zq Lima' }],
      ['recordNumber', { recordNumber: 'ZQ-REC' }],
      ['patient.recordNumber', { patient: { recordNumber: 'ZQ-REC' } }],
      ['sampleType', { sampleType: 'Zq-Tipo' }],
    ])('finds a sample by its %s', (_field, fields) => {
      const target = sample({ specimenId: 'T-1', ...fields });
      setSamples([S1, target, S2]);
      const hook = mount();
      search(hook, 'zq');
      expect(hook.result.current.filteredSamples).toHaveLength(1);
      expect(hook.result.current.filteredSamples[0]).toMatchObject(fields);
    });
  });

  describe('selection', () => {
    it('reports allSelected false for an empty list', () => {
      setSamples([]);
      const { result } = mount();
      expect(result.current.allSelected).toBe(false);
    });

    it('toggleSelectAll selects every listed sample, then clears them', () => {
      setSamples([S1, S2]);
      const hook = mount();
      act(() => hook.result.current.toggleSelectAll());
      expect(hook.result.current.selectedSampleIds).toEqual(['m1', 'm2']);
      expect(hook.result.current.allSelected).toBe(true);
      act(() => hook.result.current.toggleSelectAll());
      expect(hook.result.current.selectedSampleIds).toEqual([]);
      expect(hook.result.current.allSelected).toBe(false);
    });

    it('toggleSelectAll selects only the samples the search lists', () => {
      setSamples([S1, S2, S3]);
      const hook = mount();
      search(hook, 'SP-3');
      act(() => hook.result.current.toggleSelectAll());
      expect(hook.result.current.selectedSampleIds).toEqual(['m3']);
    });

    it('toggleSelect adds a sample, then removes it', () => {
      setSamples([S1, S2]);
      const hook = mount();
      const [first, second] = hook.result.current.filteredSamples;
      act(() => hook.result.current.toggleSelect(second));
      act(() => hook.result.current.toggleSelect(first));
      expect(hook.result.current.selectedSampleIds).toEqual(['m2', 'm1']);
      expect(hook.result.current.allSelected).toBe(true);
      act(() => hook.result.current.toggleSelect(second));
      expect(hook.result.current.selectedSampleIds).toEqual(['m1']);
      expect(hook.result.current.allSelected).toBe(false);
    });

    it('selectedSamples holds the selected rows the search still lists', () => {
      setSamples([S1, S2, S3]);
      const hook = mount();
      const [first, , third] = hook.result.current.filteredSamples;
      act(() => hook.result.current.toggleSelect(first));
      act(() => hook.result.current.toggleSelect(third));
      expect(hook.result.current.selectedSamples.map((s) => s.id)).toEqual(['m1', 'm3']);
      search(hook, 'SP-3');
      expect(hook.result.current.selectedSamples.map((s) => s.id)).toEqual(['m3']);
      expect(hook.result.current.selectedSampleIds).toEqual(['m1', 'm3']);
    });
  });

  describe('handleBatchDelete', () => {
    it('does nothing with no sample selected', async () => {
      setSamples([S1]);
      const { result } = mount();
      await act(() => result.current.handleBatchDelete());
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(state.deleteSample).not.toHaveBeenCalled();
      expect(state.loadSamples).not.toHaveBeenCalled();
    });

    it('deletes nothing when the confirmation is declined', async () => {
      confirmSpy.mockReturnValue(false);
      setSamples([S1, S2]);
      const hook = mount();
      act(() => hook.result.current.toggleSelectAll());
      await act(() => hook.result.current.handleBatchDelete());
      expect(confirmSpy).toHaveBeenCalledWith('Excluir 2 amostra(s)?');
      expect(state.deleteSample).not.toHaveBeenCalled();
      expect(state.loadSamples).not.toHaveBeenCalled();
      expect(hook.result.current.selectedSampleIds).toEqual(['m1', 'm2']);
    });

    it('deletes each selected sample in turn, clears the selection and reloads', async () => {
      setSamples([S1, S2, S3]);
      const hook = mount();
      const [first, , third] = hook.result.current.filteredSamples;
      act(() => hook.result.current.toggleSelect(third));
      act(() => hook.result.current.toggleSelect(first));
      await act(() => hook.result.current.handleBatchDelete());
      expect(confirmSpy).toHaveBeenCalledWith('Excluir 2 amostra(s)?');
      expect(state.deleteSample).toHaveBeenNthCalledWith(1, 'm3');
      expect(state.deleteSample).toHaveBeenNthCalledWith(2, 'm1');
      expect(state.deleteSample).toHaveBeenCalledTimes(2);
      expect(state.loadSamples).toHaveBeenCalledTimes(1);
      expect(hook.result.current.selectedSampleIds).toEqual([]);
    });
  });

  describe('print modal', () => {
    it('opens and closes', () => {
      setSamples([]);
      const hook = mount();
      expect(hook.result.current.printModalOpen).toBe(false);
      act(() => hook.result.current.openPrintModal());
      expect(hook.result.current.printModalOpen).toBe(true);
      act(() => hook.result.current.closePrintModal());
      expect(hook.result.current.printModalOpen).toBe(false);
    });
  });
});
