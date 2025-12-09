import { useState, useEffect } from 'react';
import { extractionProtocolService } from '../services/api';

export interface ExtractionProtocol {
  _id?: string;
  protocolID: number;
  description: string;
  code?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export function useExtractionProtocols() {
  const [protocols, setProtocols] = useState<ExtractionProtocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProtocols();
  }, []);

  const loadProtocols = async () => {
    try {
      setLoading(true);
      const response = await extractionProtocolService.getAll();
      const responseData = response.data as any;
      const protocolsData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) 
          ? responseData.data 
          : []);
      setProtocols(protocolsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar protocolos de extração');
      setProtocols([]);
    } finally {
      setLoading(false);
    }
  };

  return {
    protocols,
    loading,
    error,
    loadProtocols,
  };
}

