import { useState, useEffect } from 'react';
import { sampleOriginService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

export interface SampleOrigin {
  _id?: string;
  originID: number;
  description: string;
  code?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export function useSampleOrigins() {
  const [origins, setOrigins] = useState<SampleOrigin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrigins();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setOrigins([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadOrigins = async () => {
    try {
      setLoading(true);
      const response = await sampleOriginService.getAll();
      const responseData = response.data as any;
      const originsData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) 
          ? responseData.data 
          : []);
      setOrigins(originsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar origens de amostra');
      setOrigins([]);
    } finally {
      setLoading(false);
    }
  };

  return {
    origins,
    loading,
    error,
    loadOrigins,
  };
}

