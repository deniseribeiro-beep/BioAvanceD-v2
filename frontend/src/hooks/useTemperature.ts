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
      const responseData: any = response.data;
      // API pode retornar diferentes formatos
      // Backend retorna: { success: true, data: { temperatures: [...], total: ..., limit: ..., skip: ... } }
      let temperaturesData: Temperature[] = [];
      
      if (Array.isArray(responseData)) {
        // Se response.data é um array direto
        temperaturesData = responseData;
      } else if (responseData?.temperatures && Array.isArray(responseData.temperatures)) {
        // Se response.data tem uma propriedade temperatures que é um array
        temperaturesData = responseData.temperatures;
      } else if (responseData?.data && Array.isArray(responseData.data)) {
        // Se response.data tem uma propriedade data que é um array
        temperaturesData = responseData.data;
      } else if (responseData?.data?.temperatures && Array.isArray(responseData.data.temperatures)) {
        // Se response.data.data tem uma propriedade temperatures
        temperaturesData = responseData.data.temperatures;
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
      const responseData: any = response.data;
      // A API pode retornar { data: [...] } ou diretamente um array
      const data = responseData?.data || responseData || [];
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


