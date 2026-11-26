import { useState, useEffect } from 'react';
import { Log } from '../types/models';
import { logService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

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
  // #901: loadLogs and queryLogs both write `logs` state, so they share one
  // sequence -- whichever call is issued last must be able to invalidate
  // the other's in-flight response.
  const requestSeq = useRequestSequence();
  // #1446: `loading` is set by loadLogs alone, so only a newer loadLogs may
  // take over its reset; a queryLogs that supersedes a load's data must not
  // leave `loading` stuck true.
  const loadingSeq = useRequestSequence();

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
    const seq = requestSeq.next();
    const loadingTurn = loadingSeq.next();
    try {
      setLoading(true);
      setError(null);
      const response = await logService.getLogs(filters);
      if (!requestSeq.isCurrent(seq)) return;
      const logsData = extractLogsFromPayload(response.data);

      setLogs(logsData);
      setError(null);
    } catch (err: unknown) {
      console.error('Erro ao carregar logs:', err);
      if (!requestSeq.isCurrent(seq)) return;
      const errorMessage = extractErrorMessage(err, 'Erro ao carregar logs');

      setError(errorMessage);
      setLogs([]); // Define array vazio em caso de erro
    } finally {
      if (loadingSeq.isCurrent(loadingTurn)) setLoading(false);
    }
  };

  const queryLogs = async (filters: Record<string, unknown>) => {
    const seq = requestSeq.next();
    try {
      const response = await logService.queryLogs(filters);
      const logsData = extractLogsFromPayload(response.data);

      if (requestSeq.isCurrent(seq)) {
        setLogs(logsData);
      }
      return logsData;
    } catch (err: unknown) {
      console.error('Erro ao consultar logs:', err);
      if (requestSeq.isCurrent(seq)) {
        setLogs([]); // Define array vazio em caso de erro
      }

      const errorMessage = extractErrorMessage(err, 'Erro ao consultar logs');
      throw new Error(errorMessage);
    }
  };

  // #1107: `registerEvent` was removed along with the POST /api/logs/register
  // route it wrapped -- it had no consumer (LogsPage is the only caller of this
  // hook and never destructured it), and the route was a forgery surface on the
  // immutable audit trail. Audit rows are written server-side, not submitted by
  // the client.

  return {
    logs,
    loading,
    error,
    loadLogs,
    queryLogs,
  };
}


