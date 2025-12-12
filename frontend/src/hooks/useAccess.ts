import { useState, useEffect } from 'react';
import { Access } from '../types/models';
import { accessService } from '../services/api';

export function useAccess() {
  const [accesses, setAccesses] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAccesses();
  }, []);

  const loadAccesses = async () => {
    try {
      setLoading(true);
      const response = await accessService.getAll();
      setAccesses(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar acessos');
    } finally {
      setLoading(false);
    }
  };

  const createAccess = async (data: Partial<Access>) => {
    try {
      // Remove reportID se estiver presente (será gerado no backend)
      const { reportID, ...accessData } = data;
      const response = await accessService.create(accessData);
      await loadAccesses(); // Recarrega a lista para garantir sincronização
      return response.data;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao criar acesso';
      throw new Error(errorMessage);
    }
  };

  const updateAccess = async (id: number, data: Partial<Access>) => {
    try {
      const response = await accessService.update(id, data);
      setAccesses(accesses.map((a) => (a.reportID === id ? response.data : a)));
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar acesso');
    }
  };

  const deleteAccess = async (id: number) => {
    try {
      await accessService.delete(id);
      setAccesses(accesses.filter((a) => a.reportID !== id));
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar acesso');
    }
  };

  return {
    accesses,
    loading,
    error,
    loadAccesses,
    createAccess,
    updateAccess,
    deleteAccess,
  };
}


