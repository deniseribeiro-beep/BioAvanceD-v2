import { useState, useEffect } from 'react';
import { sampleTypeService } from '../services/api';

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

  const loadSampleTypes = async () => {
    try {
      setLoading(true);
      const response = await sampleTypeService.getAll();
      const responseData = response.data as any;
      const typesData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) 
          ? responseData.data 
          : []);
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

