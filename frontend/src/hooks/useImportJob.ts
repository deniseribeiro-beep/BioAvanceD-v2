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
  const safetyIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callbacksRef = useRef({ onCompleted, onFailed, onProgress });
  const jobRef = useRef<ImportJob | null>(null);

  useEffect(() => {
    callbacksRef.current = { onCompleted, onFailed, onProgress };
  }, [onCompleted, onFailed, onProgress]);

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  // Busca status do job
  const fetchJobStatus = useCallback(async () => {
    if (!jobID) return;

    try {
      setLoading(true);
      const response = await importService.getJobStatus(jobID);
      const jobData = response.data?.data || response.data;

      setJob(jobData);
      setError(null);

      // Mantém loading enquanto job estiver pendente/processando
      const isActive = jobData.status === 'pending' || jobData.status === 'processing';
      setLoading(isActive);

      // Chama callbacks atuais sem reabrir socket por mudança de identidade
      const { onCompleted: completedCb, onFailed: failedCb, onProgress: progressCb } = callbacksRef.current;
      if (jobData.status === 'completed' && completedCb) {
        completedCb(jobData);
      } else if (jobData.status === 'failed' && failedCb) {
        failedCb(jobData);
      } else if (progressCb) {
        progressCb(jobData);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar status do job');
      console.error('Erro ao buscar status do job:', err);
      setLoading(false);
    }
  }, [jobID]);

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
      socket.emit('subscribe:job', { jobID });
      if (jobRef.current?.userID) {
        socket.emit('subscribe:user', { userID: jobRef.current.userID });
      }
    });

    // Loga qualquer evento recebido pelo socket.io
    socket.onAny((eventName, ...args) => {
      console.log('📡 WS Event:', eventName, 'Payload:', args);
    });

    // Loga mensagens brutas e tenta parsear para inspecionar jobID/status
    socket.on('message', (data: any) => {
      console.log('📡 WS Raw Message:', data);
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        console.log('📦 WS Parsed:', parsed, 'Waiting for JobID:', jobID);
        if (parsed?.jobID && parsed.jobID === jobID) {
          fetchJobStatus();
        }
      } catch (e) {
        console.error('❌ Erro no parse do WS:', e);
      }
    });

    socket.on('import-completed', (data: { jobID: string; [key: string]: any }) => {
      if (data.jobID !== jobID) return;
      fetchJobStatus();
      const currentJob = jobRef.current;
      const cb = callbacksRef.current.onCompleted;
      if (cb && currentJob) {
        cb(currentJob);
      }
    });

    socket.on('import-failed', (data: { jobID: string; [key: string]: any }) => {
      if (data.jobID !== jobID) return;
      fetchJobStatus();
      const currentJob = jobRef.current;
      const cb = callbacksRef.current.onFailed;
      if (cb && currentJob) {
        cb(currentJob);
      }
    });

    socketRef.current = socket;

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [jobID, enableWebSocket, fetchJobStatus]);

  // Safety net: polling de backup enquanto loading estiver true
  useEffect(() => {
    if (!jobID || !loading) {
      if (safetyIntervalRef.current) {
        clearInterval(safetyIntervalRef.current);
        safetyIntervalRef.current = null;
      }
      return;
    }

    if (safetyIntervalRef.current) return;

    safetyIntervalRef.current = setInterval(async () => {
      try {
        const response = await importService.getJobStatus(jobID);
        const jobData = response.data?.data || response.data;

        setJob(jobData);
        setError(null);

        const isActive = jobData.status === 'pending' || jobData.status === 'processing';
        setLoading(isActive);

        const { onCompleted: completedCb, onFailed: failedCb, onProgress: progressCb } = callbacksRef.current;

        if (jobData.status === 'completed') {
          if (completedCb) completedCb(jobData);
          clearInterval(safetyIntervalRef.current as NodeJS.Timeout);
          safetyIntervalRef.current = null;
        } else if (jobData.status === 'failed') {
          if (failedCb) failedCb(jobData);
          clearInterval(safetyIntervalRef.current as NodeJS.Timeout);
          safetyIntervalRef.current = null;
        } else if (progressCb) {
          progressCb(jobData);
        }
      } catch (err) {
        console.error('Erro no polling de backup do job:', err);
      }
    }, 2000);

    return () => {
      if (safetyIntervalRef.current) {
        clearInterval(safetyIntervalRef.current);
        safetyIntervalRef.current = null;
      }
    };
  }, [jobID, loading]);

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

