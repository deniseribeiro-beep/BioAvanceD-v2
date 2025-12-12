import { useState, useEffect } from 'react';
import { Log } from '../types/models';
import { logService } from '../services/api';

export function useLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async (filters?: any) => {
    try {
      setLoading(true);
      setError(null);
      const response = await logService.getLogs(filters);
      
      // Trata diferentes formatos de resposta do backend
      let logsData: Log[] = [];
      
      if (response && response.data) {
        const responseData = response.data;
        
        // Formato: { success: true, data: { logs: [...], total: ... } }
        if (responseData.success && responseData.data) {
          if (Array.isArray(responseData.data.logs)) {
            logsData = responseData.data.logs;
          } else if (Array.isArray(responseData.data)) {
            logsData = responseData.data;
          }
        }
        // Formato: { success: true, data: [...] } (array direto)
        else if (responseData.success && Array.isArray(responseData.data)) {
          logsData = responseData.data;
        }
        // Formato: { logs: [...], total: ... }
        else if (responseData.logs && Array.isArray(responseData.logs)) {
          logsData = responseData.logs;
        }
        // Formato: array direto
        else if (Array.isArray(responseData)) {
          logsData = responseData;
        }
        // Formato: { data: [...] }
        else if (responseData.data && Array.isArray(responseData.data)) {
          logsData = responseData.data;
        }
      }
      
      setLogs(logsData);
      setError(null);
    } catch (err: any) {
      console.error('Erro ao carregar logs:', err);
      let errorMessage = 'Erro ao carregar logs';
      
      if (err.response) {
        // Erro com resposta do servidor
        if (err.response.status === 503) {
          errorMessage = 'Banco de dados não disponível. Verifique a conexão com o MongoDB.';
        } else {
          errorMessage = err.response.data?.error || err.response.data?.message || `Erro ${err.response.status}: ${err.response.statusText}`;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      setLogs([]); // Define array vazio em caso de erro
    } finally {
      setLoading(false);
    }
  };

  const queryLogs = async (filters: any) => {
    try {
      const response = await logService.queryLogs(filters);
      
      // Trata diferentes formatos de resposta do backend
      let logsData: Log[] = [];
      
      if (response && response.data) {
        const responseData = response.data;
        
        // Formato: { success: true, data: { logs: [...], total: ... } }
        if (responseData.success && responseData.data) {
          if (Array.isArray(responseData.data.logs)) {
            logsData = responseData.data.logs;
          } else if (Array.isArray(responseData.data)) {
            logsData = responseData.data;
          }
        }
        // Formato: { success: true, data: [...] } (array direto)
        else if (responseData.success && Array.isArray(responseData.data)) {
          logsData = responseData.data;
        }
        // Formato: { logs: [...], total: ... }
        else if (responseData.logs && Array.isArray(responseData.logs)) {
          logsData = responseData.logs;
        }
        // Formato: array direto
        else if (Array.isArray(responseData)) {
          logsData = responseData;
        }
        // Formato: { data: [...] }
        else if (responseData.data && Array.isArray(responseData.data)) {
          logsData = responseData.data;
        }
      }
      
      setLogs(logsData);
      return logsData;
    } catch (err: any) {
      console.error('Erro ao consultar logs:', err);
      setLogs([]); // Define array vazio em caso de erro
      
      let errorMessage = 'Erro ao consultar logs';
      if (err.response) {
        if (err.response.status === 503) {
          errorMessage = 'Banco de dados não disponível. Verifique a conexão com o MongoDB.';
        } else {
          errorMessage = err.response.data?.error || err.response.data?.message || `Erro ${err.response.status}`;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      throw new Error(errorMessage);
    }
  };

  const registerEvent = async (data: Partial<Log>) => {
    try {
      const response = await logService.registerEvent(data);
      setLogs([response.data, ...logs]);
      return response.data;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao registrar evento');
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


