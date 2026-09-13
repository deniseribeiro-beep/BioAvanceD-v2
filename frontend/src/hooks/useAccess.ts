import { useState, useEffect } from 'react';
import { Access } from '../types/models';
import { accessService } from '../services/api';
import { extractResponseEntity, extractResponseItems } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useAccess() {
  const [accesses, setAccesses] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadAccesses is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadAccesses();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setAccesses([]);
      setError(null);
      setLoading(false);
    });
  }, []);

   const loadAccesses = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await accessService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      // Backend retorna { success: true, data: [...] }
      setAccesses(extractResponseItems<Access>(response));
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar acessos');
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const createAccess = async (data: Partial<Access>) => {
    try {
      // Remove reportID se estiver presente (será gerado no backend)
      const { reportID, ...accessData } = data;
      const response = await accessService.create(accessData);
      await loadAccesses(); // Recarrega a lista para garantir sincronização
      return extractResponseEntity<Access>(response, accessData as any);
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || err.message || 'Erro ao criar acesso';
      throw new Error(errorMessage);
    }
  };

  const updateAccess = async (id: number, data: Partial<Access>) => {
    try {
      const response = await accessService.update(id, data);
      // PUT /access/:id returns { success, message } with no data key --
      // reload the list instead of writing the bare envelope into state.
      await loadAccesses();
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


