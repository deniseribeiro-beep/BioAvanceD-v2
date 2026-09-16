import api from './api';
import type { CurrentStoragePlacementDTO } from '../types/models';

const API_STORAGE_BASE = '/storage';

interface ValidatePositionResponse {
  success: boolean;
  available: boolean;
  error?: string;
  message?: string;
  boxData?: any;
}

interface AllocateResponse {
  success: boolean;
  data?: any;
  currentStoragePlacement?: CurrentStoragePlacementDTO | null;
  error?: string;
  message?: string;
}

interface ReleaseResponse {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

interface CurrentStoragePlacementResponse {
  success: boolean;
  data?: CurrentStoragePlacementDTO | null;
  error?: string;
}

interface AvailablePositionsResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface FreezerTreeResponse {
  success: boolean;
  data?: any;
  error?: string;
}

class StorageApiService {
  async searchSamples(term: string): Promise<any> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/samples/search?q=${encodeURIComponent(term)}`);
      return response.data;
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || 'SEARCH_ERROR', data: [] };
    }
  }

  async listFreezers(): Promise<FreezerTreeResponse> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/freezers`);
      return response.data;
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || 'LIST_ERROR' };
    }
  }

  async validatePosition(boxId: string, position: string): Promise<ValidatePositionResponse> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/validate/${boxId}/${position}`);
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        available: false,
        error: error.response?.data?.error || 'VALIDATION_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  async allocateSample(specimenId: string, boxId: string, position: string): Promise<AllocateResponse> {
    try {
      const response = await api.post(`${API_STORAGE_BASE}/allocate`, { specimenId, boxId, position });
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'ALLOCATION_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  async autoAssignSampleToBox(specimenId: string, boxId: string): Promise<AllocateResponse> {
    try {
      const response = await api.post(`${API_STORAGE_BASE}/allocate/auto`, { specimenId, boxId });
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'AUTO_ALLOCATION_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  async moveSample(
    specimenId: string,
    targetBoxId: string,
    targetPosition: string,
    reason?: string,
    notes?: string
  ): Promise<AllocateResponse> {
    try {
      const response = await api.post(`${API_STORAGE_BASE}/move`, {
        specimenId,
        targetBoxId,
        targetPosition,
        reason,
        notes,
      });
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'MOVE_SAMPLE_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  async releaseSample(specimenId: string): Promise<ReleaseResponse> {
    try {
      const response = await api.delete(`${API_STORAGE_BASE}/release/${specimenId}`);
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'RELEASE_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  async getCurrentStoragePlacement(specimenId: string): Promise<CurrentStoragePlacementResponse> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/specimen/${specimenId}`);
      return response.data;
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || 'PLACEMENT_ERROR' };
    }
  }

  async getAvailablePositions(boxId: string): Promise<AvailablePositionsResponse> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/box/${boxId}/available`);
      return response.data;
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || 'AVAILABLE_ERROR' };
    }
  }

  async getFreezerTree(freezerId: string): Promise<FreezerTreeResponse> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/freezer/${freezerId}/tree`);
      return response.data;
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || 'TREE_ERROR' };
    }
  }

  async getFreezerStats(freezerId: string) {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/freezer/${freezerId}/stats`);
      return response.data;
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error || 'STATS_ERROR' };
    }
  }
}

export const storageApi = new StorageApiService();
