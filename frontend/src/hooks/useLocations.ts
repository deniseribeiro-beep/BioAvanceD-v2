import { useState, useCallback, useRef } from 'react';
import { Location } from '../types/models';
import { locationService } from '../services/api';

export function useLocations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false); // Previne múltiplas chamadas simultâneas

  const loadLocations = useCallback(async () => {
    // Previne múltiplas chamadas simultâneas
    if (loadingRef.current) {
      return;
    }

    try {
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      
      const response = await locationService.getAll();
      // Backend retorna { success: true, data: [...] }
      // Axios já extrai o body, então response.data é { success: true, data: [...] }
      let locationsData: Location[] = [];
      const responseData = response.data as any;
      if (Array.isArray(responseData)) {
        locationsData = responseData;
      } else if (responseData && Array.isArray(responseData.data)) {
        locationsData = responseData.data;
      } else {
        console.warn('Estrutura de resposta inesperada para localizações:', response.data);
        locationsData = [];
      }
      
      // Processa localizações: aceita todas (com ou sem locationID)
      // Converte locationID para número se disponível
      const processedLocations = locationsData.map(loc => ({
        ...loc,
        locationID: loc.locationID !== undefined && loc.locationID !== null 
          ? Number(loc.locationID) 
          : loc.locationID // Mantém undefined/null se não existir
      }));
      
      // Ordena por locationID (se disponível) ou por _id
      const sortedLocations = processedLocations.sort((a, b) => {
        // Prioriza locationID se ambos tiverem
        if (a.locationID !== undefined && a.locationID !== null && 
            b.locationID !== undefined && b.locationID !== null) {
          return Number(a.locationID) - Number(b.locationID);
        }
        // Se apenas um tiver locationID, ele vem primeiro
        if (a.locationID !== undefined && a.locationID !== null) return -1;
        if (b.locationID !== undefined && b.locationID !== null) return 1;
        // Se nenhum tiver locationID, ordena por _id (mais recente primeiro)
        const aId = String((a as any)._id || '');
        const bId = String((b as any)._id || '');
        return bId.localeCompare(aId); // Ordem decrescente (mais recente primeiro)
      });
      
      setLocations(sortedLocations);
      setError(null);
    } catch (err: any) {
      console.error('Erro ao carregar localizações:', err);
      setError(err.message || 'Erro ao carregar localizações');
      setLocations([]); // Define array vazio em caso de erro
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  const createLocation = async (data: Partial<Location>) => {
    try {
      const response = await locationService.create(data);
      // Backend retorna { success: true, message: '...', data: { _id: ..., locationID: ..., ... } }
      const responseData = response.data as any;
      const newLocation: Location = responseData?.data || responseData;
      
      if (newLocation && (newLocation.locationID !== undefined || (newLocation as any)._id)) {
        // Garante que locationID seja número
        const locationWithID: Location = {
          ...newLocation,
          locationID: newLocation.locationID !== undefined && newLocation.locationID !== null
            ? Number(newLocation.locationID)
            : undefined
        };
        // Adiciona à lista e recarrega para garantir sincronização
        setLocations(prev => [...prev, locationWithID]);
        // Recarrega a lista completa para garantir que está sincronizada
        await loadLocations();
        return locationWithID;
      }
      
      // Se não houver dados na resposta, recarrega a lista
      await loadLocations();
      return newLocation;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao criar localização';
      throw new Error(errorMessage);
    }
  };

  const updateLocation = async (id: string, data: Partial<Location>) => {
    try {
      const response = await locationService.update(id, data);
      const updatedLocation: Location = (response.data as any)?.data || (response.data as any);
      if (updatedLocation) {
        setLocations(locations.map((l) => (l._id === id ? updatedLocation : l)));
        return updatedLocation;
      }
      await loadLocations(); // Recarrega se não houver dados na resposta
      return updatedLocation;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Erro ao atualizar localização';
      throw new Error(errorMessage);
    }
  };

  const deleteLocation = async (id: string) => {
    try {
      await locationService.delete(id);
      setLocations(locations.filter((l) => l._id !== id));
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar localização');
    }
  };

  return {
    locations,
    loading,
    error,
    loadLocations,
    createLocation,
    updateLocation,
    deleteLocation,
  };
}


