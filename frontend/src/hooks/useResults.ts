import { useState, useEffect } from 'react';
import { Result } from '../types/models';
import { resultService } from '../services/api';
import { extractResponseEntity } from '../api/response.adapters';
import { notifyDashboardDataChanged } from '../utils/dashboardRefresh';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useResults(importJobID?: string) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: extracted onto the shared guard -- see useRequestSequence.ts.
  const requestSeq = useRequestSequence();

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
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await resultService.getAll(importJobID);
      if (!requestSeq.isCurrent(seq)) return;
      const responseData: any = response.data;
      // API agora retorna { data: [...], pagination: {...} }
      const resultsData = Array.isArray(responseData)
        ? responseData
        : (responseData?.data || []);
      setResults(resultsData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar resultados');
      setResults([]); // Garante array vazio em caso de erro
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const linkSample = async (resultID: number, specimenId: string) => {
    try {
      const response = await resultService.linkSample(resultID, specimenId);
      // PUT /results/:id/link-sample returns { success, message } with no
      // data key -- reload the list instead of writing the bare envelope
      // into state.
      await loadResults();
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao vincular amostra');
    }
  };

  const createResult = async (data: Partial<Result>) => {
    try {
      const response = await resultService.create(data);
      const newResult = extractResponseEntity<Result>(response, data as any);
      setResults([...results, newResult]);
      notifyDashboardDataChanged();
      return newResult;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar resultado');
    }
  };

  const updateResult = async (id: number, data: Partial<Result>) => {
    try {
      const response = await resultService.update(id, data);
      // PUT /results/:id returns { success, message } with no data key --
      // reload the list instead of writing the bare envelope into state.
      await loadResults();
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


