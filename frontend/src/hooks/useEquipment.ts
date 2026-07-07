import { useState, useEffect } from 'react';
import { Equipment } from '../types/models';
import { equipmentService } from '../services/api';
import { extractResponseEntity, extractResponseItems, normalizeMasterDataItem } from '../api/response.adapters';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';

export function useEquipment() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEquipment();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setEquipment([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadEquipment = async () => {
    try {
      setLoading(true);
      const response = await equipmentService.getAll();
      const equipmentData = extractResponseItems<Equipment>(response).map((item) => normalizeMasterDataItem<Equipment>(item, ['equipmentID']));
      setEquipment(equipmentData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar equipamentos');
      setEquipment([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const createEquipment = async (data: Partial<Equipment>) => {
    try {
      const response = await equipmentService.create(data);
      const newEquipment = extractResponseEntity<Equipment>(response, data as any);
      if (newEquipment) {
        setEquipment((prev) => [...prev, newEquipment]);
        notifyDashboardDataChanged();
        return newEquipment;
      }
      // Se não houver dados na resposta, recarrega a lista
      await loadEquipment();
      notifyDashboardDataChanged();
      return newEquipment;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao criar equipamento';
      throw new Error(errorMessage);
    }
  };

  const updateEquipment = async (id: number | string, data: Partial<Equipment>) => {
    try {
      // Aceita tanto _id (string) quanto equipmentID (number)
      const response = await equipmentService.update(id, data);
      // Atualiza na lista usando _id ou equipmentID
      const updatedEquipment = extractResponseEntity<Equipment>(response, data as any);
      if (updatedEquipment) {
        setEquipment((prev) => prev.map((e) => {
          const eqId = (e as any)._id || e.equipmentID;
          return String(eqId) === String(id) ? updatedEquipment : e;
        }));
        notifyDashboardDataChanged();
        return updatedEquipment;
      }
      await loadEquipment(); // Recarrega se não houver dados na resposta
      notifyDashboardDataChanged();
      return updatedEquipment;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao atualizar equipamento';
      throw new Error(errorMessage);
    }
  };

  const deleteEquipment = async (id: number | string) => {
    try {
      // Aceita tanto _id (string) quanto equipmentID (number)
      await equipmentService.delete(id);
      // Remove da lista usando _id ou equipmentID
      setEquipment((prev) => prev.filter((e) => {
        const eqId = (e as any)._id || e.equipmentID;
        return String(eqId) !== String(id);
      }));
      await loadEquipment(); // Recarrega para garantir sincronização
      notifyDashboardDataChanged();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao deletar equipamento';
      throw new Error(errorMessage);
    }
  };

  return {
    equipment,
    loading,
    error,
    loadEquipment,
    createEquipment,
    updateEquipment,
    deleteEquipment,
  };
}


