import { useEffect, useMemo, useState } from 'react';
import { useSamples } from '../useSamples';
import { useImportJob } from '../useImportJob';
import { Sample } from '../../types/models';
import { samplesApi, TemplateFormat } from '../../services/samples/samplesApi';

export type SampleWithId = Sample & {
  id: string;
  canUse?: boolean;
  consentValid?: boolean;
  consentMessage?: string;
};

function getSampleId(sample: Sample): string {
  return (sample as any)._id || String(sample.sampleID ?? sample.barcode ?? sample.patientID);
}

export function useSamplesPage() {
  const { samples, loading, error, loadSamples, deleteSample } = useSamples();
  const [search, setSearch] = useState('');
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [activeImportJobId] = useState<string | null>(() =>
    localStorage.getItem('lastImportJobId') || localStorage.getItem('currentImportJobId')
  );

  const {
    job: importJob,
    loading: importLoading,
    error: importError,
    fetchJobStatus,
  } = useImportJob(activeImportJobId, {
    onCompleted: () => {
      loadSamples();
      setSelectedSampleIds([]);
    },
  });

  useEffect(() => {
    if (activeImportJobId && fetchJobStatus) {
      fetchJobStatus();
    }
  }, [activeImportJobId, fetchJobStatus]);

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
        const barcode = sample.barcode || '';
        const type = sample.sampleType || '';
        const patient =
          (sample as any).patient?.name ||
          (sample as any).patient?.patientName ||
          (sample as any).patientName ||
          'N/A';

        return (
          barcode.toLowerCase().includes(term) ||
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
  const isImporting = importLoading || importJob?.status === 'pending' || importJob?.status === 'processing';

  const downloadTemplate = (format: TemplateFormat) => {
    const { fileName, url } = samplesApi.getTemplateInfo(format);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return {
    loading,
    error,
    search,
    setSearch,
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
    importJob,
    importError,
    isImporting,
    downloadTemplate,
  };
}
