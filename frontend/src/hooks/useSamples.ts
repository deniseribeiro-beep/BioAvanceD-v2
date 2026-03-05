import { useState, useEffect } from 'react';
import { Sample, Result } from '../types/models';
import { samplesApi } from '../services/samples/samplesApi';
import { onClientLogout } from '../utils/sessionCleanup';

interface ApiLikeError {
  message?: string;
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

type SamplesPayload = {
  data?: unknown;
};

function extractErrorMessage(error: unknown, fallback: string): string {
  const typedError = error as ApiLikeError | null;
  return typedError?.response?.data?.error || typedError?.response?.data?.message || typedError?.message || fallback;
}

function extractSamples(payload: unknown): Sample[] {
  const typedPayload = payload as SamplesPayload | null;

  if (Array.isArray(payload)) {
    return payload as Sample[];
  }

  if (Array.isArray(typedPayload?.data)) {
    return typedPayload.data as Sample[];
  }

  return [];
}

function extractResultItems(payload: unknown): Result[] {
  return Array.isArray(payload) ? (payload as Result[]) : [];
}

function unwrapData<T>(payload: unknown): T | unknown {
  const typedPayload = payload as { data?: unknown } | null;
  return typedPayload?.data ?? payload;
}

export function useSamples() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSamples = async () => {
    try {
      setLoading(true);
      const response = await samplesApi.getAll();
      const samplesData = extractSamples(response.data);
      setSamples(samplesData);
      setError(null);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Erro ao carregar amostras'));
      setSamples([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setSamples([]);
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
      return unwrapData(response.data);
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao criar amostra'));
    }
  };

  const updateSample = async (id: number | string, data: Partial<Sample>) => {
    try {
      const response = await samplesApi.update(id, data);
      await loadSamples(); // Recarrega a lista completa
      return unwrapData(response.data);
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao atualizar amostra'));
    }
  };

  const deleteSample = async (id: number | string) => {
    try {
      await samplesApi.remove(id);
      await loadSamples(); // Recarrega a lista completa
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao deletar amostra'));
    }
  };

  return {
    samples,
    loading,
    error,
    loadSamples,
    getSampleResults,
    createSample,
    updateSample,
    deleteSample,
  };
}


