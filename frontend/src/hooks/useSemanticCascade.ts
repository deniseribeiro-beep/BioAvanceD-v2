import { useCallback, useMemo, useState } from 'react';
import { apiClient, notifyApiToast } from '../api/client';
import { extractResponseItems } from '../api/response.adapters';
import { useRequestSequence } from './useRequestSequence';

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

type LoadCascadeOptions = {
  suppressErrorToast?: boolean;
};

function normalizeCoding(raw: any, fallbackSystem: string): SemanticCoding | null {
  const system = String(raw?.system || fallbackSystem || '').trim();
  const code = String(raw?.code || raw?.codigo || raw?.hpoId || raw?.id || '').trim();
  const display = String(raw?.display || raw?.nome || raw?.name || raw?.label || raw?.descricao || raw?.description || '').trim();

  if (!system || !code || !display) {
    return null;
  }

  return { system, code, display };
}

function isOrphaCoding(coding: SemanticCoding | null): coding is SemanticCoding {
  if (!coding) return false;
  const system = coding.system.toLowerCase();
  const code = coding.code.toUpperCase();
  return system.includes('orpha') || code.startsWith('ORPHA:') || /^\d+$/.test(code);
}

function isHpoCoding(coding: SemanticCoding | null): coding is SemanticCoding {
  if (!coding) return false;
  const system = coding.system.toLowerCase();
  return system.includes('hpo') || system.includes('hp.owl') || /^HP:\d+/i.test(coding.code);
}

function isBiomarkerCoding(coding: SemanticCoding | null): coding is SemanticCoding {
  if (!coding) return false;
  const system = coding.system.toLowerCase();
  const code = coding.code.toUpperCase();
  return !isHpoCoding(coding) && !system.includes('orpha') && !system.includes('omim') && !code.startsWith('ORPHA:') && !code.startsWith('OMIM:');
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
  // #901: discards a stale response when loadCascadeByDisease is called
  // again (new disease, or a retry) before the in-flight request resolves.
  // searchDiseases returns its results rather than writing shared state, so
  // it is left out of this guard.
  const requestSeq = useRequestSequence();

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

      const payload = extractResponseItems(response, ['results']);
      return payload
        .map((item: any) => normalizeCoding(item, 'http://www.orpha.net'))
        .filter(isOrphaCoding);
    } catch {
      setSearchError('Nao foi possivel buscar doencas ORPHA agora.');
      return [];
    } finally {
      setLoadingSearch(false);
    }
  }, []);

  const loadCascadeByDisease = useCallback(async (diseaseCoding: SemanticCoding | null, options: LoadCascadeOptions = {}): Promise<SemanticCascadeState> => {
    const seq = requestSeq.next();
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
        .filter(isHpoCoding);
      const normalizedBiomarkers = (Array.isArray(data.biomarkers) ? data.biomarkers : [])
        .map((item) => normalizeCoding(item, 'http://loinc.org'))
        .filter(isBiomarkerCoding);

      const nextState: SemanticCascadeState = {
        disease: normalizedDisease,
        phenotypes: normalizedPhenotypes,
        biomarkers: normalizedBiomarkers,
      };

      if (requestSeq.isCurrent(seq)) {
        setState(nextState);
      }
      return nextState;
    } catch {
      const errorMessage = 'Falha ao carregar sugestoes semanticas. Voce pode tentar novamente.';
      if (requestSeq.isCurrent(seq)) {
        setSuggestError(errorMessage);
      }
      if (!options.suppressErrorToast) {
        notifyApiToast({
          message: errorMessage,
          type: 'warning',
          duration: 4500,
        });
      }
      const fallback: SemanticCascadeState = {
        disease: diseaseCoding,
        phenotypes: [],
        biomarkers: [],
      };
      if (requestSeq.isCurrent(seq)) {
        setState(fallback);
      }
      return fallback;
    } finally {
      if (requestSeq.isCurrent(seq)) setLoadingSuggest(false);
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
