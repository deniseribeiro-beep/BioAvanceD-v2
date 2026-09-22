import { useEffect, useMemo, useState } from 'react';
import { sampleChainApi } from '@/services/sampleChainApi';
import { normalizeMovementList, parseComplianceError, SampleMovementItem } from './sampleMovements.shared';
import { useRequestSequence } from '../useRequestSequence';

export type { SampleMovementItem } from './sampleMovements.shared';


export function useSampleMovements(specimenId?: string) {
  const [items, setItems] = useState<SampleMovementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // #901: discards a stale response when resolvedSpecimenId changes before
  // the in-flight request for the previous id resolves.
  const requestSeq = useRequestSequence();

  const resolvedSpecimenId = useMemo(() => (specimenId ? String(specimenId) : ''), [specimenId]);

  const loadMovements = async () => {
    const seq = requestSeq.next();
    if (!resolvedSpecimenId) {
      setItems([]);
      setError('ID da amostra não informado');
      setErrorCode('MISSING_SPECIMEN_ID');
      return;
    }

    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const response = await sampleChainApi.getMovements(resolvedSpecimenId);
      if (!requestSeq.isCurrent(seq)) return;
      setItems(normalizeMovementList(response?.data));
    } catch (e: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      const parsed = parseComplianceError(e);
      setItems([]);
      setError(parsed.message);
      setErrorCode(parsed.code);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  useEffect(() => {
    void loadMovements();
  }, [resolvedSpecimenId]);

  return {
    items,
    loading,
    error,
    errorCode,
    reload: loadMovements,
  };
}
