import { useState, useEffect } from 'react';
import { Organization } from '../types/models';
import { organizationService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

// #1280: GET /api/organizations returns one page sorted by name, at most 500
// rows. Every consumer of this hook (the organizations tab and the pickers)
// needs the whole list, so read pages until one comes back short.
export const ORGANIZATION_PAGE_SIZE = 500;
const MAX_ORGANIZATION_PAGES = 100;

const organizationKey = (organization: Organization): string => {
  const record = organization as unknown as Record<string, unknown>;
  return String(record.organizationId ?? record._id ?? record.id ?? '');
};

export async function fetchAllOrganizations(): Promise<Organization[]> {
  const all: Organization[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_ORGANIZATION_PAGES; page += 1) {
    const response = await organizationService.getAll({ limit: ORGANIZATION_PAGE_SIZE, skip: page * ORGANIZATION_PAGE_SIZE });
    const items = extractResponseItems<Organization>(response);
    let added = 0;
    for (const item of items) {
      const key = organizationKey(item);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      all.push(item);
      added += 1;
    }
    // A short page is the last one. A page adding nothing new means the
    // server ignored the offset, so stop rather than loop.
    if (items.length < ORGANIZATION_PAGE_SIZE || added === 0) break;
  }
  return all;
}

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
      const organizationsData = await fetchAllOrganizations();
      if (!requestSeq.isCurrent(seq)) return;
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
