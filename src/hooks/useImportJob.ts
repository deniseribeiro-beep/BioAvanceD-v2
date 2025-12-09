import { useState, useEffect, useCallback, useRef } from 'react';
import { importService } from '../services/api';

// Importação do socket.io-client
import { io as socketIO } from 'socket.io-client';

// Função para criar conexão socket
function createSocket(url: string) {
  try {
    return socketIO(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });
  } catch (e) {
    console.warn('socket.io-client não disponível. Notificações WebSocket desabilitadas.');
    return null;
  }
}

export interface ImportJob {
  jobID: string;
  userID?: string;
  dataType: string;
  fileName: string;
  fileSize?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  totalRecords: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ row?: number; error: string }>;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  fhirResources?: Array<{ resourceType: string; id: string; resource: any }>;
}

export interface UseImportJobOptions {
  pollInterval?: number;
  enableWebSocket?: boolean;
  onCompleted?: (job: ImportJob) => void;
  onFailed?: (job: ImportJob) => void;
  onProgress?: (job: ImportJob) => void;
}

export function useImportJob(jobID: string | null, options: UseImportJobOptions = {}) {
  const {
    pollInterval = 2000,
    enableWebSocket = true,
    onCompleted,
    onFailed,
    onProgress,
  } = options;

  const [job, setJob] = useState<ImportJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  
  const socketRef = useRef<any>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Conecta ao WebSocket
  useEffect(() => {
    if (!enableWebSocket || !jobID) return;

    // Detecta URL da API (mesma lógica do api.ts)
    const getApiBaseUrl = (): string => {
      // Tenta obter da variável de ambiente (Vite)
      const viteEnv = (import.meta as any).env;
      if (viteEnv?.VITE_API_BASE_URL) {
        const url = viteEnv.VITE_API_BASE_URL;
        // Remove /api se existir, pois WebSocket não precisa
        return url.replace(/\/api$/, '');
      }
      
      // Fallback: detecta automaticamente
      const hostname = window.location.hostname;
      const protocol = window.location.protocol;
      
      // Tenta obter porta do localStorage (salva quando backend usa porta alternativa)
      const savedPort = localStorage.getItem('api_port');
      const apiPort = savedPort || '3000';
      
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return `http://localhost:${apiPort}`;
      }
      return `${protocol}//${hostname}:${apiPort}`;
    };
  
    const httpUrl = getApiBaseUrl();

    // Converte http → ws
    const wsUrl = httpUrl
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://");

    console.log("🔌 Conectando WebSocket em:", wsUrl);

    const socket = createSocket(wsUrl);

    if (!socket) {
      console.warn('socket.io-client não disponível');
      return;
    }

    socket.on('connect', () => {
      console.log('WebSocket conectado para monitoramento de importação');
    });

    socket.on('import-completed', (data: { jobID: string; [key: string]: any }) => {
      if (data.jobID === jobID) {
        fetchJobStatus();
        if (onCompleted && job) {
          onCompleted(job);
        }
      }
    });

    socket.on('import-failed', (data: { jobID: string; [key: string]: any }) => {
      if (data.jobID === jobID) {
        fetchJobStatus();
        if (onFailed && job) {
          onFailed(job);
        }
      }
    });

    socketRef.current = socket;

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [jobID, enableWebSocket, onCompleted, onFailed, job]);

  // Busca status do job
  const fetchJobStatus = useCallback(async () => {
    if (!jobID) return;

    try {
      setLoading(true);
      const response = await importService.getJobStatus(jobID);
      const jobData = response.data;

      setJob(jobData);
      setError(null);

      // Chama callbacks
      if (jobData.status === 'completed' && onCompleted) {
        onCompleted(jobData);
      } else if (jobData.status === 'failed' && onFailed) {
        onFailed(jobData);
      } else if (onProgress) {
        onProgress(jobData);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar status do job');
      console.error('Erro ao buscar status do job:', err);
    } finally {
      setLoading(false);
    }
  }, [jobID, onCompleted, onFailed, onProgress]);

  // Polling automático
  useEffect(() => {
    if (!jobID || enableWebSocket) return; // Não faz polling se WebSocket está ativo

    setIsPolling(true);
    fetchJobStatus();

    pollingIntervalRef.current = setInterval(() => {
      fetchJobStatus();
    }, pollInterval);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setIsPolling(false);
    };
  }, [jobID, pollInterval, enableWebSocket, fetchJobStatus]);

  // Busca inicial
  useEffect(() => {
    if (jobID) {
      fetchJobStatus();
    }
  }, [jobID, fetchJobStatus]);

  // === Polling manual chamado pelo useAsyncImport ===
  const startPolling = useCallback(() => {
    if (!jobID) return;
    if (pollingIntervalRef.current) return; // já está rodando

    setIsPolling(true);
    fetchJobStatus();

    pollingIntervalRef.current = setInterval(() => {
      fetchJobStatus();
    }, pollInterval);
  }, [jobID, pollInterval, fetchJobStatus]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []); 
  
  return {
    job,
    loading,
    error,
    isPolling,
    fetchJobStatus,
    startPolling,
    stopPolling,
    cancelJob: async () => {
      if (!jobID) return null;
      return importService.cancelJob(jobID);
    },
    getReport: async () => {
      if (!jobID) return null;
      return importService.getImportReport(jobID);
    },
  };
}

