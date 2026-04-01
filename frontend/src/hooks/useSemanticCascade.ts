import { useCallback, useMemo, useState } from 'react';
import { apiClient, notifyApiToast } from '../api/client';

export type SemanticCoding = {
  system: string;
  code: string;
  display: string;
};

export type SemanticCascadeState = {
  disease: SemanticCoding | null;
  phenotypes: SemanticCoding[];
  biomarkers: SemanticCoding[];
};

type SuggestResponse = {
  disease?: SemanticCoding;
  phenotypes?: SemanticCoding[];
  biomarkers?: SemanticCoding[];
};

function normalizeCoding(raw: any, fallbackSystem: string): SemanticCoding | null {
  const system = String(raw?.system || fallbackSystem || '').trim();
  const code = String(raw?.code || '').trim();
  const display = String(raw?.display || raw?.nome || raw?.name || '').trim();

  if (!system || !code || !display) {
    return null;
  }

  return { system, code, display };
}

export function useSemanticCascade() {
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [suggestError, setSuggestError] = useState('');
  const [lastDisease, setLastDisease] = useState<SemanticCoding | null>(null);
  const [state, setState] = useState<SemanticCascadeState>({
    disease: null,
    phenotypes: [],
    biomarkers: [],
  });

  const searchDiseases = useCallback(async (query: string): Promise<SemanticCoding[]> => {
    const nextQuery = String(query || '').trim();
    if (!nextQuery) {
      setSearchError('');
      return [];
    }

    setSearchError('');
    setLoadingSearch(true);
    try {
      const response = await apiClient.get('/dictionary/search', {
        params: { query: nextQuery },
        suppressErrorToast: true,
      } as any);

      const payload = Array.isArray(response?.data?.results) ? response.data.results : [];
      return payload
        .map((item: any) => normalizeCoding(item, 'http://www.orpha.net'))
        .filter(Boolean) as SemanticCoding[];
    } catch {
      setSearchError('Nao foi possivel buscar doencas ORPHA agora.');
      return [];
    } finally {
      setLoadingSearch(false);
    }
  }, []);

  const loadCascadeByDisease = useCallback(async (diseaseCoding: SemanticCoding | null): Promise<SemanticCascadeState> => {
    setLastDisease(diseaseCoding || null);
    if (!diseaseCoding?.code) {
      const cleared = { disease: null, phenotypes: [], biomarkers: [] };
      setState(cleared);
      setSuggestError('');
      return cleared;
    }

    setSuggestError('');
    setLoadingSuggest(true);
    try {
      const response = await apiClient.get('/dictionary/suggest', {
        params: { orphaCode: diseaseCoding.code },
        suppressErrorToast: true,
      } as any);

      const data = (response?.data || {}) as SuggestResponse;
      const normalizedDisease = normalizeCoding(data.disease || diseaseCoding, 'http://www.orpha.net');
      const normalizedPhenotypes = (Array.isArray(data.phenotypes) ? data.phenotypes : [])
        .map((item) => normalizeCoding(item, 'http://purl.obolibrary.org/obo/hp.owl'))
        .filter(Boolean) as SemanticCoding[];
      const normalizedBiomarkers = (Array.isArray(data.biomarkers) ? data.biomarkers : [])
        .map((item) => normalizeCoding(item, 'http://loinc.org'))
        .filter(Boolean) as SemanticCoding[];

      const nextState: SemanticCascadeState = {
        disease: normalizedDisease,
        phenotypes: normalizedPhenotypes,
        biomarkers: normalizedBiomarkers,
      };

      setState(nextState);
      return nextState;
    } catch {
      const errorMessage = 'Falha ao carregar sugestoes semanticas. Voce pode tentar novamente.';
      setSuggestError(errorMessage);
      notifyApiToast({
        message: errorMessage,
        type: 'warning',
        duration: 4500,
      });
      const fallback: SemanticCascadeState = {
        disease: diseaseCoding,
        phenotypes: [],
        biomarkers: [],
      };
      setState(fallback);
      return fallback;
    } finally {
      setLoadingSuggest(false);
    }
  }, []);

  const retryLoadCascade = useCallback(async (): Promise<SemanticCascadeState> => {
    return loadCascadeByDisease(lastDisease);
  }, [loadCascadeByDisease, lastDisease]);

  const value = useMemo(() => ({
    state,
    loadingSearch,
    loadingSuggest,
    searchError,
    suggestError,
    searchDiseases,
    loadCascadeByDisease,
    retryLoadCascade,
    setState,
  }), [
    state,
    loadingSearch,
    loadingSuggest,
    searchError,
    suggestError,
    searchDiseases,
    loadCascadeByDisease,
    retryLoadCascade,
  ]);

  return value;
}
