import { useState, useEffect } from 'react';
import { Result, Sample } from '../types/models';
import { resultService } from '../services/api';

export function useResults(importJobID?: string) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importJobID]);

  const loadResults = async () => {
    try {
      setLoading(true);
      const response = await resultService.getAll(importJobID);
      // API agora retorna { data: [...], pagination: {...} }
      const resultsData = Array.isArray(response.data) 
        ? response.data 
        : (response.data?.data || []);
      setResults(resultsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar resultados');
      setResults([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const linkSample = async (resultID: number, sampleID: number) => {
    try {
      const response = await resultService.linkSample(resultID, sampleID);
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
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar resultado');
    }
  };

  const updateResult = async (id: number, data: Partial<Result>) => {
    try {
      const response = await resultService.update(id, data);
      setResults(results.map((r) => (r.resultID === id ? response.data : r)));
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar resultado');
    }
  };

  const deleteResult = async (id: number) => {
    try {
      await resultService.delete(id);
      setResults(results.filter((r) => r.resultID !== id));
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


