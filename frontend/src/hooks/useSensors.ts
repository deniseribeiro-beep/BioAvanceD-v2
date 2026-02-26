import { useState, useEffect } from 'react';
import { Sensor, Temperature } from '../types/models';
import { sensorService } from '../services/api';

export function useSensors() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSensors();
  }, []);

  const loadSensors = async () => {
    try {
      setLoading(true);
      const response = await sensorService.getAll();
      const responseData: any = response.data;
      // Backend retorna { success: true, data: [...] }
      const sensorsData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) 
          ? responseData.data 
          : []);
      setSensors(sensorsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar sensores');
      setSensors([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
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
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar sensor');
    }
  };

  const deleteSensor = async (id: string) => {
    try {
      await sensorService.delete(id);
      await loadSensors(); // Recarrega a lista completa
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


