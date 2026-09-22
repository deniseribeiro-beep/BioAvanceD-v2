import { useEffect, useMemo, useState } from 'react';
import { Sample } from '@/types/models';
import { useSamples } from '../useSamples';

export type SampleWithId = Sample & {
  id: string;
  canUse?: boolean;
  consentValid?: boolean;
  consentMessage?: string;
};

function getSampleId(sample: Sample): string {
  return String(sample.specimenId || (sample as any)._id || sample.barcode || sample.participantId);
}

export function useSamplesPage() {
  const { samples, loading, error, loadSamples, deleteSample } = useSamples();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);

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
        const specimenId = String(sample.specimenId || '');
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
          specimenId.toLowerCase().includes(term) ||
          barcode.toLowerCase().includes(term) ||
          participantId.toLowerCase().includes(term) ||
          patientName.toLowerCase().includes(term) ||
          recordNumber.toLowerCase().includes(term) ||
          type.toLowerCase().includes(term) ||
          patient.toLowerCase().includes(term)
        );
      })
      .map((s) => ({ ...s, id: getSampleId(s) }));
  }, [samples, search]);

  const allSelected = filteredSamples.length > 0 && selectedSampleIds.length === filteredSamples.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedSampleIds([]);
      return;
    }
    setSelectedSampleIds(filteredSamples.map((s) => s.id));
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
    setSearch(searchInput.trim());
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

