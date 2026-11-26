import { useEffect, useMemo, useState } from 'react';
import { Sample } from '@/types/models';
import { useSamples } from '../useSamples';

export type SampleWithId = Sample & {
  id: string;
  canUse?: boolean;
  consentValid?: boolean;
  consentMessage?: string;
};

export const SAMPLES_PAGE_SIZE = 10;

function getSampleId(sample: Sample): string {
  return (sample as any)._id || String(sample.specimenId ?? sample.barcode ?? sample.participantId);
}

export function useSamplesPage() {
  const { samples, loading, error, loadSamples, deleteSample } = useSamples();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = SAMPLES_PAGE_SIZE;

  useEffect(() => {
    const preselected = samples.filter((s) => (s as any).checked).map((s) => getSampleId(s));
    if (preselected.length) {
      setSelectedSampleIds(preselected);
    }
  }, [samples]);

  const filteredSamples = useMemo<SampleWithId[]>(() => {
    if (!search.trim()) {
      return samples.map((s) => ({ ...s, id: getSampleId(s) }));
    }

    const term = search.trim().toLowerCase();
    return samples
      .filter((sample) => {
        const mongoId = String((sample as any)._id || '');
        const barcode = String(sample.barcode || '');
        const sampleId = String(sample.specimenId || '');
        const labelCode = String((sample as any).labelData?.code || (sample as any).labelCode || '');
        const qrPayload = String((sample as any).labelData?.qrPayload || (sample as any).barcodeIndustrial?.payload || '');
        const participantId = String(sample.participantId || (sample as any).patient?.participantId || '');
        const patientName =
          String(
            (sample as any).patient?.name ||
            (sample as any).patient?.patientName ||
            (sample as any).patientName ||
            ''
          );
        const recordNumber = String((sample as any).recordNumber || (sample as any).patient?.recordNumber || '');
        const type = String(sample.sampleType || '');
        const patient =
          (sample as any).patient?.name ||
          (sample as any).patient?.patientName ||
          (sample as any).patientName ||
          'N/A';

        return (
          mongoId.toLowerCase().includes(term) ||
          sampleId.toLowerCase().includes(term) ||
          barcode.toLowerCase().includes(term) ||
          labelCode.toLowerCase().includes(term) ||
          qrPayload.toLowerCase().includes(term) ||
          participantId.toLowerCase().includes(term) ||
          patientName.toLowerCase().includes(term) ||
          recordNumber.toLowerCase().includes(term) ||
          type.toLowerCase().includes(term) ||
          patient.toLowerCase().includes(term)
        );
      })
      .map((s) => ({ ...s, id: getSampleId(s) }));
  }, [samples, search]);

  const totalPages = Math.max(1, Math.ceil(filteredSamples.length / pageSize));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const pagedSamples = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredSamples.slice(startIndex, startIndex + pageSize);
  }, [filteredSamples, currentPage, pageSize]);

  const pageSelectedIds = pagedSamples.map((sample) => sample.id);
  const allSelected =
    pagedSamples.length > 0 && pageSelectedIds.every((id) => selectedSampleIds.includes(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedSampleIds((prev) => prev.filter((id) => !pageSelectedIds.includes(id)));
      return;
    }
    setSelectedSampleIds((prev) => [...new Set([...prev, ...pageSelectedIds])]);
  };

  const toggleSelect = (sample: SampleWithId) => {
    setSelectedSampleIds((prev) =>
      prev.includes(sample.id) ? prev.filter((id) => id !== sample.id) : [...prev, sample.id]
    );
  };

  const handleBatchDelete = async () => {
    if (selectedSampleIds.length === 0) return;
    const confirmed = window.confirm(`Excluir ${selectedSampleIds.length} amostra(s)?`);
    if (!confirmed) return;

    for (const id of selectedSampleIds) {
      await deleteSample(id);
    }
    setSelectedSampleIds([]);
    loadSamples();
  };

  const selectedSamples = filteredSamples.filter((sample) => selectedSampleIds.includes(sample.id));

  const submitSearch = () => {
    const term = searchInput.trim();
    setSearch(term);
    setCurrentPage(1);
    // Server-side specimenId lookup when the term looks like an id so the
    // default 50-row page cannot hide a just-created sample (ui-mongo-binding).
    if (/^\d{4,}$/.test(term)) {
      void loadSamples({ specimenId: term });
    } else if (!term) {
      void loadSamples();
    }
  };

  return {
    loading,
    error,
    refreshSamples: loadSamples,
    search,
    searchInput,
    setSearchInput,
    submitSearch,
    filteredSamples,
    pagedSamples,
    pageSize,
    currentPage,
    totalPages,
    setCurrentPage,
    selectedSampleIds,
    selectedSamples,
    allSelected,
    toggleSelectAll,
    toggleSelect,
    handleBatchDelete,
    printModalOpen,
    openPrintModal: () => setPrintModalOpen(true),
    closePrintModal: () => setPrintModalOpen(false),
  };
}
