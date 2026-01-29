import { useEffect, useState } from 'react';
import { analysisTypeService } from '../services/api';
import { AnalysisType } from '../types/models';

export function useAnalysisTypes() {
  const [types, setTypes] = useState<AnalysisType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTypes = async () => {
      try {
        setLoading(true);
        const response = await analysisTypeService.getAll();
        const data = Array.isArray(response.data)
          ? response.data
          : (response.data?.data || []);
        setTypes(data);
        setError(null);
      } catch (err: any) {
        setTypes([]);
        setError(err.message || 'Erro ao carregar tipos de análise');
      } finally {
        setLoading(false);
      }
    };

    loadTypes();
  }, []);

  return { types, loading, error };
}
