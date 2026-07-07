import { useState, useEffect } from 'react';
import { SampleWithQualityDescription } from '../types/models';
import { qualityDescriptionService } from '../services/api';
import { extractResponseEntity, extractResponseItems, normalizeMasterDataItem } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';

export function useQualityDescriptions() {
  const [qualities, setQualities] = useState<SampleWithQualityDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadQualities();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setQualities([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadQualities = async () => {
    try {
      setLoading(true);
      const response = await qualityDescriptionService.getAll();
      const qualitiesData = extractResponseItems<SampleWithQualityDescription>(response)
        .map((item) => normalizeMasterDataItem<SampleWithQualityDescription>(item, ['qualityID']));
      setQualities(qualitiesData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar qualidades');
      setQualities([]);
    } finally {
      setLoading(false);
    }
  };

  const createQuality = async (data: Partial<SampleWithQualityDescription>) => {
    try {
      const response = await qualityDescriptionService.create(data);
      const newQuality = extractResponseEntity<SampleWithQualityDescription>(response, data as any);
      await loadQualities();
      return newQuality;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao criar qualidade');
    }
  };

  const updateQuality = async (id: number, data: Partial<SampleWithQualityDescription>) => {
    try {
      const response = await qualityDescriptionService.update(id, data);
      await loadQualities();
      return extractResponseEntity<SampleWithQualityDescription>(response, data as any);
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao atualizar qualidade');
    }
  };

  const deleteQuality = async (id: number) => {
    try {
      await qualityDescriptionService.delete(id);
      await loadQualities();
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
