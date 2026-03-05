import { useState, useEffect } from 'react';
import { Temperature } from '../types/models';
import { temperatureService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

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
    if (TEMPERATURE_READING_DISABLED) {
      setTemperatures([]);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await temperatureService.getAll();
      const temperaturesData = extractTemperatures(response.data);
      
      setTemperatures(temperaturesData);
      setError(null);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Erro ao carregar temperaturas'));
      setTemperatures([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
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

  const createTemperature = async (data: Partial<Temperature>) => {
    try {
      const response = await temperatureService.create(data);
      setTemperatures([response.data, ...temperatures]);
      return response.data;
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao criar leitura de temperatura'));
    }
  };

  return {
    temperatures,
    loading,
    error,
    loadTemperatures,
    viewControl,
    createTemperature,
  };
}


