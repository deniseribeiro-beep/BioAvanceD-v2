import { useState, useEffect } from 'react';
import { Sample, Result } from '../types/models';
import { samplesApi } from '../services/samples/samplesApi';
import { extractResponseItems, extractResponseTotal } from '../api/response.adapters';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

interface ApiLikeError {
  message?: string;
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

function extractErrorMessage(error: unknown, fallback: string): string {
  const typedError = error as ApiLikeError | null;
  return typedError?.response?.data?.error || typedError?.response?.data?.message || typedError?.message || fallback;
}

function extractSamples(payload: unknown): Sample[] {
  return extractResponseItems<Sample>(payload, ['samples']);
}

function extractResultItems(payload: unknown): Result[] {
  return extractResponseItems<Result>(payload, ['results']);
}

function unwrapData<T>(payload: unknown): T | unknown {
  const typedPayload = payload as { data?: unknown } | null;
  return typedPayload?.data ?? payload;
}

export function useSamples() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadSamples is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  const loadSamples = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await samplesApi.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const samplesData = extractSamples(response.data);
      setSamples(samplesData);
      setTotal(extractResponseTotal(response.data, samplesData.length));
      setError(null);
    } catch (err: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(extractErrorMessage(err, 'Erro ao carregar amostras'));
      setSamples([]);
      setTotal(0);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  useEffect(() => {
    loadSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setSamples([]);
      setTotal(null);
      setError(null);
      setLoading(false);
    });
  }, []);

  const getSampleResults = async (sampleID: number): Promise<Result[]> => {
    try {
      const response = await samplesApi.getResults(sampleID);
      return extractResultItems(response.data);
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao buscar resultados'));
    }
  };

  const createSample = async (data: Partial<Sample>) => {
    try {
      const response = await samplesApi.create(data);
      await loadSamples(); // Recarrega a lista completa
      notifyDashboardDataChanged();
      return unwrapData(response.data);
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao criar amostra'));
    }
  };

  const updateSample = async (id: number | string, data: Partial<Sample>) => {
    try {
      const response = await samplesApi.update(id, data);
      await loadSamples(); // Recarrega a lista completa
      notifyDashboardDataChanged();
      return unwrapData(response.data);
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao atualizar amostra'));
    }
  };

  const deleteSample = async (id: number | string) => {
    try {
      await samplesApi.remove(id);
      await loadSamples(); // Recarrega a lista completa
      notifyDashboardDataChanged();
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao deletar amostra'));
    }
  };

  return {
    samples,
    total,
    loading,
    error,
    loadSamples,
    deleteSample,
    createSample,
    updateSample,
    getSampleResults,
  };
}


