import { useState, useEffect } from 'react';
import { Log } from '../types/models';
import { logService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

interface ApiLikeError {
  response?: {
    status?: number;
    statusText?: string;
    data?: {
      error?: string;
      message?: string;
    };
  };
  message?: string;
}

type LogsPayload = {
  success?: boolean;
  data?: unknown;
  logs?: unknown;
};

function extractLogsFromPayload(payload: unknown): Log[] {
  const typedPayload = payload as LogsPayload | null;
  const nestedData = typedPayload?.data as { logs?: unknown } | unknown;

  if (typedPayload?.success && typeof nestedData === 'object' && nestedData && Array.isArray((nestedData as { logs?: unknown }).logs)) {
    return (nestedData as { logs: Log[] }).logs;
  }

  if (typedPayload?.success && Array.isArray(typedPayload?.data)) {
    return typedPayload.data as Log[];
  }

  if (Array.isArray(typedPayload?.logs)) {
    return typedPayload.logs as Log[];
  }

  if (Array.isArray(payload)) {
    return payload as Log[];
  }

  if (Array.isArray(typedPayload?.data)) {
    return typedPayload.data as Log[];
  }

  return [];
}

function extractErrorMessage(error: unknown, fallback: string): string {
  const typedError = error as ApiLikeError | null;

  if (typedError?.response?.status === 503) {
    return 'Banco de dados não disponível. Verifique a conexão com o MongoDB.';
  }

  if (typedError?.response?.data?.error) {
    return typedError.response.data.error;
  }

  if (typedError?.response?.data?.message) {
    return typedError.response.data.message;
  }

  if (typedError?.response?.status) {
    return `${fallback} (${typedError.response.status}${typedError.response.statusText ? `: ${typedError.response.statusText}` : ''})`;
  }

  if (typedError?.message) {
    return typedError.message;
  }

  return fallback;
}

export function useLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setLogs([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadLogs = async (filters?: Record<string, unknown>) => {
    try {
      setLoading(true);
      setError(null);
      const response = await logService.getLogs(filters);
      const logsData = extractLogsFromPayload(response.data);
      
      setLogs(logsData);
      setError(null);
    } catch (err: unknown) {
      console.error('Erro ao carregar logs:', err);
      const errorMessage = extractErrorMessage(err, 'Erro ao carregar logs');
      
      setError(errorMessage);
      setLogs([]); // Define array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const queryLogs = async (filters: Record<string, unknown>) => {
    try {
      const response = await logService.queryLogs(filters);
      const logsData = extractLogsFromPayload(response.data);
      
      setLogs(logsData);
      return logsData;
    } catch (err: unknown) {
      console.error('Erro ao consultar logs:', err);
      setLogs([]); // Define array vazio em caso de erro

      const errorMessage = extractErrorMessage(err, 'Erro ao consultar logs');
      throw new Error(errorMessage);
    }
  };

  const registerEvent = async (data: Partial<Log>) => {
    try {
      const response = await logService.registerEvent(data);
      const responseData = response.data as { data?: Log } | Log;
      const newLog: Log = (responseData as { data?: Log })?.data || (responseData as Log);
      setLogs([newLog, ...logs]);
      return newLog;
    } catch (err: unknown) {
      throw new Error(extractErrorMessage(err, 'Erro ao registrar evento'));
    }
  };

  return {
    logs,
    loading,
    error,
    loadLogs,
    queryLogs,
    registerEvent,
  };
}


