import { useState, useEffect } from 'react';
import { sampleOriginService } from '../services/api';
import { extractResponseItems, normalizeMasterDataItem } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

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
  // #901: discards a stale response when loadOrigins is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

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
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await sampleOriginService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const originsData = extractResponseItems<SampleOrigin>(response).map((item) => normalizeMasterDataItem<SampleOrigin>(item, ['originID']));
      setOrigins(originsData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar origens de amostra');
      setOrigins([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  return {
    origins,
    loading,
    error,
    loadOrigins,
  };
}

