import { useEffect, useMemo, useState } from 'react';
import { sampleChainApi } from '@/services/sampleChainApi';
import { normalizeMovementList, parseComplianceError, SampleMovementItem } from './sampleMovements.shared';


export function useSampleMovements(sampleId?: string) {
  const [items, setItems] = useState<SampleMovementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const resolvedSampleId = useMemo(() => (sampleId ? String(sampleId) : ''), [sampleId]);

  const loadMovements = async () => {
    if (!resolvedSampleId) {
      setItems([]);
      setError('ID da amostra não informado');
      setErrorCode('MISSING_SAMPLE_ID');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const response = await sampleChainApi.getMovements(resolvedSampleId);
      setItems(normalizeMovementList(response?.data));
    } catch (e: unknown) {
      const parsed = parseComplianceError(e);
      setItems([]);
      setError(parsed.message);
      setErrorCode(parsed.code);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMovements();
  }, [resolvedSampleId]);

  return {
    items,
    loading,
    error,
    errorCode,
    reload: loadMovements,
  };
}
