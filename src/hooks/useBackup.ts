import { useState } from 'react';
import { backupService } from '../services/api';

export interface Backup {
  fileName: string;
  path: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}

export function useBackup() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performBackup = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await backupService.performBackup();
      return response.data;
    } catch (err: any) {
      setError(err.message || 'Erro ao realizar backup');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const listBackups = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await backupService.listBackups();
      return response.data as Backup[];
    } catch (err: any) {
      setError(err.message || 'Erro ao listar backups');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const restoreBackup = async (fileName: string) => {
    try {
      setLoading(true);
      setError(null);
      const response = await backupService.restoreBackup(fileName);
      return response.data;
    } catch (err: any) {
      setError(err.message || 'Erro ao restaurar backup');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    performBackup,
    listBackups,
    restoreBackup,
  };
}

