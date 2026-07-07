import { useState, useEffect } from 'react';
import { sampleTypeService } from '../services/api';
import { extractResponseItems, normalizeMasterDataItem } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';

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
    try {
      setLoading(true);
      const response = await sampleTypeService.getAll();
      const typesData = extractResponseItems<SampleType>(response).map((item) => normalizeMasterDataItem<SampleType>(item, ['sampleTypeID']));
      setSampleTypes(typesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar tipos de amostra');
      setSampleTypes([]);
    } finally {
      setLoading(false);
    }
  };

  return {
    sampleTypes,
    loading,
    error,
    loadSampleTypes,
  };
}

