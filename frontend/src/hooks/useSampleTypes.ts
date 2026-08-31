import { useState, useEffect } from 'react';
import { sampleTypeService } from '../services/api';
import { extractResponseItems, normalizeMasterDataItem } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export interface SampleType {
  _id?: string;
  sampleTypeID: number;
  description: string;
  code?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export function useSampleTypes() {
  const [sampleTypes, setSampleTypes] = useState<SampleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadSampleTypes is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadSampleTypes();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setSampleTypes([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadSampleTypes = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await sampleTypeService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const typesData = extractResponseItems<SampleType>(response).map((item) => normalizeMasterDataItem<SampleType>(item, ['sampleTypeID']));
      setSampleTypes(typesData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar tipos de amostra');
      setSampleTypes([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  return {
    sampleTypes,
    loading,
    error,
    loadSampleTypes,
  };
}

