import { useState, useEffect, useRef } from 'react';
import { Result } from '../types/models';
import { resultService } from '../services/api';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';

export function useResults(importJobID?: string) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    loadResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importJobID]);

  useEffect(() => {
    return onClientLogout(() => {
      setResults([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadResults = async () => {
    const seq = ++requestSeq.current;
    try {
      setLoading(true);
      const response = await resultService.getAll(importJobID);
      if (seq !== requestSeq.current) return;
      const responseData: any = response.data;
      // API agora retorna { data: [...], pagination: {...} }
      const resultsData = Array.isArray(responseData)
        ? responseData
        : (responseData?.data || []);
      setResults(resultsData);
      setError(null);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      setError(err.message || 'Erro ao carregar resultados');
      setResults([]); // Garante array vazio em caso de erro
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  const linkSample = async (resultID: number, specimenId: string) => {
    try {
      const response = await resultService.linkSample(resultID, specimenId);
      setResults(results.map((r) => (r.resultID === resultID ? response.data : r)));
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao vincular amostra');
    }
  };

  const createResult = async (data: Partial<Result>) => {
    try {
      const response = await resultService.create(data);
      setResults([...results, response.data]);
      notifyDashboardDataChanged();
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar resultado');
    }
  };

  const updateResult = async (id: number, data: Partial<Result>) => {
    try {
      const response = await resultService.update(id, data);
      setResults(results.map((r) => (r.resultID === id ? response.data : r)));
      notifyDashboardDataChanged();
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar resultado');
    }
  };

  const deleteResult = async (id: number) => {
    try {
      await resultService.delete(id);
      setResults(results.filter((r) => r.resultID !== id));
      notifyDashboardDataChanged();
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar resultado');
    }
  };

  return {
    results,
    loading,
    error,
    loadResults,
    linkSample,
    createResult,
    updateResult,
    deleteResult,
  };
}


