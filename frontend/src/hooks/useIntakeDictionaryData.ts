import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { extractResponseItems } from '../api/response.adapters';
import { createIntakeDictionarySet, IntakeDictionaryItem, IntakeDictionarySet, normalizeIntakeDictionaryItem } from '../config/constants/intake-dictionaries.constants';

type TerminologyApiItem = {
  id?: string;
  _id?: string;
  code?: string;
  codigo?: string;
  system?: string;
  sistema?: string;
  description?: string;
  descricao?: string;
  name?: string;
  label?: string;
  title?: string;
  sinonimos?: string[];
  synonyms?: string[];
  aliases?: string[];
  active?: boolean;
  ativo?: boolean;
  relacoes?: Record<string, string>;
};

function mapTerminologyToDictionaryItem(item: TerminologyApiItem): IntakeDictionaryItem {
  const codigo = String(item?.codigo || item?.code || item?.id || item?._id || '').trim();
  const descricao = String(item?.descricao || item?.description || item?.label || item?.name || item?.title || codigo).trim();
  const active = item?.ativo !== undefined ? Boolean(item.ativo) : item?.active !== undefined ? Boolean(item.active) : true;

  return normalizeIntakeDictionaryItem({
    slug: codigo,
    value: codigo,
    code: codigo,
    name: descricao,
    label: descricao,
    active,
    is_active: active,
    aliases: Array.isArray(item?.aliases) ? item.aliases : [],
    synonyms: Array.isArray(item?.sinonimos) ? item.sinonimos : Array.isArray(item?.synonyms) ? item.synonyms : [],
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
      case 'SAMPLE_TYPE':
      case 'SAMPLE_TYPES':
      case 'SPECIMEN_TYPE':
      case 'SPECIMEN_TYPES':
      case 'MIABIS_SAMPLE_TYPE':
        dictionaries.sampleTypes.push(normalized);
        break;
      case 'SAMPLE_ORIGIN':
      case 'SAMPLE_ORIGINS':
      case 'SPECIMEN_ORIGIN':
        dictionaries.anatomicalOrigins.push(normalized);
        break;
      case 'EXTRACTION_PROTOCOL':
      case 'EXTRACTION_PROTOCOLS':
        dictionaries.extractionProtocols.push(normalized);
        break;
      case 'QUALITY_DESCRIPTION':
      case 'QUALITY_DESCRIPTIONS':
      case 'PRE_ANALYTICAL_QUALITY':
      case 'MIABIS_QUALITY':
        dictionaries.preAnalyticalQualities.push(normalized);
        break;
      case 'CLINICAL_COMORBIDITY':
      case 'CLINICAL_COMORBIDITIES':
      case 'COMORBIDITY':
      case 'COMORBIDITIES':
        dictionaries.clinicalComorbidities.push(normalized);
        break;
      case 'BIOMARKER':
      case 'BIOMARCADOR':
        dictionaries.biomarkers.push(normalized);
        break;
      case 'CONSENT_TYPE':
      case 'CONSENT_TYPES':
      case 'TCLE':
      case 'CONSENT':
        dictionaries.consentTypes.push(normalized);
        break;
      default:
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

        const payload = extractResponseItems<TerminologyApiItem>(response);
        const nextDictionaries = buildDictionarySet(payload);

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
