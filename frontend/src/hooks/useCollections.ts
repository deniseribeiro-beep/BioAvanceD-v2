import { useState, useEffect } from 'react';
import { Collection } from '../types/models';
import { collectionsService } from '../services/api';
import { extractResponseItems } from '../api/response.adapters';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadCollections is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadCollections();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setCollections([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadCollections = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await collectionsService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      const collectionsData = extractResponseItems<Collection>(response);
      setCollections(collectionsData);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar coleções');
      setCollections([]);
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const createCollection = async (data: Partial<Collection>) => {
    try {
      const response = await collectionsService.create(data);
      const responseData: any = response.data;
      await loadCollections();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao criar coleção');
    }
  };

  const updateCollection = async (id: string, data: Partial<Collection>) => {
    try {
      const response = await collectionsService.update(id, data);
      const responseData: any = response.data;
      await loadCollections();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao atualizar coleção');
    }
  };

  const deleteCollection = async (id: string) => {
    try {
      await collectionsService.delete(id);
      await loadCollections();
    } catch (err: any) {
      throw new Error(err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao remover coleção');
    }
  };

  return {
    collections,
    loading,
    error,
    loadCollections,
    createCollection,
    updateCollection,
    deleteCollection,
  };
}
