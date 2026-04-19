import { useEffect, useMemo, useState } from 'react';
import { sampleService } from '../../services/api';
import { Sample } from '../../types/models';

type SampleInventoryItem = Sample & {
  id: string;
  sampleId: string;
  integrityOk: boolean;
};

export function useSamplesInventory() {
  const [allSamples, setAllSamples] = useState<SampleInventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await sampleService.getAll();
        const payload = response?.data?.data || response?.data || [];
        const items = Array.isArray(payload) ? payload : [];
        if (!active) return;
        setAllSamples(items.map((sample: Sample) => {
          const sampleId = String(sample.sampleID || sample._id || '').trim();
          const integrityFromGraph = sample?.complianceGraph?.graphPath?.integrity?.valid;
          const integrityOk = typeof integrityFromGraph === 'boolean'
            ? integrityFromGraph
            : Boolean(String(sample.merkle_root || '').trim());
          return {
            ...sample,
            id: sampleId,
            sampleId,
            integrityOk,
          };
        }));
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.message || err?.message || 'Erro ao carregar inventário de amostras');
        setAllSamples([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const quarantined = useMemo(
    () => allSamples.filter((sample) => String(sample.release_status || '').toUpperCase() === 'QUARANTINE'),
    [allSamples]
  );

  const available = useMemo(
    () => allSamples.filter((sample) => String(sample.release_status || '').toUpperCase() === 'AVAILABLE'),
    [allSamples]
  );

  const printQueue = useMemo(
    () => allSamples.filter((sample) => String(sample.currentStatus || '').toLowerCase().includes('available')),
    [allSamples]
  );

  // Implement API calls and state updates here
  const moveSample = async (sampleId: string, newLocation: any) => {};
  const aliquotSample = async (sampleId: string, volume: number) => {};
  const withdrawSample = async (sampleId: string) => {};
  const checkinSample = async (sampleId: string) => {};

  return {
    printQueue,
    quarantined,
    available,
    allSamples,
    loading,
    error,
    moveSample,
    aliquotSample,
    withdrawSample,
    checkinSample,
  };
}
