import { useState, useEffect } from 'react';
import { SampleWithMeasurementUnit } from '../types/models';
import { measurementUnitService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

export function useMeasurementUnits() {
  const [units, setUnits] = useState<SampleWithMeasurementUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUnits();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setUnits([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadUnits = async () => {
    try {
      setLoading(true);
      const response = await measurementUnitService.getAll();
      const responseData: any = response.data;
      // Backend retorna { success: true, data: [...] }
      const unitsData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) 
          ? responseData.data 
          : []);
      setUnits(unitsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar unidades');
      setUnits([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const createUnit = async (data: Partial<SampleWithMeasurementUnit>) => {
    try {
      const response = await measurementUnitService.create(data);
      setUnits([...units, response.data]);
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar unidade');
    }
  };

  const updateUnit = async (id: number, data: Partial<SampleWithMeasurementUnit>) => {
    try {
      const response = await measurementUnitService.update(id, data);
      setUnits(units.map((u) => (u.unitID === id ? response.data : u)));
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar unidade');
    }
  };

  const deleteUnit = async (id: number) => {
    try {
      await measurementUnitService.delete(id);
      setUnits(units.filter((u) => u.unitID !== id));
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar unidade');
    }
  };

  return {
    units,
    loading,
    error,
    loadUnits,
    createUnit,
    updateUnit,
    deleteUnit,
  };
}


