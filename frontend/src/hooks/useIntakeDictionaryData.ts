import { useEffect, useMemo, useState } from 'react';
import { createIntakeDictionarySet, IntakeDictionarySet } from '../config/constants/intake-dictionaries.constants';

export function useIntakeDictionaryData() {
  const [dictionaries, setDictionaries] = useState<IntakeDictionarySet>(createIntakeDictionarySet);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    setDictionaries(createIntakeDictionarySet());
    setError('');
    setLoading(false);
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
