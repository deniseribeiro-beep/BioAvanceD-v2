import { useState, useEffect } from 'react';
import { Collection } from '../types/models';
import { collectionsService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

export function useCollections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    try {
      setLoading(true);
      const response = await collectionsService.getAll();
      const responseData: any = response.data;
      const collectionsData = Array.isArray(responseData)
        ? responseData
        : (responseData?.data || []);
      setCollections(collectionsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar coleções');
      setCollections([]);
    } finally {
      setLoading(false);
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
