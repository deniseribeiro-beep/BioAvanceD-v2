import { useState, useEffect } from 'react';
import { Temperature } from '../types/models';
import { temperatureService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

interface ApiLikeError {
  message?: string;
}

type TemperaturePayload = {
  temperatures?: unknown;
  data?: unknown;
};

function extractTemperatures(payload: unknown): Temperature[] {
  const typedPayload = payload as TemperaturePayload | null;
  const nestedData = typedPayload?.data as TemperaturePayload | unknown;

  if (Array.isArray(payload)) {
    return payload as Temperature[];
  }

  if (Array.isArray(typedPayload?.temperatures)) {
    return typedPayload.temperatures as Temperature[];
  }

  if (Array.isArray(typedPayload?.data)) {
    return typedPayload.data as Temperature[];
  }

  if (typeof nestedData === 'object' && nestedData && Array.isArray((nestedData as TemperaturePayload).temperatures)) {
    return (nestedData as TemperaturePayload).temperatures as Temperature[];
  }

  return [];
}

function extractErrorMessage(error: unknown, fallback: string): string {
  const typedError = error as ApiLikeError | null;
  return typedError?.message || fallback;
}

export function useTemperature() {
  const [temperatures, setTemperatures] = useState<Temperature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadTemperatures is called again
  // before a previous in-flight call resolves. The loader is currently
  // gated behind TEMPERATURE_READING_DISABLED, but the guard is cheap and
  // keeps the hook consistent should the flag ever flip back.
  const requestSeq = useRequestSequence();

  // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
  const TEMPERATURE_READING_DISABLED = true;

  useEffect(() => {
    if (!TEMPERATURE_READING_DISABLED) {
      loadTemperatures();
    } else {
      setLoading(false);
      setTemperatures([]);
      setError(null);
    }
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setTemperatures([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadTemperatures = async () => {
    const seq = requestSeq.next();
    if (TEMPERATURE_READING_DISABLED) {
      setTemperatures([]);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await temperatureService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const temperaturesData = extractTemperatures(response.data);

      setTemperatures(temperaturesData);
      setError(null);
    } catch (err: unknown) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(extractErrorMessage(err, 'Erro ao carregar temperaturas'));
      setTemperatures([]); // Garante array vazio em caso de erro
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const viewControl = async (sensorID?: string, policyID?: string) => {
    // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
    if (TEMPERATURE_READING_DISABLED) {
      console.info('Leitura de temperatura desativada temporariamente - não há sensores cadastrados');
      return [];
    }

    try {
      const response = await temperatureService.viewControl(sensorID, policyID);
      const responseData = response.data as TemperaturePayload | Temperature[] | null;
      // A API pode retornar { data: [...] } ou diretamente um array
      const data = (responseData as TemperaturePayload | null)?.data || responseData || [];
      return Array.isArray(data) ? data : [];
    } catch (err: unknown) {
      // Não lança erro, apenas loga para não bloquear a dashboard
      console.warn('Erro ao visualizar controle de temperatura:', extractErrorMessage(err, 'Erro desconhecido'));
      return [];
    }
  };

  return {
    temperatures,
    loading,
    error,
    loadTemperatures,
    viewControl,
  };
}


