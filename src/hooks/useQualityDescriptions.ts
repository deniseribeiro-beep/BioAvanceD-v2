import { useState, useEffect } from 'react';
import { SampleWithQualityDescription } from '../types/models';
import { qualityDescriptionService } from '../services/api';

export function useQualityDescriptions() {
  const [qualities, setQualities] = useState<SampleWithQualityDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadQualities();
  }, []);

  const loadQualities = async () => {
    try {
      setLoading(true);
      const response = await qualityDescriptionService.getAll();
      // Backend retorna { success: true, data: [...] }
      const responseData = response.data as any;
      const qualitiesData = Array.isArray(responseData) 
        ? responseData 
        : (Array.isArray(responseData?.data) 
          ? responseData.data 
          : []);
      setQualities(qualitiesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar qualidades');
      setQualities([]); // Garante array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const createQuality = async (data: Partial<SampleWithQualityDescription>) => {
    try {
      const response = await qualityDescriptionService.create(data);
      const responseData = response.data as any;
      const newQuality = responseData?.data || responseData;
      await loadQualities(); // Recarrega a lista completa
      return newQuality;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar qualidade');
    }
  };

  const updateQuality = async (id: number, data: Partial<SampleWithQualityDescription>) => {
    try {
      const response = await qualityDescriptionService.update(id, data);
      const responseData = response.data as any;
      await loadQualities(); // Recarrega a lista completa
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar qualidade');
    }
  };

  const deleteQuality = async (id: number) => {
    try {
      await qualityDescriptionService.delete(id);
      await loadQualities(); // Recarrega a lista completa
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar qualidade');
    }
  };

  return {
    qualities,
    loading,
    error,
    loadQualities,
    createQuality,
    updateQuality,
    deleteQuality,
  };
}


