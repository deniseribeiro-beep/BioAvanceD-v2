import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { createIntakeDictionarySet, IntakeDictionaryItem, IntakeDictionarySet, normalizeIntakeDictionaryItem } from '../config/constants/intake-dictionaries.constants';

type TerminologyApiItem = {
  codigo?: string;
  sistema?: string;
  descricao?: string;
  label?: string;
  sinonimos?: string[];
  aliases?: string[];
  ativo?: boolean;
  relacoes?: Record<string, string>;
};

function mapTerminologyToDictionaryItem(item: TerminologyApiItem): IntakeDictionaryItem {
  const codigo = String(item?.codigo || '').trim();
  const descricao = String(item?.descricao || item?.label || '').trim();

  return normalizeIntakeDictionaryItem({
    slug: codigo,
    value: codigo,
    code: codigo,
    name: descricao,
    label: descricao,
    active: item?.ativo !== undefined ? Boolean(item.ativo) : true,
    is_active: item?.ativo !== undefined ? Boolean(item.ativo) : true,
    aliases: Array.isArray(item?.aliases) ? item.aliases : [],
    synonyms: Array.isArray(item?.sinonimos) ? item.sinonimos : [],
  } as IntakeDictionaryItem);
}

function createDictionaryBuckets(): IntakeDictionarySet {
  return createIntakeDictionarySet();
}

function buildDictionarySet(items: TerminologyApiItem[]): IntakeDictionarySet {
  const dictionaries = createDictionaryBuckets();

  const pushBySystem = (system: string, entry: TerminologyApiItem) => {
    const normalized = mapTerminologyToDictionaryItem(entry);
    switch (system) {
      case 'CID10':
      case 'CID11':
        dictionaries.anatomicalOrigins.push(normalized);
        break;
      case 'HPO':
        dictionaries.biomarkers.push(normalized);
        break;
      case 'OMIM':
      case 'ORPHA':
        dictionaries.clinicalComorbidities.push(normalized);
        break;
      case 'BIOMARCADOR':
        dictionaries.biomarkers.push(normalized);
        break;
      default:
        dictionaries.consentTypes.push(normalized);
        break;
    }
  };

  items.forEach((item) => {
    const system = String(item?.sistema || 'OUTRO').trim().toUpperCase();
    pushBySystem(system, item);
  });

  return dictionaries;
}

export function useIntakeDictionaryData() {
  const [dictionaries, setDictionaries] = useState<IntakeDictionarySet>(createIntakeDictionarySet());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;

    const loadDictionaries = async () => {
      setLoading(true);
      setError('');

      try {
        const response = await apiClient.get<{ success: boolean; data?: TerminologyApiItem[] }>('/terminologies', {
          params: { limit: 500, lang: 'pt' },
          suppressErrorToast: true,
        } as any);

        const payload = response?.data?.data ?? [];
        const nextDictionaries = buildDictionarySet(Array.isArray(payload) ? payload : []);

        if (active) {
          setDictionaries(nextDictionaries);
        }
      } catch (requestError: unknown) {
        if (active) {
          setDictionaries(createIntakeDictionarySet());
          setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar as terminologias internas.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadDictionaries();

    return () => {
      active = false;
    };
  }, [refreshIndex]);

  const refresh = () => {
    setRefreshIndex((value) => value + 1);
  };

  return useMemo(() => ({
    dictionaries,
    loading,
    error,
    refresh,
  }), [dictionaries, loading, error]);
}
