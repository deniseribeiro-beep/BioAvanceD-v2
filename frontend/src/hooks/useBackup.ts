import { useState } from 'react';
import { backupService } from '../services/api';

// #740 (RF013 AC#1/AC#3): `status` and `checksum` come from the persisted
// backupHistory run record GET /api/backup/list merges onto the filesystem
// listing by path (backup.routes.js). Both are null for a backup directory
// with no matching history row, which is a real case -- the listing is
// filesystem-rooted, history is merged in best-effort.
export type BackupRunStatus = 'success' | 'error' | 'skipped';

export interface Backup {
  fileName: string;
  path: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  status?: BackupRunStatus | string | null;
  checksum?: string | null;
}

export function useBackup() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unwrap = <T,>(payload: any): T => {
    if (payload && typeof payload === 'object' && 'data' in payload && payload.data !== undefined) {
      return payload.data as T;
    }
    return payload as T;
  };

  const performBackup = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await backupService.performBackup();
      return unwrap<any>(response.data);
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
      return unwrap<Backup[]>(response.data);
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
      return unwrap<any>(response.data);
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

