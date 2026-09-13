import { useState, useEffect } from 'react';
import { Sensor, Temperature } from '../types/models';
import { sensorService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useSensors() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadSensors is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadSensors();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setSensors([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadSensors = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await sensorService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      // Backend retorna { success: true, data: [...] }
      const sensorsData = extractResponseItems<Sensor>(response);
      setSensors(sensorsData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar sensores');
      setSensors([]); // Garante array vazio em caso de erro
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const collectReading = async (sensorID: string): Promise<Temperature> => {
    // TEMPORARIAMENTE DESATIVADO: Não há sensores cadastrados ainda
    const TEMPERATURE_READING_DISABLED = true;
    
    if (TEMPERATURE_READING_DISABLED) {
      throw new Error('Leitura de temperatura desativada temporariamente - não há sensores cadastrados. Cadastre sensores em "Gerenciamento de Instalações" → "Sensores" para ativar esta funcionalidade.');
    }

    try {
      const response = await sensorService.collectReading(sensorID);
      const responseData: any = response.data;
      // Backend retorna { success: true, data: reading }
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao coletar leitura');
    }
  };

  const createSensor = async (data: Partial<Sensor>) => {
    try {
      const response = await sensorService.create(data);
      const responseData: any = response.data;
      const newSensor = responseData?.data || responseData;
      await loadSensors(); // Recarrega a lista completa
      notifyDashboardDataChanged();
      return newSensor;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar sensor');
    }
  };

  const updateSensor = async (id: string, data: Partial<Sensor>) => {
    try {
      const response = await sensorService.update(id, data);
      const responseData: any = response.data;
      await loadSensors(); // Recarrega a lista completa
      notifyDashboardDataChanged();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar sensor');
    }
  };

  const deleteSensor = async (id: string) => {
    try {
      await sensorService.delete(id);
      await loadSensors(); // Recarrega a lista completa
      notifyDashboardDataChanged();
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar sensor');
    }
  };

  return {
    sensors,
    loading,
    error,
    loadSensors,
    collectReading,
    createSensor,
    updateSensor,
    deleteSensor,
  };
}


