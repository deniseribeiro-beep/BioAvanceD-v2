import { useState, useEffect } from 'react';
import { extractionProtocolService } from '../services/api';
import { extractResponseItems, normalizeMasterDataItem } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

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
  // #901: discards a stale response when loadProtocols is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadProtocols();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setProtocols([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadProtocols = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await extractionProtocolService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const protocolsData = extractResponseItems<ExtractionProtocol>(response).map((item) => normalizeMasterDataItem<ExtractionProtocol>(item, ['protocolID']));
      setProtocols(protocolsData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar protocolos de extração');
      setProtocols([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  return {
    protocols,
    loading,
    error,
    loadProtocols,
  };
}

