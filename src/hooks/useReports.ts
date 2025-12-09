import { useState, useEffect } from 'react';
import { Reports } from '../types/models';
import { reportsService } from '../services/api';

export function useReports() {
  const [reports, setReports] = useState<Reports[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);
      const response = await reportsService.getAll();
      setReports(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar relatórios');
    } finally {
      setLoading(false);
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


