import { useEffect, useState } from 'react';
import { analysisTypeService } from '../services/api';
import { AnalysisType } from '../types/models';
import { extractResponseItems } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useAnalysisTypes() {
  const [types, setTypes] = useState<AnalysisType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadTypes is called again before
  // a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    const loadTypes = async () => {
      const seq = requestSeq.next();
      try {
        setLoading(true);
        const response = await analysisTypeService.getAll();
        if (!requestSeq.isCurrent(seq)) return;
        const data = extractResponseItems<AnalysisType>(response);
        setTypes(data);
        setError(null);
      } catch (err: any) {
        if (!requestSeq.isCurrent(seq)) return;
        setTypes([]);
        setError(err.message || 'Erro ao carregar tipos de análise');
      } finally {
        if (requestSeq.isCurrent(seq)) setLoading(false);
      }
    };

    loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setTypes([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  return { types, loading, error };
}
