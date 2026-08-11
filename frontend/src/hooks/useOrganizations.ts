import { useState, useEffect } from 'react';
import { Organization } from '../types/models';
import { organizationService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

export function useOrganizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    try {
      setLoading(true);
      const response = await organizationService.getAll();
      const responseData: any = response.data;
      const organizationsData = Array.isArray(responseData)
        ? responseData
        : (responseData?.data || []);
      setOrganizations(organizationsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar organizações');
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  };

  return {
    organizations,
    loading,
    error,
    loadOrganizations,
  };
}
