import { useState, useEffect } from 'react';
import { Reports } from '../types/models';
import { reportsService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';
import { useRequestSequence } from './useRequestSequence';

export function useReports() {
  const [reports, setReports] = useState<Reports[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #901: discards a stale response when loadReports is called again
  // before a previous in-flight call resolves.
  const requestSeq = useRequestSequence();

  useEffect(() => {
    loadReports();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setReports([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadReports = async () => {
    const seq = requestSeq.next();
    try {
      setLoading(true);
      const response = await reportsService.getAll();
      if (!requestSeq.isCurrent(seq)) return;
      setReports(response.data);
      setError(null);
    } catch (err: any) {
      if (!requestSeq.isCurrent(seq)) return;
      setError(err.message || 'Erro ao carregar relatórios');
    } finally {
      if (requestSeq.isCurrent(seq)) setLoading(false);
    }
  };

  const generateReport = async (reportType: string) => {
    try {
      const response = await reportsService.generate(reportType);
      const newReport = response.data;
      // Atualiza a lista de relatórios
      await loadReports();
      return newReport;
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao gerar relatório');
    }
  };

  const deleteReport = async (id: number) => {
    try {
      await reportsService.delete(id);
      setReports(reports.filter((r) => r.reportID !== id));
    } catch (err: any) {
      throw new Error(err.message || 'Erro ao deletar relatório');
    }
  };

  return {
    reports,
    loading,
    error,
    loadReports,
    generateReport,
    deleteReport,
  };
}


