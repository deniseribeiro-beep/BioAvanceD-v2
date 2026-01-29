import { useState, useEffect } from 'react';
import { Temperature } from '../types/models';
import { temperatureService } from '../services/api';

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
      // API pode retornar diferentes formatos
      // Backend retorna: { success: true, data: { temperatures: [...], total: ..., limit: ..., skip: ... } }
      let temperaturesData: Temperature[] = [];
      
      if (Array.isArray(response.data)) {
        // Se response.data é um array direto
        temperaturesData = response.data;
      } else if (response.data?.temperatures && Array.isArray(response.data.temperatures)) {
        // Se response.data tem uma propriedade temperatures que é um array
        temperaturesData = response.data.temperatures;
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        // Se response.data tem uma propriedade data que é um array
        temperaturesData = response.data.data;
      } else if (response.data?.data?.temperatures && Array.isArray(response.data.data.temperatures)) {
        // Se response.data.data tem uma propriedade temperatures
        temperaturesData = response.data.data.temperatures;
      }
      
      setTemperatures(temperaturesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar temperaturas');
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
      // A API pode retornar { data: [...] } ou diretamente um array
      const data = response.data?.data || response.data || [];
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      // Não lança erro, apenas loga para não bloquear a dashboard
      console.warn('Erro ao visualizar controle de temperatura:', err.message);
      return [];
    }
  };

  const createTemperature = async (data: Partial<Temperature>) => {
    try {
      const response = await temperatureService.create(data);
      setTemperatures([response.data, ...temperatures]);
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar leitura de temperatura');
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


