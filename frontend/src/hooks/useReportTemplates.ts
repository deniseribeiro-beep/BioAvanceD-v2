import { useState, useEffect } from 'react';
import { ReportTemplate } from '../types/models';
import { reportTemplateService } from '../services/api';
import { onClientLogout } from '../utils/sessionCleanup';

export function useReportTemplates() {
  const [reportTemplates, setReportTemplates] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReportTemplates();
  }, []);

  useEffect(() => {
    return onClientLogout(() => {
      setReportTemplates([]);
      setError(null);
      setLoading(false);
    });
  }, []);

  const loadReportTemplates = async () => {
    try {
      setLoading(true);
      const response = await reportTemplateService.getAll();
      const responseData: any = response.data;
      const templatesData = Array.isArray(responseData) ? responseData : (responseData?.data || []);
      setReportTemplates(templatesData);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.details?.join('; ') || err.response?.data?.error || err.message || 'Erro ao carregar modelos de relatório');
      setReportTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const createReportTemplate = async (data: Partial<ReportTemplate>) => {
    try {
      const response = await reportTemplateService.create(data);
      const responseData: any = response.data;
      await loadReportTemplates();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.response?.data?.details?.join('; ') || err.response?.data?.error || err.message || 'Erro ao criar modelo de relatório');
    }
  };

  const updateReportTemplate = async (id: string, data: Partial<ReportTemplate>) => {
    try {
      const response = await reportTemplateService.update(id, data);
      const responseData: any = response.data;
      await loadReportTemplates();
      return responseData?.data || responseData;
    } catch (err: any) {
      throw new Error(err.response?.data?.details?.join('; ') || err.response?.data?.error || err.message || 'Erro ao atualizar modelo de relatório');
    }
  };

  const deleteReportTemplate = async (id: string) => {
    try {
      await reportTemplateService.delete(id);
      await loadReportTemplates();
    } catch (err: any) {
      throw new Error(err.response?.data?.details?.join('; ') || err.response?.data?.error || err.message || 'Erro ao remover modelo de relatório');
    }
  };

  return {
    reportTemplates,
    loading,
    error,
    loadReportTemplates,
    createReportTemplate,
    updateReportTemplate,
    deleteReportTemplate,
  };
}
