import { useState, useEffect } from 'react';
import { Organization } from '../types/models';
import { organizationService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useOrganizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadOrganizations is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadOrganizations();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setOrganizations([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadOrganizations = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await organizationService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const organizationsData = extractResponseItems<Organization>(response);
      setOrganizations(organizationsData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar organizações');
      setOrganizations([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const createOrganization = async (data: Partial<Organization>) => {
    try {
      const response = await organizationService.create(data);
      const responseData: any = response.data;
      await loadOrganizations();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao criar organização');
    }
  };

  const updateOrganization = async (id: string, data: Partial<Organization>) => {
    try {
      const response = await organizationService.update(id, data);
      const responseData: any = response.data;
      await loadOrganizations();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao atualizar organização');
    }
  };

  const deleteOrganization = async (id: string) => {
    try {
      await organizationService.delete(id);
      await loadOrganizations();
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao remover organização');
    }
  };

  return {
    organizations,
    loading,
    error,
    loadOrganizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
  };
}
