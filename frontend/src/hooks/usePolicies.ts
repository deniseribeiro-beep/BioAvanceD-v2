import { useState, useEffect } from 'react';
import { Policy } from '../types/models';
import { policyService } from '../services/api';
import { extractResponseEntity } from '../api/response.adapters';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';

export function usePolicies() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPolicies();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setPolicies([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadPolicies = async () => {
    try {
      setLoading(true);
      const response = await policyService.getAll();
      const responseData: any = response.data;
      // Garante que seja um array
      const policiesData = Array.isArray(responseData) 
        ? responseData 
        : (responseData?.data || []);
      setPolicies(policiesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar políticas');
      setPolicies([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const getActiveLimit = async (policyID: number, isMax: boolean = true) => {
    try {
      const response = await policyService.getActiveLimit(policyID, isMax);
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao obter limite ativo');
    }
  };

  const createPolicy = async (data: Partial<Policy>) => {
    try {
      const response = await policyService.create(data);
      const newPolicy = extractResponseEntity<Policy>(response, data as any);
      setPolicies([...policies, newPolicy]);
      notifyDashboardDataChanged();
      return newPolicy;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar política');
    }
  };

  const updatePolicy = async (id: number, data: Partial<Policy>) => {
    try {
      const response = await policyService.update(id, data);
      // PUT /policies/:id returns { success, message } with no data key --
      // reload the list instead of writing the bare envelope into state.
      await loadPolicies();
      notifyDashboardDataChanged();
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar política');
    }
  };

  const deletePolicy = async (id: number) => {
    try {
      await policyService.delete(id);
      setPolicies(policies.filter((p) => p.policyID !== id));
      notifyDashboardDataChanged();
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar política');
    }
  };

  return {
    policies,
    loading,
    error,
    loadPolicies,
    getActiveLimit,
    createPolicy,
    updatePolicy,
    deletePolicy,
  };
}


