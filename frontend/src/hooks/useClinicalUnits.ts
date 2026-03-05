import { useState, useCallback, useEffect } from 'react';
import { ClinicalUnit } from '../types/models';
import { clinicalUnitService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

export function useClinicalUnits() {
  const [clinicalUnits, setClinicalUnits] = useState<ClinicalUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);

  useEffect(() => {
    return onClientLogout(() => {
      setClinicalUnits([]);
      setError(null);
      setLoading(false);
      setCreating(false);
      setApiUnavailable(false);
    });
  }, []);

  const searchClinicalUnits = useCallback(async (term: string, limit = 10) => {
    if (apiUnavailable) {
      setClinicalUnits([]);
      return [];
    }

    try {
      setLoading(true);
      setError(null);
      const response = await clinicalUnitService.search(term, limit);
      const items = Array.isArray(response.data?.data) ? response.data.data : [];
      setClinicalUnits(items);
      return items;
    } catch (err: any) {
      const status = Number(err?.response?.status || 0);
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Erro ao buscar unidades clínicas';
      if (status === 404 || status === 503) {
        setApiUnavailable(true);
      }
      setError(message);
      setClinicalUnits([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [apiUnavailable]);

  const createClinicalUnit = useCallback(async (name: string) => {
    if (apiUnavailable) {
      throw new Error('Cadastro de unidade clínica indisponível no servidor atual.');
    }

    try {
      setCreating(true);
      setError(null);
      const payloadName = String(name || '').trim();
      const response = await clinicalUnitService.create({ name: payloadName });
      const created = response.data?.data;

      if (created && created._id) {
        setClinicalUnits((prev) => {
          const hasExisting = prev.some((item) => String(item._id) === String(created._id));
          if (hasExisting) return prev;
          return [...prev, created].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        });
      }

      return created || null;
    } catch (err: any) {
      const status = Number(err?.response?.status || 0);
      const message = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Erro ao criar unidade clínica';
      if (status === 404 || status === 503) {
        setApiUnavailable(true);
      }
      setError(message);
      throw new Error(message);
    } finally {
      setCreating(false);
    }
  }, [apiUnavailable]);

  return {
    clinicalUnits,
    loading,
    creating,
    error,
    searchClinicalUnits,
    createClinicalUnit,
  };
}
