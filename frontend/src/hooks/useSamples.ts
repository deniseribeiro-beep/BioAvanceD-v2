import { useState, useEffect } from 'react';
import { Sample, Result } from '../types/models';
import { sampleService } from '../services/api';

export function useSamples() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSamples = async () => {
    try {
      setLoading(true);
      const response = await sampleService.getAll();
      // API retorna { success: true, data: [...], total: ... }
      const responseData = response.data as any;
      const samplesData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) ? responseData.data : []);
      setSamples(samplesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar amostras');
      setSamples([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getSampleResults = async (sampleID: number): Promise<Result[]> => {
    try {
      const response = await sampleService.getResults(sampleID);
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao buscar resultados');
    }
  };

  const createSample = async (data: Partial<Sample>) => {
    try {
      const response = await sampleService.create(data);
      await loadSamples(); // Recarrega a lista completa
      // Backend retorna { success: true, message: '...', data: { sampleID, patientID } }
      const responseData = response.data as any;
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar amostra');
    }
  };

  const updateSample = async (id: number | string, data: Partial<Sample>) => {
    try {
      const response = await sampleService.update(id, data);
      await loadSamples(); // Recarrega a lista completa
      // Backend retorna { success: true, message: '...', data: sample }
      const responseData = response.data as any;
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar amostra');
    }
  };

  const deleteSample = async (id: number | string) => {
    try {
      await sampleService.delete(id);
      await loadSamples(); // Recarrega a lista completa
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar amostra');
    }
  };

  return {
    samples,
    loading,
    error,
    loadSamples,
    getSampleResults,
    createSample,
    updateSample,
    deleteSample,
  };
}


