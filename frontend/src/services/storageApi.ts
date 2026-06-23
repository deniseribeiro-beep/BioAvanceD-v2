import api from './api';

const API_STORAGE_BASE = '/storage'; // Usa a baseURL do api

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
  sampleLocation?: { position?: string };
  error?: string;
  message?: string;
}

interface ReleaseResponse {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

interface SampleLocationResponse {
  success: boolean;
  data?: any;
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
  /**
   * Buscar amostras disponíveis para alocação por termo (barcode, patientID, sampleID)
   * Apenas retorna amostras com consentimento válido e sem localização
   */
  async searchSamples(term: string): Promise<any> {
    try {
      const response = await api.get(
        `${API_STORAGE_BASE}/samples/search?q=${encodeURIComponent(term)}`
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'SEARCH_ERROR',
        data: []
      };
    }
  }

  /**
   * Listar todos os freezers disponíveis
   */
  async listFreezers(): Promise<FreezerTreeResponse> {
    try {
      const response = await api.get(`${API_STORAGE_BASE}/freezers`);
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'LIST_ERROR',
      };
    }
  }

  /**
   * Validar se uma posição está disponível
   */
  async validatePosition(boxId: string, position: string): Promise<ValidatePositionResponse> {
    try {
      const response = await api.get(
        `${API_STORAGE_BASE}/validate/${boxId}/${position}`
      );
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

  /**
   * Alocar amostra a uma posição
   */
  async allocateSample(sampleId: string, boxId: string, position: string): Promise<AllocateResponse> {
    try {
      const response = await api.post(
        `${API_STORAGE_BASE}/allocate`,
        { sampleId, boxId, position }
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'ALLOCATION_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Alocar amostra automaticamente na próxima posição disponível da caixa
   */
  async autoAssignSampleToBox(sampleId: string, boxId: string): Promise<AllocateResponse> {
    try {
      const response = await api.post(
        `${API_STORAGE_BASE}/allocate/auto`,
        { sampleId, boxId }
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'AUTO_ALLOCATION_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Liberar amostra de uma posição
   */
  async releaseSample(sampleId: string): Promise<ReleaseResponse> {
    try {
      const response = await api.delete(
        `${API_STORAGE_BASE}/release/${sampleId}`
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'RELEASE_ERROR',
        message: error.response?.data?.message || error.message,
      };
    }
  }

  /**
   * Obter localização de uma amostra
   */
  async getSampleLocation(sampleId: string): Promise<SampleLocationResponse> {
    try {
      const response = await api.get(
        `${API_STORAGE_BASE}/sample/${sampleId}`
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'LOCATION_ERROR',
      };
    }
  }

  /**
   * Obter posições disponíveis em uma caixa
   */
  async getAvailablePositions(boxId: string): Promise<AvailablePositionsResponse> {
    try {
      const response = await api.get(
        `${API_STORAGE_BASE}/box/${boxId}/available`
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'AVAILABLE_ERROR',
      };
    }
  }

  /**
   * Obter árvore hierárquica do freezer
   */
  async getFreezerTree(freezerId: string): Promise<FreezerTreeResponse> {
    try {
      const response = await api.get(
        `${API_STORAGE_BASE}/freezer/${freezerId}/tree`
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'TREE_ERROR',
      };
    }
  }

  /**
   * Obter estatísticas de ocupação do freezer
   */
  async getFreezerStats(freezerId: string) {
    try {
      const response = await api.get(
        `${API_STORAGE_BASE}/freezer/${freezerId}/stats`
      );
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || 'STATS_ERROR',
      };
    }
  }
}

export const storageApi = new StorageApiService();
